---
description: Remove a git worktree
argument-hint: "<branch-name> [options]"
skill: gtr
allowed-tools: Bash(git gtr *)
---

# Remove Worktree

Remove one or more git worktrees.

## Usage

```
/gtr:rm <branch-name> [options]
```

## Process

1. Parse arguments from `$ARGUMENTS` - branch/worktree name and flags
2. Execute: `git gtr rm "$ARGUMENTS"`
3. Report result; optionally show remaining worktrees

Note: Use `--yes` for non-interactive removal.

## Examples

- `/gtr:rm feature-auth` - Remove specific worktree
- `/gtr:rm feature --yes --delete-branch` - Remove and delete branch
- `/gtr:rm --all --yes` - Remove all worktrees
