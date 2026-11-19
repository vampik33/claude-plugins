# fleet: mark vanished shells lost without `classic.Stop`

PR #10 (branch `fix/fleet-skipped-hooks`), on top of `f516153`.

## Problem

Codex adversarial review, verified: with `lostShells` off (the PR's default), a background shell that ends
without fleet seeing its notification stays `running`. `liveCount > 0` makes `settle()` return early
(`register.tsx:146-148`), so the batch never closes and every later all-done toast, chime and Telegram
summary in the session is dropped; the 2 s agent poll never stops. Introduced by the PR on unmanaged
machines (classic.Stop was on by default); pre-existing on managed machines (classic.Stop never runs).

## Facts established (Claude Code 2.1.328, this machine, managed settings)

- Task notifications reach user-tier mods as `prompt.submit` with `origin.kind: "task-notification"`, idle and
  mid-turn; simultaneous finishes arrive as separate events (headless probe, 3 shells ending together).
- An outside kill (`kill <pid>`, not TaskStop) still produces a notification (`failed`, exit 144).
- `$.state` is held for the session and survives hot reloads only; fleet keeps nothing in `$.store`, so a
  restart starts empty: no stale shells from restarts.
- So a stale shell means a notification fleet did not see: one sent while fleet's hooks module was
  reloading, or one a plugin above fleet answered without `next`.
- A background shell's output file is held open (fds 1, 2) only by the shell's own processes (`bash -c`
  wrapper and its children), never by Claude Code; after they exit no process holds it.

## Change

1. `core.ts`: `heldArgv(files)` returns `["sh", "-c", SCRIPT, "sh", ...files]`. The script prints each
   given file that no process holds open; it uses `lsof -w -t` where present (same meaning on macOS
   and Linux; BusyBox's lsof ignores arguments and reads as held, which is safe), else `fuser -s`, and
   exits 2 when neither is on PATH. A file counts as free only when the tool exits 1 with nothing on
   stderr; a missing file or any error is unknown, not free. (Plan review.)
2. `register.tsx` `watchShells` (already runs every 5 s while a live shell has an output file): one
   `$.process.run(heldArgv(...))` for the live shells' files. Exit 0 with stdout listing free files is a
   reading; any other result (spawn error, exit 2, other code) is "unknown" and changes nothing.
   A shell is marked lost only when free on two consecutive polls (a module-variable set of ids free
   last time; a reload starts it over, costing one extra poll), giving a notification ≥5 s to win the
   race. Marking reuses `loseShells` (in-flight = every live shell except the twice-free ones), then
   `settle()`. A notification that arrives later still sets the real status (`endShell` accepts `lost`).
3. Remove the `lostShells` option and the `classic.Stop` hook added/gated in this PR: the poll replaces
   it on every machine, so no classic hook, no option, no warning. Shells with no output file (none
   parsed from the result) are not polled and stay as before.
4. Tests (`tests/fleet.test.tsx`): the script's argv text; a shell whose file is free on two polls is lost
   with no toast, then a later two-agent batch still gets its all-done toast (Codex's regression);
   free on one poll then held is not lost; exit 2 / spawn failure loses nothing; a late notification
   after lost sets the real status. Drop the two lostShells tests, keep the notification tests.
5. `verification/props/fleet.prop.test.ts`: run the script for real with `Bun.spawnSync` and a temp
   PATH of fake `fuser`/`lsof` (held / free / absent), plus a real held file (a `sleep` with stdout
   redirected to it) with the system lsof and fuser. Docker was not available: the script ran under
   the local dash (`/bin/sh`) and BusyBox `ash` instead.
6. README (how lost shells are found; drop the option row), CHANGELOG 0.6.0 rewritten, plugin.json
   option removed. Version stays 0.6.0 (unreleased).

## Verification

`claude plugin test plugins/fleet`, `claude plugin validate`, tsc against the 2.1.328 API,
`bun test props/fleet.prop.test.ts`; new tests made to fail once on the current branch; a headless run
on this machine with `--plugin-dir`: a background shell killed by PID while the notification is
dropped is not possible to stage from outside, so the real-environment check covers "no warnings, no
false lost marks while shells run and finish normally" (shell running >15 s stays live; its notification
ends it).

## Risks

- A shell whose processes all exit but whose daemonised grandchild keeps the inherited fd open stays
  live (as today).
- macOS `fuser` has no `-s`: the script must not read its failure as "free". Prefer `lsof` on Darwin or
  check `fuser` output, verified by the fake-PATH props test.
- One extra `sh` spawn per 5 s while shells run.
