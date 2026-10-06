/-!
# fleet: `applyStatuses` and `endShell`

The status transitions behind the pane and the "ended" toasts. The properties
that matter: an agent's `endedAt` is set exactly when it is not live, an ended
timestamp never moves, and replaying the same statuses never toasts twice.
-/

namespace Plugins.Fleet

def isLive (s : String) : Bool := s == "pending" || s == "running" || s == "waiting"

structure Item where
  id : String
  status : String
  endedAt : Option Nat
  deriving DecidableEq, Repr

/-- Well-formed: `endedAt` is unset exactly while the item is live. -/
def Item.wf (a : Item) : Prop := isLive a.status = true ↔ a.endedAt = none

/-- One agent under `applyStatuses`: the new agent, and the agent if it just ended. -/
def step (statuses : String → Option String) (now : Nat) (a : Item) : Item × Option Item :=
  match statuses a.id with
  | none => (a, none)
  | some s =>
    if s = a.status then (a, none)
    else if isLive s then ({ a with status := s, endedAt := none }, none)
    else
      let c := { a with status := s, endedAt := a.endedAt <|> some now }
      (c, if isLive a.status then some c else none)

def applyStatuses (statuses : String → Option String) (agents : List Item) (now : Nat) :
    List Item × List Item :=
  (agents.map (fun a => (step statuses now a).1), agents.filterMap (fun a => (step statuses now a).2))

theorem step_wf (st : String → Option String) (now : Nat) (a : Item) (h : a.wf) :
    (step st now a).1.wf := by
  unfold step Item.wf at *
  split
  · exact h
  · split
    · exact h
    · split
      · next hl => simp [hl]
      · next hl => cases he : a.endedAt <;> simp [hl]

theorem step_id (st : String → Option String) (now : Nat) (a : Item) :
    (step st now a).1.id = a.id := by
  unfold step; split <;> (try split) <;> (try split) <;> rfl

/-- An agent that had ended keeps its end time unless it is resumed. -/
theorem step_endedAt_stable (st : String → Option String) (now t : Nat) (a : Item)
    (h : a.endedAt = some t) : (step st now a).1.endedAt = some t ∨ isLive (step st now a).1.status := by
  unfold step; split
  · exact .inl h
  · split
    · exact .inl h
    · split
      · next hl => exact .inr hl
      · exact .inl (by simp [h])

/-- Only a live agent that turns non-live is reported as ended. -/
theorem step_ended (st : String → Option String) (now : Nat) (a c : Item)
    (h : (step st now a).2 = some c) :
    isLive a.status = true ∧ isLive c.status = false ∧ st a.id = some c.status ∧ c = (step st now a).1 := by
  unfold step at *
  split at *
  · simp at h
  · next s hs =>
    split at *
    · simp at h
    · split at *
      · simp at h
      · next hl =>
        split at h
        · next hlive => simp at h; subst h; simp_all
        · simp at h

/-- Replaying a step changes nothing and reports nothing: no double toasts. -/
theorem step_idem (st : String → Option String) (now now' : Nat) (a : Item) :
    step st now' (step st now a).1 = ((step st now a).1, none) := by
  cases hs : st a.id with
  | none => simp [step, hs]
  | some s =>
    by_cases he : s = a.status
    · simp [step, hs, he]
    · by_cases hl : isLive s <;> simp [step, hs, he, hl]

theorem applyStatuses_wf (st : String → Option String) (now : Nat) (l : List Item)
    (h : ∀ a ∈ l, a.wf) : ∀ a ∈ (applyStatuses st l now).1, a.wf := by
  simp only [applyStatuses, List.mem_map]
  rintro _ ⟨a, ha, rfl⟩
  exact step_wf st now a (h a ha)

theorem applyStatuses_ids (st : String → Option String) (now : Nat) (l : List Item) :
    (applyStatuses st l now).1.map Item.id = l.map Item.id := by
  simp [applyStatuses, step_id]

theorem applyStatuses_ended_not_live (st : String → Option String) (now : Nat) (l : List Item) :
    ∀ c ∈ (applyStatuses st l now).2, isLive c.status = false := by
  simp only [applyStatuses, List.mem_filterMap]
  rintro c ⟨a, _, h⟩
  exact (step_ended st now a c h).2.1

theorem applyStatuses_idem (st : String → Option String) (now now' : Nat) (l : List Item) :
    applyStatuses st (applyStatuses st l now).1 now' = ((applyStatuses st l now).1, []) := by
  simp [applyStatuses, List.map_map, List.filterMap_map, Function.comp_def, step_idem]

/-! ## `endShell` -/

/-- `endShell` maps every shell; the reported one is the last live shell with that id. -/
def endOne (id status : String) (now : Nat) (s : Item) : Item :=
  if s.id = id ∧ isLive s.status then { s with status := status, endedAt := some now } else s

def endShell (shells : List Item) (id status : String) (now : Nat) : List Item × Option Item :=
  (shells.map (endOne id status now),
   (shells.filter (fun s => s.id = id ∧ isLive s.status)).getLast?.map (endOne id status now))

theorem endShell_others (id status : String) (now : Nat) (s : Item)
    (h : s.id ≠ id) : endOne id status now s = s := by
  simp [endOne, h]

theorem endShell_ended (shells : List Item) (id status : String) (now : Nat) (e : Item)
    (h : (endShell shells id status now).2 = some e) :
    e.id = id ∧ e.status = status ∧ e.endedAt = some now := by
  simp only [endShell, Option.map_eq_some_iff] at h
  obtain ⟨s, hs, rfl⟩ := h
  have := List.mem_of_getLast? hs
  simp at this
  simp [endOne, this]

/-- Ending a shell twice with a final status reports it once. -/
theorem endShell_idem (shells : List Item) (id status : String) (now now' : Nat)
    (hs : isLive status = false) :
    (endShell (endShell shells id status now).1 id status now').2 = none := by
  simp only [endShell, List.filter_map, Option.map_eq_none_iff, List.getLast?_eq_none_iff,
    List.map_eq_nil_iff]
  apply List.filter_eq_nil_iff.mpr
  intro s _
  simp only [Function.comp_def, endOne]
  split <;> simp_all

end Plugins.Fleet
