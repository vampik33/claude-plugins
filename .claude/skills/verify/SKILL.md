---
name: verify
description: Verify a claude-plugins change before committing it - claude plugin validate and test for each changed plugin with the verification/props tests that import it, or verification/run.sh (Lean proofs, differential tests, every mod) when a Lean-modelled file or verification/ changes. Use before every commit that touches plugins/, verification/ or .claude-plugin/.
---

# Verify claude-plugins

From the repo root:

```bash
.claude/skills/verify/verify.sh               # auto: full or quick, from what changed
.claude/skills/verify/verify.sh quick         # each changed plugin: validate, plugin test, its props tests
.claude/skills/verify/verify.sh full          # validate, then verification/run.sh (everything)
.claude/skills/verify/verify.sh quick fleet   # name the plugins instead of reading the diff
```

"Changed" is `git diff` against the merge base with `origin/main` (or `VERIFY_BASE`), plus staged and untracked files, so a branch's earlier commits count. Without that merge base the run stops with `FAIL setup`: `git fetch origin main` or set `VERIFY_BASE`. The checks run on the working tree, not on what is staged: a `NOTE` names any file with both staged and unstaged changes.

## What each plugin gets

- A mod (the `for mod in …` list in `verification/run.sh`): `claude plugin validate`, `claude plugin test plugins/<mod>`, and `bun test` on every `verification/props/*.test.ts` that imports `plugins/<mod>/` (the `.prop` and `.fv` files, `t4-parsers` and `formal-verify-findings` included), except `diff.lean.test.ts`.
- telegram-notifier (any plugin with `tests/*.bats`): validate, `shellcheck -x` on its hook scripts, `bats`.
- claudemd-gen, explain-changes, gtr, plan-renamer (commands and skills only): `claude plugin validate`.
- `.claude-plugin/marketplace.json`: `claude plugin validate .`.

## Which tier

`auto` picks **full** when anything under `verification/` changed, or a file with a Lean model: whatever `diff.lean.test.ts` imports (fleet, codex-review and chat-view `core.ts`, continuity `ttl.ts`) and continuity's `register.tsx`. Otherwise **quick**. Forcing quick on such a change prints a `NOTE` naming the files the Lean proofs cover. Docs outside `plugins/` need nothing.

## Reading the result

- One `PASS`/`FAIL` line per step. The first `FAIL` stops the run and prints the last 40 lines of that step's log. Exit 0 only when every step passed: read the whole output and the exit code, never through a pipe.
- Each step's whole log: `.claude/verify-logs/<step>.log` (ignored by git).
- `FAIL deps: <tool> not found`: install it; see the repo's CLAUDE.md for bats/shellcheck without root. full needs Lean (`lake`, via elan); `run.sh` adds `~/.elan/bin` to PATH.

## Known failures on main (2026-11-23)

On this machine `run.sh` fails on a clean `main`, so **full fails until they are fixed**. These failures are not caused by your change:
- `watchdog.prop.test.ts`, "SCAN_SCRIPT on this machine": three tests time out at bun's 5 s default.
- `fleet.prop.test.ts`: `heldArgv` "any file name comes back verbatim" times out the same way. It spawns a shell for each of 200 runs.
- Without the 5 s limit, one test still fails: "a reaped child's I/O stays in the tree". It needs its first scan to land within 0.5 s, and on a loaded machine it lands later.

Compare a full run's `(fail)` lines in `.claude/verify-logs/run.sh.log` against this list before blaming the change. quick runs those two files for a watchdog or fleet change, so it can fail there too. The watchdog tests also leave 6 empty `/tmp/watchdog-*-<pid>` dirs per run, and a timed-out run can leave a `python3 -m http.server` and a `tail -f` behind: check with `pgrep -a -f 'http.server 0|tail -f /tmp/watchdog'`.

## Timings and reliability (2026-11-23)

- quick: 7-11 s for one mod; 23 s for three; about 25 s for fleet (3 props files). telegram-notifier: about 8.5 min, almost all of it in 5 `check-credentials` "jq/curl missing" bats tests (67-99 s each). Their `path_without` forks `basename` and `ln` for each of the 3442 entries in `/usr/bin` and `/bin`.
- full: about 55 s up to the props failures above; Lean takes about 4 min on its first build in a fresh checkout.
- 6 clean quick runs passed. Deliberately broken changes, each caught at its step:
  - palette `recordUse` off by one at `REPEAT_MS` -> `FAIL test-palette`
  - palette counting each use twice, also when committed on a branch with a clean tree -> `FAIL test-palette`
  - fleet `trim` dropping live items -> auto picked full, and `run.sh` failed `Lean ≡ TypeScript > fleet trim` and "live items are always preserved"
  - an unquoted variable in a telegram-notifier hook -> `FAIL shellcheck-telegram-notifier`, before bats
  - an untracked failing test in ship -> `FAIL test-ship`
  - bun and lake missing from PATH -> `FAIL deps`

## Not covered

`tsc -p` type checks (need the engine's types laid down), the mods as drawn in a real session (see plugins/CLAUDE.md, tmux probe), and POSIX `sh` portability under dash/busybox.

The skill's files are tracked though the repo ignores `.claude/`: they were added with `git add -f`, and a new file here needs `-f` too.
