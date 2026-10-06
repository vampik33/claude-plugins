/-!
# continuity: at most one automatic handover per `MIN_TURNS_BETWEEN` turns

A model of `register.tsx`'s handover loop, not the code itself (it is not
differentially tested): `turn.complete` bumps the counter and arms the grace
timer when `shouldHandover` holds; the timer's handover resets the counter when
it compacted or the compaction was skipped, not when it failed; a composer
prompt cancels; `/clear` re-arms.
-/

namespace Plugins.Continuity

def MIN_TURNS_BETWEEN : Nat := 3

structure Facts where
  mainLoop : Bool
  answered : Bool
  aborted : Bool
  paused : Bool
  percent : Option Nat
  threshold : Nat

def shouldHandover (f : Facts) (turnsSince : Nat) : Bool :=
  f.mainLoop && f.answered && !f.aborted && !f.paused &&
    (match f.percent with | some p => decide (p ≥ f.threshold) | none => false) &&
    decide (turnsSince ≥ MIN_TURNS_BETWEEN)

/-- Past the threshold is necessary: an unmeasured context never hands over. -/
theorem should_needs_percent (f : Facts) (n : Nat) (h : shouldHandover f n = true) :
    ∃ p, f.percent = some p ∧ p ≥ f.threshold := by
  unfold shouldHandover at h
  cases hp : f.percent <;> simp_all

inductive Ev
  /-- a main-loop `turn.complete` with these facts -/
  | turn (f : Facts)
  /-- the grace timer's handover; `wrote` is false when writing the note or compacting threw -/
  | handover (wrote : Bool)
  /-- a composer prompt cancels a pending handover -/
  | cancel

structure St where
  turns : Nat
  pending : Bool

def step (s : St) : Ev → St
  | .turn f =>
    let n := s.turns + 1
    { turns := n, pending := s.pending || shouldHandover f n }
  | .handover ok => if s.pending then { turns := if ok then 0 else s.turns, pending := false } else s
  | .cancel => { s with pending := false }

def run (s : St) (t : List Ev) : St := t.foldl step s

def turnsIn (t : List Ev) : Nat := (t.filter (fun | .turn _ => true | _ => false)).length

/-- A handover that wrote its note, compacted or skipped (the timer only exists while pending). -/
def IsDone (s : St) : Ev → Prop
  | .handover true => s.pending = true
  | _ => False

/-- The counter counts turns since the last reset, and nothing is pending before `MIN_TURNS_BETWEEN` of them. -/
def Inv (s : St) (k : Nat) : Prop := s.turns = k ∧ (s.pending = true → k ≥ MIN_TURNS_BETWEEN)

theorem run_inv (t : List Ev) (s : St) (k : Nat) (hs : Inv s k)
    (h : ∀ s, ∀ e ∈ t, ¬ IsDone s e) : Inv (run s t) (k + turnsIn t) := by
  induction t generalizing s k with
  | nil => simpa [run, turnsIn] using hs
  | cons e t ih =>
    have he := h s e (by simp)
    have rest : ∀ s, ∀ e ∈ t, ¬ IsDone s e := fun s e m => h s e (List.mem_cons_of_mem _ m)
    obtain ⟨h1, h2⟩ := hs
    cases e with
    | turn f =>
      have := ih (step s (.turn f)) (k + 1) ⟨by simp [step, h1], fun hp => by
        simp only [step, Bool.or_eq_true] at hp
        rcases hp with hp | hp
        · have := h2 hp; omega
        · unfold shouldHandover at hp; simp at hp; omega⟩ rest
      simpa [run, turnsIn, List.filter_cons, Nat.add_assoc, Nat.add_comm 1] using this
    | handover ok =>
      have := ih (step s (.handover ok)) k (by
        cases ok <;> cases hp : s.pending <;> simp_all [step, IsDone, Inv]) rest
      simpa [run, turnsIn, List.filter_cons] using this
    | cancel =>
      have := ih (step s .cancel) k ⟨by simp [step, h1], by simp [step]⟩ rest
      simpa [run, turnsIn, List.filter_cons] using this

/-- From one handover (counter 0) to the next there are at least `MIN_TURNS_BETWEEN` turns. -/
theorem handovers_spaced (t : List Ev) (h : ∀ s, ∀ e ∈ t, ¬ IsDone s e)
    (hd : IsDone (run ⟨0, false⟩ t) (.handover true)) : turnsIn t ≥ MIN_TURNS_BETWEEN := by
  have := (run_inv t ⟨0, false⟩ 0 ⟨rfl, by simp⟩ h).2 hd
  omega

end Plugins.Continuity
