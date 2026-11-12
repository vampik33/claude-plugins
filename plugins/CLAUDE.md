# plugins/ CLAUDE.md

## Mods (function-hook plugins)

big-picture, codex-review, continuity, fix-findings, fleet, memory-watch, palette, prompt-clock, ship and watchdog are TypeScript mods, not shell hooks.

- Check: `claude plugin validate <dir>` and `claude plugin test <dir>`; `tsc -p <dir>` once the engine has loaded the mod (it lays `.claude-plugin/types/`, gitignored)
- Type files in `<mod>/.claude-plugin/types/` are from whichever build last loaded the mod (its header says which); a fresh `tsc -p` can pass on old types, so also check against the current build's `claude-code.d.ts`, which the plugin-authoring skill writes when it loads
- Installed mods run from the GitHub copy: after pushing, `claude plugin marketplace update vampik-plugins`, then `claude plugin update <mod>@vampik-plugins`, then restart
- A function that takes `$` must be top-level (the validator refuses closures)
- A mod that draws in the AbovePrompt band copies `hooks/stack.ts` and returns `<Box key={STACK} flexDirection="column" marginTop={1}>{stackRows(below, row)}</Box>` with its row keyed `band:<NN>-<mod>`, `NN` its slot top to bottom (memory-watch 10, big-picture 20, ship 30, watchdog 40, codex-review 50, fleet 60; `band-top:`/`band-bottom:` pin a row, continuity is `band-bottom:`); add it to `MODS` in `verification/props/band-stack.prop.test.ts`
- Helpers are copied per mod, not shared: each mod installs alone
- New mod: add it to the hardcoded `for mod in …` loop in `verification/run.sh`, and add `verification/props/<mod>.prop.test.ts` for pure functions in its `core.ts`

Mod gotchas:
- Module variables reset on every hot reload; anything that must survive goes in `$.state` and is restored in `session.start` (timers re-armed there too)
- `/clear` fires `session.end` with `reason: 'clear'` and no `session.start` after it; reset session-scoped state there
- Render hooks can't write `$.state`: keep values like `e.viewport.isFullscreen` in a module variable; open a pane unasked only when it is `true`
- `$.session.compact` is refused inside a `command.run` hook; defer it with `$.clock.after(0, …)`
- `classic.*`, `session.compact` and `skill.prompt` hooks don't run where an organization manages Claude Code; say so in the mod's README
- Tests: loop UI mounts over `['terminal','desktop'] as const`; use `$.clock.now()` (not `Date.now()`) so the mocked clock applies; fire `session.start` again on the same state to simulate a reload
- Mod `.tsx` files aren't prettier-clean, so the format-on-save hook reflows unrelated lines; revert that churn to keep diffs surgical
- Some `core.ts`/`ttl.ts` functions (fleet `trim`/`applyStatuses`/`endShell`, codex-review `trimJobs`, continuity `decideTtl`/`observeTtl`, prompt-clock `turnEnd`/`cap`) have Lean models in `verification/lean/Plugins/`: change the behaviour and update the model and proofs too. `diff.lean.test.ts` fails when they drift, and `run.sh` rejects `sorry`.
- A `core.ts` function that returns a shell script (big-picture `openArgv`, watchdog's scan scripts) is tested twice: its text in `tests/*.test.tsx`, its behaviour run for real in `verification/props/<mod>.prop.test.ts` with `Bun.spawnSync(argv, { env: { PATH: dir } })`, `dir` a temp dir holding symlinked tools and fake commands. Change the script, update both. For POSIX `sh` portability, rerun it under `debian:stable-slim` (`dash`) and `busybox:stable` in docker.

## Conventions

### Shell Scripts (hooks)

- Start with `set -euo pipefail`
- Debug mode via `<PLUGIN>_DEBUG=1` environment variable
- Extract shared logic into `hooks/scripts/lib/`
- Read hook input via `HOOK_INPUT=$(cat)` before sourcing libraries
