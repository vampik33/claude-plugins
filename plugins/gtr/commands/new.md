---
description: Create a new git worktree for parallel branch development
argument-hint: "<branch-name> [options]"
skill: gtr
allowed-tools: Bash(git gtr *)
---

# Create New Worktree

Create a new git worktree using git-worktree-runner.

## Usage

```
/gtr:new <branch-name> [options]
```

## Process

1. Parse arguments from `$ARGUMENTS` - branch name and optional flags
2. Execute: `git gtr new "$ARGUMENTS"`
3. Report result and suggest next steps: `/gtr:editor` or `/gtr:ai`

## Examples

- `/gtr:new feature-auth` - Create worktree for new feature
- `/gtr:new feature --force --name backend` - Custom name
- `/gtr:new hotfix --yes --no-copy` - Quick non-interactive
