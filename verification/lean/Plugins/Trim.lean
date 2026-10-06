/-!
# `trim` (fleet) and `trimJobs` (codex-review)

```ts
if (items.length <= keep) return items;
const ended = items.filter((i) => !isLive(i.status));
const drop = new Set(ended.slice(0, items.length - keep));
return items.filter((i) => !drop.has(i));
```

`drop` holds object identities, so for distinct items this is "drop the first
`items.length - keep` ended items, in list order". `dropEnded` is that.
-/

namespace Plugins.Trim

variable {α : Type} (live : α → Bool)

/-- Drops the first `n` items that are not live, keeping everything else in order. -/
def dropEnded : Nat → List α → List α
  | 0, l => l
  | _ + 1, [] => []
  | n + 1, x :: xs => if live x then x :: dropEnded (n + 1) xs else dropEnded n xs

def trim (keep : Nat) (l : List α) : List α :=
  if l.length ≤ keep then l else dropEnded live (l.length - keep) l

def ended (l : List α) : List α := l.filter (fun x => !live x)

/-! ## `dropEnded` -/

theorem dropEnded_live (n : Nat) (l : List α) :
    (dropEnded live n l).filter live = l.filter live := by
  induction l generalizing n with
  | nil => cases n <;> rfl
  | cons x xs ih =>
    cases n with
    | zero => rfl
    | succ n => by_cases h : live x <;> simp [dropEnded, h, ih]

theorem dropEnded_ended (n : Nat) (l : List α) :
    ended live (dropEnded live n l) = (ended live l).drop n := by
  induction l generalizing n with
  | nil => cases n <;> rfl
  | cons x xs ih =>
    cases n with
    | zero => rfl
    | succ n => by_cases h : live x <;> simp [ended, dropEnded, h] at ih ⊢ <;> exact ih _

theorem dropEnded_sublist (n : Nat) (l : List α) : (dropEnded live n l).Sublist l := by
  induction l generalizing n with
  | nil => cases n <;> simp [dropEnded]
  | cons x xs ih =>
    cases n with
    | zero => exact List.Sublist.refl _
    | succ n =>
      by_cases h : live x <;> simp [dropEnded, h]
      · exact ih _
      · exact (ih _).cons _

theorem length_split (l : List α) :
    l.length = (l.filter live).length + (ended live l).length := by
  induction l with
  | nil => rfl
  | cons x xs ih => by_cases h : live x <;> simp [ended, h] at ih ⊢ <;> omega

/-! ## `trim` -/

/-- Every live item survives, in order. -/
theorem trim_keeps_live (keep : Nat) (l : List α) :
    (trim live keep l).filter live = l.filter live := by
  unfold trim; split
  · rfl
  · exact dropEnded_live live _ l

/-- The ended items kept are the newest (last) ones. -/
theorem trim_ended (keep : Nat) (l : List α) :
    ended live (trim live keep l) = (ended live l).drop (l.length - keep) := by
  unfold trim; split
  · next h => simp [Nat.sub_eq_zero_of_le h]
  · exact dropEnded_ended live _ l

/-- Order is preserved and nothing is invented. -/
theorem trim_sublist (keep : Nat) (l : List α) : (trim live keep l).Sublist l := by
  unfold trim; split
  · exact List.Sublist.refl _
  · exact dropEnded_sublist live _ l

/-- At most `keep` items, unless live items alone exceed it — then every ended one is gone. -/
theorem trim_length (keep : Nat) (l : List α) :
    (trim live keep l).length ≤ keep ∨ ended live (trim live keep l) = [] := by
  have hs := length_split live (trim live keep l)
  have hl := length_split live l
  rw [trim_keeps_live, trim_ended, List.length_drop] at hs
  rw [trim_ended]
  by_cases h : (ended live l).length ≤ l.length - keep
  · right; exact List.drop_eq_nil_of_le h
  · left; omega

/-- Nothing is dropped while the list fits. -/
theorem trim_fits (keep : Nat) (l : List α) (h : l.length ≤ keep) : trim live keep l = l := by
  simp [trim, h]

end Plugins.Trim
