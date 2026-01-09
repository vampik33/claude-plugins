---
description: Execute a command in the specified worktree directory
argument-hint: "<branch-name> <command> [args...]"
skill: gtr
allowed-tools: Bash(git gtr *)
---

# Run Command in Worktree

Execute a shell command within the context of a worktree directory.

## Usage

```
/gtr:run <branch-name> <command> [args...]
```

## Process

1. Parse arguments from `$ARGUMENTS` - first arg is branch, rest is command
2. Execute: `git gtr run "$ARGUMENTS"`
3. Display output and exit status

**Caution**: This executes arbitrary shell commands. Be careful with destructive commands.

## Examples

- `/gtr:run feature npm test` - Run tests in worktree
- `/gtr:run feature npm run build` - Build in worktree
- `/gtr:run feature git status` - Check git status
- `/gtr:run feature "npm install && npm test"` - Chained commands
