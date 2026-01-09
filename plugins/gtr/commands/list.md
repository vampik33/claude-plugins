---
description: List all git worktrees in the current repository
skill: gtr
allowed-tools: Bash(git gtr *)
---

# List Worktrees

List all git worktrees for the current repository.

## Usage

```
/gtr:list [options]
```

## Process

1. Execute: `git gtr list`
2. Display results with paths, branches, and main worktree indicator

## Examples

- `/gtr:list` - Show all worktrees
- `/gtr:list --json` - JSON output for scripting
