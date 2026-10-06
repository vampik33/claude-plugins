/-!
# prompt-clock: `turnEnd` and `cap`

`turns` and `record` are JS objects; here they are their `Object.entries`, in
that order, which is what the differential tests feed both sides.
-/

namespace Plugins.PromptClock

/-- Distance between a recorded duration and the drawn one. -/
def dist (d : Int) (e : Int × Nat) : Nat := (e.1 - d).natAbs

/-- `for ... if (d <= gap) { gap = d; best = at }`, from `gap = 1000`. -/
def closest (d : Int) (l : List (Int × Nat)) (init : Option Nat × Nat) : Option Nat × Nat :=
  l.foldl (fun (best, gap) e => if dist d e ≤ gap then (some e.2, dist d e) else (best, gap)) init

def turnEnd (turns : List (Int × Nat)) (d : Int) : Option Nat :=
  match turns.find? (·.1 == d) with
  | some e => some e.2
  | none => (closest d turns (none, 1000)).1

theorem closest_spec (d : Int) (l : List (Int × Nat)) (b : Option Nat) (g : Nat) :
    let r := closest d l (b, g)
    r.2 ≤ g ∧ (∀ e ∈ l, r.2 ≤ dist d e) ∧
      ((r.1 = b ∧ r.2 = g) ∨ ∃ e ∈ l, r.1 = some e.2 ∧ r.2 = dist d e) := by
  induction l generalizing b g with
  | nil => simp [closest]
  | cons e es ih =>
    simp only [closest, List.foldl_cons] at ih ⊢
    split
    · next h =>
      obtain ⟨h1, h2, h3⟩ := ih (some e.2) (dist d e)
      refine ⟨by omega, ?_, ?_⟩
      · intro x hx; cases List.mem_cons.mp hx with
        | inl hx => subst hx; omega
        | inr hx => exact h2 x hx
      · rcases h3 with ⟨h3, h4⟩ | ⟨x, hx, h3, h4⟩
        · exact .inr ⟨e, List.mem_cons_self, h3, h4⟩
        · exact .inr ⟨x, List.mem_cons_of_mem _ hx, h3, h4⟩
    · next h =>
      obtain ⟨h1, h2, h3⟩ := ih b g
      refine ⟨h1, ?_, ?_⟩
      · intro x hx; cases List.mem_cons.mp hx with
        | inl hx => subst hx; omega
        | inr hx => exact h2 x hx
      · rcases h3 with h3 | ⟨x, hx, h3, h4⟩
        · exact .inl h3
        · exact .inr ⟨x, List.mem_cons_of_mem _ hx, h3, h4⟩

/-- An exact duration wins. -/
theorem turnEnd_exact (turns : List (Int × Nat)) (d : Int) (e : Int × Nat)
    (h : turns.find? (·.1 == d) = some e) : turnEnd turns d = some e.2 := by
  simp [turnEnd, h]

/-- Any answer is a recorded turn within a second of the drawn duration, and none is closer. -/
theorem turnEnd_sound (turns : List (Int × Nat)) (d : Int) (a : Nat)
    (h : turnEnd turns d = some a) :
    ∃ e ∈ turns, e.2 = a ∧ dist d e ≤ 1000 ∧ ∀ e' ∈ turns, dist d e ≤ dist d e' := by
  unfold turnEnd at h
  split at h
  · next e he =>
    have hm := List.mem_of_find?_eq_some he
    have hk := List.find?_some he
    simp at h hk
    refine ⟨e, hm, h, by simp [dist, hk], fun _ _ => by simp [dist, hk]⟩
  · obtain ⟨h1, h2, h3⟩ := closest_spec d turns none 1000
    rcases h3 with ⟨h3, _⟩ | ⟨e, he, h3, h4⟩
    · simp_all
    · refine ⟨e, he, by simp_all, by omega, fun e' he' => by rw [← h4]; exact h2 e' he'⟩

/-- No recorded turn within a second: no answer. -/
theorem turnEnd_none (turns : List (Int × Nat)) (d : Int) (h : ∀ e ∈ turns, dist d e > 1000) :
    turnEnd turns d = none := by
  unfold turnEnd
  split
  · next e he =>
    have := h e (List.mem_of_find?_eq_some he)
    have hk := List.find?_some he
    simp [dist] at this hk; simp [hk] at this
  · obtain ⟨_, _, h3⟩ := closest_spec d turns none 1000
    rcases h3 with ⟨h3, _⟩ | ⟨e, he, _, h4⟩
    · exact h3
    · have := h e he; omega

/-! ## `cap` -/

def byTime (a b : String × Int) : Bool := a.2 ≤ b.2

def sorted (l : List (String × Int)) := l.mergeSort byTime

def cap (keep : Nat) (l : List (String × Int)) : List (String × Int) :=
  if l.length ≤ keep then l else (sorted l).drop (l.length - keep)

def dropped (keep : Nat) (l : List (String × Int)) : List (String × Int) :=
  if l.length ≤ keep then [] else (sorted l).take (l.length - keep)

theorem sorted_pairwise (l : List (String × Int)) :
    (sorted l).Pairwise (fun a b => byTime a b = true) :=
  List.pairwise_mergeSort (fun a b c h1 h2 => by simp [byTime] at *; omega)
    (fun a b => by simp [byTime]; omega) l

theorem sorted_length (l : List (String × Int)) : (sorted l).length = l.length :=
  (List.mergeSort_perm l byTime).length_eq

/-- Exactly `keep` entries stay once the record is over `keep`. -/
theorem cap_length (keep : Nat) (l : List (String × Int)) :
    (cap keep l).length = min l.length keep := by
  unfold cap; split
  · omega
  · simp [sorted_length]; omega

/-- Kept and dropped together are the record, nothing more, nothing less. -/
theorem cap_perm (keep : Nat) (l : List (String × Int)) :
    (dropped keep l ++ cap keep l).Perm l := by
  unfold cap dropped; split
  · simp
  · rw [List.take_append_drop]; exact List.mergeSort_perm l byTime

/-- The newest win: nothing dropped is newer than anything kept. -/
theorem cap_newest (keep : Nat) (l : List (String × Int)) :
    ∀ x ∈ dropped keep l, ∀ y ∈ cap keep l, x.2 ≤ y.2 := by
  unfold cap dropped; split
  · simp
  · intro x hx y hy
    have hp := sorted_pairwise l
    rw [← List.take_append_drop (l.length - keep) (sorted l)] at hp
    have := (List.pairwise_append.mp hp).2.2 x hx y hy
    simpa [byTime] using this

end Plugins.PromptClock
