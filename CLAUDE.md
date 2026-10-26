# CLAUDE.md

Claude Code Plugin Marketplace (`vampik-plugins`) — add with `/plugin marketplace add vampik33/claude-plugins`, then `/plugin install <name>@vampik-plugins`.

## Testing Locally

```bash
claude --plugin-dir /path/to/claude-plugins/plugins/<plugin-name>
```

All checks (Lean proofs, property + differential tests, mod tests, telegram-notifier shellcheck + bats): `verification/run.sh`. See `verification/README.md`.

One target: `claude plugin test plugins/<mod>`; `(cd verification && bun test props/<mod>)`; `bats plugins/telegram-notifier/tests`.

## Repository Structure

```
claude-plugins/
├── .claude-plugin/marketplace.json   # Marketplace manifest (all plugins)
├── .claude/                          # Local Claude state (gitignored)
├── plans/                            # Implementation plans from Claude sessions
├── verification/                     # lean/ models+proofs; props/*.prop|fv|diff tests (bun); run.sh
└── plugins/
    ├── big-picture/                  # Mod: Jev-gated live HTML summary of big work, in an Orca tab
    ├── claudemd-gen/                 # CLAUDE.md generator and auditor
    ├── codex-review/                 # Mod: background Codex reviews, findings pane, CodexReview tool
    ├── continuity/                   # Mod: context gauge + cache timer, handover + compact + continue
    ├── explain-changes/              # Git diff explainer with educational insights
    ├── fleet/                        # Mod: agents / shells / worktrees pane with alerts
    ├── gtr/                          # Git worktree management (wraps git-worktree-runner)
    ├── memory-watch/                 # Mod: pane summarizing auto-memory writes
    ├── palette/                      # Mod: clickable agents / skills / commands pane
    ├── plan-renamer/                 # Rename plan files to meaningful titles
    ├── prompt-clock/                 # Mod: send times on prompts and turn lines
    ├── ship/                         # Mod: unshipped commits + stale installed mods; /ship pushes and updates
    ├── telegram-notifier/            # Telegram session notifications (has hooks)
    └── watchdog/                     # Mod: stops stuck Bash commands (no output, no CPU), tells the model
```

## Plugin Architecture

Each plugin in `plugins/<name>/` follows this structure:

```
<plugin>/
├── .claude-plugin/plugin.json        # Plugin manifest (name, version, description)
├── agents/                           # Autonomous subagents — optional
├── commands/                         # Slash commands (markdown + YAML frontmatter)
├── hooks/                            # Event hooks (hooks.json + scripts/) — optional
│   └── scripts/lib/                  # Shared shell libraries
├── skills/<skill-name>/              # Skills with progressive disclosure
│   ├── SKILL.md                      # Always loaded (concise)
│   ├── references/                   # Loaded on demand (detailed guidance)
│   └── examples/                     # Loaded for specific scenarios
├── CHANGELOG.md
└── README.md
```

## Mods (function-hook plugins)

big-picture, codex-review, continuity, fleet, memory-watch, palette, prompt-clock, ship and watchdog are TypeScript mods, not shell hooks:

```
<mod>/
├── .claude-plugin/plugin.json        # + "types" (and "userConfig" if configurable)
├── hooks/hooks.json                  # { "modules": ["./register.tsx"] }
├── hooks/register.tsx                # register(on, options); pure logic in core.ts
├── types/index.d.ts                  # $.state contract (PluginState)
└── tests/*.test.tsx                  # claude plugin test <dir>
```

- Check: `claude plugin validate <dir>` and `claude plugin test <dir>`; `tsc -p <dir>` once the engine has loaded the mod (it lays `.claude-plugin/types/`, gitignored)
- Type files in `<mod>/.claude-plugin/types/` are from whichever build last loaded the mod (its header says which); a fresh `tsc -p` can pass on old types, so also check against the current build's `claude-code.d.ts`, which the plugin-authoring skill writes when it loads
- Installed mods run from the GitHub copy: after pushing, `claude plugin marketplace update vampik-plugins`, then `claude plugin update <mod>@vampik-plugins`, then restart
- A function that takes `$` must be top-level (the validator refuses closures)
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

## Conventions

### Shell Scripts (hooks)

- Start with `set -euo pipefail`
- Debug mode via `<PLUGIN>_DEBUG=1` environment variable
- Extract shared logic into `hooks/scripts/lib/`
- Read hook input via `HOOK_INPUT=$(cat)` before sourcing libraries

### Plugin Configuration

Use markdown files with YAML frontmatter for user-facing config:
- User-level: `~/.claude/<plugin>.local.md`
- Project-level: `.claude/<plugin>.local.md`
- Resolution: project > user > defaults

### Versioning

- Semantic versioning in `plugin.json`
- CHANGELOG.md following [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format
- Commit messages: `type(plugin-name): description (vX.Y.Z)` (conventional commits; the version suffix is the bumped plugin version)

## Adding a New Plugin

1. Create `plugins/<name>/.claude-plugin/plugin.json`:
   ```json
   {
     "name": "<name>",
     "version": "1.0.0",
     "description": "What the plugin does",
     "author": { "name": "vampik33" }
   }
   ```

2. Register in `.claude-plugin/marketplace.json` under `plugins` array:
   ```json
   {
     "name": "<name>",
     "description": "What the plugin does",
     "version": "1.0.0",
     "author": { "name": "vampik33" },
     "source": "./plugins/<name>",
     "category": "Category Name",
     "keywords": ["relevant", "tags"],
     "homepage": "https://github.com/vampik33/claude-plugins"
   }
   ```

3. Add commands in `commands/<command>.md` with YAML frontmatter
4. Add `skills/<skill-name>/SKILL.md` with trigger description
5. Create `CHANGELOG.md` with initial entry

## Gotchas

- **Only telegram-notifier has shell hooks**: the mods' `hooks/` hold a TypeScript module instead; the other plugins are command+skill only
- **The `scripts/lib/` shared libraries are telegram-notifier-specific**: `config.sh`, `html.sh`, `session.sh`, `yaml.sh` live under telegram-notifier's hooks — they are not cross-plugin shared code
- **gtr has no CHANGELOG.md**: Unlike other plugins, gtr is missing its changelog

## Updating a Plugin

Update version in **both** locations (must match):
- `plugins/<name>/.claude-plugin/plugin.json` — the `version` field
- `.claude-plugin/marketplace.json` — the plugin's `version` field

Update `CHANGELOG.md` in the plugin directory:
- Add new version section with date
- Document changes under: Added, Changed, Fixed, Removed
