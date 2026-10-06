/-!
# continuity's cache lifetime: `decideTtl` and `observeTtl`

Token counts are naturals and the thresholds are exact ratios here
(`read ≥ before / 2`, `prompt ≥ 0.7 · before`); the differential tests check
the TypeScript's floating-point comparisons agree.
-/

namespace Plugins.Ttl

inductive Ttl | m5 | h1
  deriving DecidableEq, Repr

def asTtl : Option String → Option Ttl
  | some "5m" => some .m5
  | some "1h" => some .h1
  | _ => none

def isOn : Option String → Bool
  | some v => v == "1" || v.toLower == "true"
  | none => false

inductive Account | subscription | credits | other
  deriving DecidableEq, Repr

structure Env where
  enable1h : Option String
  force5m : Option String
  ttlVar : Option String

def decideTtl (option : Option String) (env : Env) (setting : Option String)
    (account : Option Account) : Ttl :=
  match asTtl option with
  | some t => t
  | none =>
    if isOn env.force5m then .m5 else
    match asTtl env.ttlVar with
    | some t => t
    | none =>
      match asTtl setting with
      | some t => t
      | none => if isOn env.enable1h then .h1 else if account = some .subscription then .h1 else .m5

/-- A pinned option beats every variable and setting. -/
theorem decide_option (o : String) (t : Ttl) (h : asTtl (some o) = some t) env s a :
    decideTtl (some o) env s a = t := by simp [decideTtl, h]

/-- FORCE_PROMPT_CACHING_5M beats everything but the option. -/
theorem decide_force (o : Option String) (env : Env) s a (ho : asTtl o = none)
    (hf : isOn env.force5m = true) : decideTtl o env s a = .m5 := by
  simp [decideTtl, ho, hf]

/-- With nothing set, a subscription gets an hour and everything else five minutes. -/
theorem decide_default (a : Option Account) :
    decideTtl none ⟨none, none, none⟩ none a = if a = some .subscription then .h1 else .m5 := by
  simp [decideTtl, asTtl, isOn]

structure Sample where
  model : String
  startedAt : Int
  read : Nat
  write : Nat
  fresh : Nat
  deriving Repr

def ttlMs : Ttl → Int
  | .m5 => 300000
  | .h1 => 3600000

def promptTokens (s : Sample) : Nat := s.read + s.write + s.fresh

def SLACK : Int := 10000

def observeTtl (prev : Option Sample) (cur : Sample) (known : Option Ttl) : Option Ttl :=
  match prev with
  | none => known
  | some p =>
    if p.read + p.write = 0 ∨ cur.model ≠ p.model then known else
    let gap := cur.startedAt - p.startedAt
    let before := promptTokens p
    if gap ≤ ttlMs .m5 + SLACK then known
    else if 2 * cur.read ≥ before then some .h1
    else if known = some .h1 then known
    else if cur.write > 0 ∧ 10 * promptTokens cur ≥ 7 * before ∧ gap < ttlMs .h1 + SLACK then some .m5
    else known

/-- Once the hour is proven it stays proven. -/
theorem observe_h1_sticky (prev : Option Sample) (cur : Sample) :
    observeTtl prev cur (some .h1) = some .h1 := by
  unfold observeTtl; split
  · rfl
  · dsimp only; repeat (first | rfl | split)

/-- Requests within five minutes (plus slack) of each other prove nothing. -/
theorem observe_close (p cur : Sample) (k : Option Ttl)
    (h : cur.startedAt - p.startedAt ≤ ttlMs .m5 + SLACK) : observeTtl (some p) cur k = k := by
  simp only [observeTtl]
  split <;> simp_all

/-- The answer is the old one, or one of the two lifetimes. -/
theorem observe_cases (prev : Option Sample) (cur : Sample) (k : Option Ttl) :
    observeTtl prev cur k = k ∨ observeTtl prev cur k = some .h1 ∨ observeTtl prev cur k = some .m5 := by
  unfold observeTtl; split
  · exact .inl rfl
  · dsimp only; repeat (first | exact .inl rfl | exact .inr (.inl rfl) | exact .inr (.inr rfl) | split)

/-- An hour is only ever inferred from a cache hit more than five minutes after the previous request. -/
theorem observe_h1_evidence (p cur : Sample) (k : Option Ttl)
    (h : observeTtl (some p) cur k = some .h1) (hk : k ≠ some .h1) :
    cur.model = p.model ∧ cur.startedAt - p.startedAt > ttlMs .m5 + SLACK ∧ 2 * cur.read ≥ promptTokens p := by
  simp only [observeTtl] at h
  split at h
  · simp_all
  · split at h
    · simp_all
    · split at h
      · next hm hg hr => exact ⟨by simp_all, by omega, hr⟩
      · split at h <;> (try split at h) <;> simp_all

/-- Five minutes is only ever inferred from a real miss on an unshrunk prompt, under an hour later. -/
theorem observe_m5_evidence (p cur : Sample) (k : Option Ttl)
    (h : observeTtl (some p) cur k = some .m5) (hk : k ≠ some .m5) :
    cur.write > 0 ∧ 2 * cur.read < promptTokens p ∧ 10 * promptTokens cur ≥ 7 * promptTokens p ∧
      ttlMs .m5 + SLACK < cur.startedAt - p.startedAt ∧ cur.startedAt - p.startedAt < ttlMs .h1 + SLACK := by
  simp only [observeTtl] at h
  split at h
  · simp_all
  · split at h
    · simp_all
    · split at h
      · simp_all
      · split at h
        · simp_all
        · split at h
          · next hg hr _ hc => exact ⟨hc.1, by omega, hc.2.1, by omega, hc.2.2⟩
          · simp_all

end Plugins.Ttl
