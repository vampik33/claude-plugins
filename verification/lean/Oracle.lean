import Lean.Data.Json
import Plugins

/-!
The differential oracle: one JSON request per stdin line, one JSON answer per
stdout line, computed by the Lean models the proofs are about.
-/
open Lean Plugins

def getStr? (j : Json) (k : String) : Option String := (j.getObjValAs? String k).toOption
def getNat (j : Json) (k : String) : Except String Nat := j.getObjValAs? Nat k
def getInt (j : Json) (k : String) : Except String Int := j.getObjValAs? Int k
def getArr (j : Json) (k : String) : Except String (Array Json) := j.getObjValAs? (Array Json) k

def item (j : Json) : Except String Fleet.Item := do
  return { id := ← j.getObjValAs? String "id", status := ← j.getObjValAs? String "status",
           endedAt := (j.getObjValAs? Nat "endedAt").toOption }

def itemJson (a : Fleet.Item) : Json :=
  Json.mkObj ([("id", toJson a.id), ("status", toJson a.status)] ++
    (a.endedAt.map (fun t => [("endedAt", toJson t)])).getD [])

def ttlJson : Option Ttl.Ttl → Json
  | some .m5 => "5m"
  | some .h1 => "1h"
  | none => Json.null

def ttlOf (j : Json) : Option Ttl.Ttl := Ttl.asTtl (j.getStr?.toOption)

def sample (j : Json) : Except String Ttl.Sample := do
  return { model := ← j.getObjValAs? String "model", startedAt := ← getInt j "startedAt",
           read := ← getNat j "read", write := ← getNat j "write", fresh := ← getNat j "fresh" }

def pairs (a : Array Json) : Except String (List (Json × Json)) :=
  a.toList.mapM fun p => do
    let xs ← p.getArr?
    if h : xs.size = 2 then return (xs[0], xs[1]) else throw "pair"

def answer (req : Json) : Except String Json := do
  let a ← req.getObjVal? "args"
  match ← req.getObjValAs? String "fn" with
  | "trim" =>
    let live : String → Bool :=
      if getStr? a "kind" == some "codex" then (· == "running") else Fleet.isLive
    let items ← (← getArr a "items").toList.mapM item
    let kept := Trim.trim (fun (i : Fleet.Item) => live i.status) (← getNat a "keep") items
    return toJson (kept.map (·.id))
  | "applyStatuses" =>
    let agents ← (← getArr a "agents").toList.mapM item
    let st ← a.getObjVal? "statuses"
    let (next, ended) := Fleet.applyStatuses (fun id => getStr? st id) agents (← getNat a "now")
    return Json.mkObj [("agents", toJson (next.map itemJson)), ("ended", toJson (ended.map itemJson))]
  | "endShell" =>
    let shells ← (← getArr a "shells").toList.mapM item
    let (next, ended) := Fleet.endShell shells (← a.getObjValAs? String "id")
      (← a.getObjValAs? String "status") (← getNat a "now")
    return Json.mkObj [("shells", toJson (next.map itemJson)),
      ("ended", (ended.map itemJson).getD Json.null)]
  | "decideTtl" =>
    let env ← a.getObjVal? "env"
    let account := match getStr? a "account" with
      | some "subscription" => some Ttl.Account.subscription
      | some "credits" => some .credits
      | some "other" => some .other
      | _ => none
    let t := Ttl.decideTtl (getStr? a "option")
      ⟨getStr? env "enable1h", getStr? env "force5m", getStr? env "ttlVar"⟩ (getStr? a "setting") account
    return ttlJson (some t)
  | "observeTtl" =>
    let prev ← match a.getObjVal? "prev" with
      | .ok Json.null | .error _ => pure none
      | .ok p => some <$> sample p
    let known := ttlOf ((a.getObjVal? "known").toOption.getD Json.null)
    return ttlJson (Ttl.observeTtl prev (← sample (← a.getObjVal? "cur")) known)
  | "turnEnd" =>
    let turns ← (← pairs (← getArr a "turns")).mapM fun (k, v) => do
      return ((← k.getStr?).toInt?.getD 0, ← fromJson? v)
    return toJson (PromptClock.turnEnd turns (← getInt a "durationMs"))
  | "cap" =>
    let entries ← (← pairs (← getArr a "entries")).mapM fun (k, v) => do
      return (← k.getStr?, ← fromJson? v)
    return toJson ((PromptClock.cap (← getNat a "keep") entries).map (·.1))
  | fn => throw s!"unknown fn {fn}"

partial def loop (stdin : IO.FS.Stream) (stdout : IO.FS.Stream) : IO Unit := do
  let line ← stdin.getLine
  if line.isEmpty then return
  let out := match Json.parse line >>= answer with
    | .ok j => Json.mkObj [("ok", j)]
    | .error e => Json.mkObj [("error", toJson e)]
  stdout.putStrLn out.compress
  loop stdin stdout

def main : IO Unit := do
  loop (← IO.getStdin) (← IO.getStdout)
