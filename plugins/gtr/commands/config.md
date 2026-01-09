---
description: Configure git-worktree-runner settings
argument-hint: "[list|get|set|unset] [key] [value]"
skill: gtr
allowed-tools: Bash(git gtr *)
---

# Configure GTR Settings

Manage git-worktree-runner configuration.

## Usage

```
/gtr:config [list|get|set|unset] [key] [value]
```

## Process

1. Parse arguments from `$ARGUMENTS` - subcommand, key, and value
2. Execute: `git gtr config "$ARGUMENTS"`

## Subcommands

| Command | Description |
|---------|-------------|
| `list` | Show all configuration |
| `get <key>` | Get a configuration value |
| `set <key> <value>` | Set a configuration value |
| `unset <key>` | Remove a configuration value |

## Examples

- `/gtr:config list` - Show all settings
- `/gtr:config set gtr.editor.default cursor` - Set default editor
- `/gtr:config set gtr.ai.default claude` - Set default AI tool
- `/gtr:config set gtr.hook.postCreate "npm install"` - Auto-install deps
