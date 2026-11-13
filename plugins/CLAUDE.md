# plugins/ CLAUDE.md

## Mods (function-hook plugins)

big-picture, chat-view, codex-review, continuity, effort-pilot, fix-findings, fleet, memory-watch, palette, ship and watchdog are TypeScript mods, not shell hooks.

- Check: `claude plugin validate <dir>` and `claude plugin test <dir>`; `tsc -p <dir>` once the engine has loaded the mod (it lays `.claude-plugin/types/`, gitignored)
- Type files in `<mod>/.claude-plugin/types/` are from whichever build last loaded the mod (its header says which); a fresh `tsc -p` can pass on old types, so also check against the current build's `claude-code.d.ts`, which the plugin-authoring skill writes when it loads
- Installed mods run from the GitHub copy: after pushing, `claude plugin marketplace update vampik-plugins`, then `claude plugin update <mod>@vampik-plugins`, then restart
- A function that takes `$` must be top-level (the validator refuses closures)
- A mod that draws in the AbovePrompt band returns `<Box flexDirection="column">{below}{row}</Box>`, `below` being `await next(e)` and its row keyed `band:<mod>`, with no `marginTop`. The engine hands `next(e)` back as an opaque `{ type: "engine" }` node, never another mod's tree, and stacks each mod's tree as a separate part in hook order. So a mod cannot merge rows across mods, and a `marginTop` puts a blank row between mods' lines. To reorder, hook `ui.render` on `AbovePromptList` and pass `next` its `e.props.rows` reordered (codex-review, continuity and effort-pilot each apply the same idempotent `bandOrder` from their `core.ts`, so the band ends codex, ctx, effort whichever runs first); in tests the kit stacks that list itself, so assert the order on `ui.drawn()`'s children, not in a test `ui.render` hook. In tests, a mod's part is the drawn child whose `part.plugin` is the mod
- Helpers are copied per mod, not shared: each mod installs alone
- New mod: add it to the hardcoded `for mod in …` loop in `verification/run.sh`, and add `verification/props/<mod>.prop.test.ts` for pure functions in its `core.ts`

Mod gotchas:
- Module variables reset on every hot reload; anything that must survive goes in `$.state` and is restored in `session.start` (timers re-armed there too)
- `/clear` fires `session.end` with `reason: 'clear'` and no `session.start` after it; reset session-scoped state there
- A prompt typed mid-turn fires `prompt.submit` at once (with the running turn's `e.turnId`), then queues: make per-turn decisions in `turn.start` and key them by its `turnId`
- Render hooks can't write `$.state`: keep values like `e.viewport.isFullscreen` in a module variable; open a pane unasked only when it is `true`
- `$.session.compact` is refused inside a `command.run` hook; defer it with `$.clock.after(0, …)`
- `classic.*`, `session.compact` and `skill.prompt` hooks don't run where an organization manages Claude Code; say so in the mod's README
- Tests: loop UI mounts over `['terminal','desktop'] as const`; use `$.clock.now()` (not `Date.now()`) so the mocked clock applies; fire `session.start` again on the same state to simulate a reload
- Desktop surface: a proportional font (`█░` reads as a hatched strip, space-padded columns drift) and native Buttons that show a `hotkey` as a badge. Draw a bar there as an `Svg` from the hook, since `Client` modules have no `Svg` (`ClientElements` is the terminal's table less `Client`/`Raster`/`Image`)
- A `Client`'s `surface.every` ticks on real time, not `mock.clock`: assert a Client's text at mount, don't advance the clock to see it move
- See the real band, which tests don't paint: `tmux new-session -d -s probe -x 140 -y 40 -c "$PWD" 'claude --plugin-dir <mod dir>'`, then `tmux capture-pane -p -t probe` and `tmux kill-session -t probe`; installed mods load too, so name the working copies with `--plugin-dir`
- When a render test breaks after a Claude Code update, print `JSON.stringify(await ui.drawn())` from a throwaway `tests/zz-probe.test.tsx` (delete it after) to see the shape the engine now hands back, before changing a mod
- Mod `.tsx` files aren't prettier-clean, so the format-on-save hook reflows unrelated lines; revert that churn to keep diffs surgical
- Some `core.ts`/`ttl.ts` functions (fleet `trim`/`applyStatuses`/`endShell`, codex-review `trimJobs`, continuity `decideTtl`/`observeTtl`, chat-view `turnEnd`/`cap`, Lean module still `PromptClock`) have Lean models in `verification/lean/Plugins/`: change the behaviour and update the model and proofs too. `diff.lean.test.ts` fails when they drift, and `run.sh` rejects `sorry`.
- A `core.ts` function that returns a shell script (big-picture `openArgv`, watchdog's scan scripts) is tested twice: its text in `tests/*.test.tsx`, its behaviour run for real in `verification/props/<mod>.prop.test.ts` with `Bun.spawnSync(argv, { env: { PATH: dir } })`, `dir` a temp dir holding symlinked tools and fake commands. Change the script, update both. For POSIX `sh` portability, rerun it under `debian:stable-slim` (`dash`) and `busybox:stable` in docker.

## Conventions

### Shell Scripts (hooks)

- Start with `set -euo pipefail`
- Debug mode via `<PLUGIN>_DEBUG=1` environment variable
- Extract shared logic into `hooks/scripts/lib/`
- Read hook input via `HOOK_INPUT=$(cat)` before sourcing libraries
