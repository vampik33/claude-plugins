---
description: Get worktree path for navigation
argument-hint: "<branch-name>"
skill: gtr
allowed-tools: Bash(git gtr *)
---

# Get Worktree Path

Get the path to a worktree for navigation purposes.

**Note**: This prints the path. It cannot change your shell's directory - use the path in your terminal.

## Usage

```
/gtr:go <branch-name>
```

## Process

1. Parse branch name from `$ARGUMENTS`
2. Execute: `git gtr go "$ARGUMENTS"`
3. Provide copy-paste ready navigation command

## Shell Navigation

```bash
cd "$(git gtr go <branch-name>)"
```

## Examples

- `/gtr:go feature-auth` - Get path to feature worktree
