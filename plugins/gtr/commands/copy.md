---
description: Copy/sync files to worktrees
argument-hint: "<target> [options] [-- patterns...]"
skill: gtr
allowed-tools: Bash(git gtr *)
---

# Copy Files to Worktrees

Copy or sync files from the main repository to worktrees.

## Usage

```
/gtr:copy <target> [options] [-- patterns...]
```

## Process

1. Parse arguments from `$ARGUMENTS` - target, flags, and patterns after `--`
2. Execute: `git gtr copy "$ARGUMENTS"`
3. Report copied files

**Important**: File patterns must be preceded by `--` separator.

## Examples

- `/gtr:copy feature -- ".env*" "*.json"` - Copy env and json files
- `/gtr:copy -a -- ".env*"` - Copy env files to all worktrees
- `/gtr:copy feature --dry-run -- "*.config.js"` - Preview copy
