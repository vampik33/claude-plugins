---
description: Open a worktree in configured editor (VS Code, Cursor, Zed)
argument-hint: "<branch-name> [--editor <name>]"
skill: gtr
allowed-tools: Bash(git gtr *)
---

# Open Worktree in Editor

Open a worktree directory in the configured code editor.

## Usage

```
/gtr:editor <branch-name> [--editor <name>]
```

## Process

1. Parse arguments from `$ARGUMENTS` - branch name and optional `--editor` flag
2. Verify worktree exists with `git gtr list`
3. Execute: `git gtr editor "$ARGUMENTS"`

## Examples

- `/gtr:editor feature-auth` - Open in default editor
- `/gtr:editor feature --editor vscode` - Open in VS Code
