# verification

Everything that checks the plugins beyond their own example tests. One command runs all of it:

```bash
verification/run.sh
```

Needs `elan` (Lean), `bun`, `claude`, `shellcheck` and `bats` on `PATH` (`run.sh` adds `~/.elan/bin` and `~/.local/bin`).

## Layout

| Path | What |
|---|---|
| `lean/Plugins/*.lean` | Lean 4 models of the mods' invariant-heavy functions, with proofs (core Lean only, no Mathlib) |
| `lean/Oracle.lean` | An executable that evaluates those models on JSON input |
| `props/diff.lean.test.ts` | Differential tests: random inputs through the TypeScript and the Lean oracle, which must agree |
| `props/*.prop.test.ts` | fast-check property tests for every exported pure function in the mods' `core.ts` / `ttl.ts` |
| `../plugins/telegram-notifier/tests/*.bats` | bats tests for telegram-notifier's shell hooks (curl stubbed, no network) |

## What is proven

| Function | Theorems |
|---|---|
| fleet `trim`, codex-review `trimJobs` | live items are never dropped; order kept; the ended items kept are the newest; length ≤ `keep` unless live items alone exceed it |
| fleet `applyStatuses` | "`endedAt` set ⇔ not live" is preserved; an end time never moves unless resumed; replaying statuses reports nothing (no double toast) |
| fleet `endShell` | ending a shell twice reports it once |
| continuity `decideTtl` | precedence: option › `FORCE_PROMPT_CACHING_5M` › … › account default |
| continuity `observeTtl` | 1h is sticky; requests ≤ 5m10s apart never change the answer; 1h and 5m are only concluded from the right evidence |
| prompt-clock `turnEnd` | an answer is within 1 s and no recorded turn is closer; nothing within 1 s → no answer |
| prompt-clock `cap` | keeps exactly `min(n, keep)`; nothing dropped is newer than anything kept |
| continuity handover loop | ≥ 3 turns between automatic handovers |

## Limits

- The proofs are about the Lean models. The differential tests are what tie them to the shipped TypeScript, and they sample inputs rather than cover them all.
- The handover-loop model (`Continuity.lean`) mirrors `register.tsx` by hand and has no differential test.
- Inputs use distinct item ids and integer token counts and times, as the engine supplies them.
