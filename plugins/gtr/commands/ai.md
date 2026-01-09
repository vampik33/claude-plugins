---
description: Launch AI coding tool (Claude Code, Aider, etc.) in a worktree
argument-hint: "<branch-name> [--ai <tool>]"
skill: gtr
allowed-tools: Bash(git gtr *)
---

# Launch AI Tool in Worktree

Launch an AI coding tool in the specified worktree directory.

## Usage

```
/gtr:ai <branch-name> [--ai <tool>]
```

## Process

1. Parse arguments from `$ARGUMENTS` - branch name and optional `--ai` flag
2. Verify worktree exists with `git gtr list`
3. Execute: `git gtr ai "$ARGUMENTS"`

**Nested Claude Warning**: If running from within Claude Code with default AI tool `claude`, this will spawn a nested instance which may break TTY/input. Consider `--ai aider` or use a separate terminal.

## Examples

- `/gtr:ai feature-auth` - Launch default AI tool
- `/gtr:ai feature --ai aider` - Launch Aider specifically
