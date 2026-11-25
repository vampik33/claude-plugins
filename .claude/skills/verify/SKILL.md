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
- The watchdog props leave 6 empty `/tmp/watchdog-*-<pid>` dirs per run.
- `FAIL deps: <tool> not found`: install it; see the repo's CLAUDE.md for bats/shellcheck without root. full needs Lean (`lake`, via elan); `run.sh` adds `~/.elan/bin` to PATH.

## Not covered

`tsc -p` type checks (need the engine's types laid down), the mods as drawn in a real session (see `.claude/rules/mods.md`, tmux probe), and POSIX `sh` portability under dash/busybox.
