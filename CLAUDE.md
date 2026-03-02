# CLAUDE.md

Claude Code Plugin Marketplace — a collection of plugins installable via `claude plugin add vampik33/claude-plugins`.

## Testing Locally

```bash
claude --plugin-dir /path/to/claude-plugins/plugins/<plugin-name>
```

## Repository Structure

```
claude-plugins/
├── .claude-plugin/marketplace.json   # Marketplace manifest (all plugins)
├── .claude/                          # Project-level Claude config
├── plans/                            # Implementation plans from Claude sessions
└── plugins/
    ├── claudemd-gen/                 # CLAUDE.md generator and auditor
    ├── explain-changes/              # Git diff explainer with educational insights
    ├── gtr/                          # Git worktree management (wraps git-worktree-runner)
    ├── plan-renamer/                 # Rename plan files to meaningful titles
    └── telegram/                     # Telegram session notifications (has hooks)
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
- Commit messages: `type(plugin-name): description` (conventional commits)

## Adding a New Plugin

1. Create `plugins/<name>/.claude-plugin/plugin.json`:
   ```json
   {
     "name": "<name>",
     "version": "1.0.0",
     "description": "What the plugin does"
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

- **Version sync is mandatory**: `plugin.json` and `marketplace.json` versions must match exactly — easy to forget one
- **Only telegram has hooks**: All other plugins are command+skill only; the `hooks/` directory pattern in the architecture template is optional
- **The `scripts/lib/` shared libraries are telegram-specific**: `config.sh`, `session.sh`, `yaml.sh` live under telegram's hooks — they are not cross-plugin shared code
- **gtr has no CHANGELOG.md**: Unlike other plugins, gtr is missing its changelog

## Updating a Plugin

Update version in **both** locations (must match):
- `plugins/<name>/.claude-plugin/plugin.json` — the `version` field
- `.claude-plugin/marketplace.json` — the plugin's `version` field

Update `CHANGELOG.md` in the plugin directory:
- Add new version section with date
- Document changes under: Added, Changed, Fixed, Removed
