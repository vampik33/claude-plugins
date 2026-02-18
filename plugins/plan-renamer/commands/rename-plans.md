---
description: Rename plan files to meaningful names based on their content
allowed-tools: ["Bash", "Read"]
skill: plan-renamer
---

## Context

- Project directory: `$CLAUDE_PROJECT_DIR`

## Task

Batch-rename plan files from random generated names to meaningful titles.

### 1. Find the plans directory

Check in order:
1. `plansDirectory` in `.claude/settings.local.json` or `.claude/settings.json`
2. `$CLAUDE_PROJECT_DIR/plans`
3. `~/.claude/plans`

### 2. Identify random-named files

Find `.md` files matching the pattern `^[a-z]+-[a-z]+-[a-z]+\.md$` (three lowercase words joined by hyphens — Claude Code's default naming).

### 3. Extract titles

Read the first line of each file. Extract the title after `# Plan: ` or `# `.

### 4. Execute renames

Rename each file immediately using Bash `mv` without asking for confirmation. Handle collisions by appending `-2`, `-3`, etc.

After all renames are complete, show a summary table of what was renamed:

```
| Old Name | New Name | Title |
|---|---|---|
| scalable-moseying-papert.md | implement-auth-system.md | Implement Auth System |
```

### Edge Cases

- Skip files where title extraction fails
- Skip files where the new name equals the old name
- Report files that couldn't be renamed
