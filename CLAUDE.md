# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a **Claude Code Plugin Marketplace** - a collection of plugins that extend Claude Code functionality. The repository hosts a marketplace manifest and individual plugins that users can install via `/plugin marketplace add vampik33/claude-plugins`.

## Repository Structure

```
claude-plugins/
├── .claude-plugin/marketplace.json   # Marketplace manifest (lists all plugins)
└── plugins/
    ├── gtr/                          # Git worktree runner plugin
    └── telegram/                     # Telegram notification plugin
```

## Plugin Architecture

Each plugin in `plugins/<name>/` follows this structure:

```
<plugin>/
├── .claude-plugin/plugin.json        # Plugin manifest (name, version, description)
├── commands/                         # Slash commands (markdown with YAML frontmatter)
├── hooks/                            # Event hooks (hooks.json + scripts/)
│   ├── hooks.json                    # Hook definitions
│   └── scripts/                      # Hook implementation scripts
│       └── lib/                      # Shared shell libraries
├── skills/                           # Skills with references/examples
└── README.md
```

### Command Frontmatter

Commands use YAML frontmatter for metadata:

```yaml
---
description: Brief description shown in /help
argument-hint: "<required> [optional]"
skill: related-skill-name
allowed-tools: ["Bash", "Read"]       # Array syntax
allowed-tools: Bash(git gtr *)        # Pattern syntax (tool + glob)
---
```

### Hook Events

Available hook events: `PreToolUse`, `PostToolUse`, `PermissionRequest`, `UserPromptSubmit`, `SessionStart`, `SessionEnd`, `Stop`, `SubagentStop`, `PreCompact`, `Notification`

Hook scripts receive context via environment variables: `CLAUDE_PLUGIN_ROOT`, `CLAUDE_PROJECT_DIR`, `CLAUDE_ENV_FILE`

## Development Conventions

### Shell Scripts

- Use `set -euo pipefail` at the top
- Debug mode via `<PLUGIN>_DEBUG=1` environment variable
- Extract shared logic into `hooks/scripts/lib/` libraries

### Configuration Pattern

Plugins use markdown files with YAML frontmatter for user configuration:
- User-level: `~/.claude/<plugin>.local.md`
- Project-level: `.claude/<plugin>.local.md`

Resolution order: project > user > defaults

### Versioning

- Semantic versioning in `plugin.json`
- CHANGELOG.md following Keep a Changelog format

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
     "source": "./plugins/<name>",
     "category": "Category Name"
   }
   ```

3. Add commands in `commands/<command>.md` with appropriate frontmatter

4. Create `plugins/<name>/CHANGELOG.md` with initial entry

## Updating a Plugin

When releasing plugin changes:

1. **Update version in both locations** (must match):
   - `plugins/<name>/.claude-plugin/plugin.json` - the `version` field
   - `.claude-plugin/marketplace.json` - the plugin's `version` field

2. **Update CHANGELOG.md** in the plugin directory:
   - Add new version section with date
   - Document changes under: Added, Changed, Fixed, Removed

## Testing Plugins Locally

```bash
claude --plugin-dir /path/to/claude-plugins/plugins/<plugin-name>
```
