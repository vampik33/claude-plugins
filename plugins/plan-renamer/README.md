# Plan Renamer

Auto-rename Claude Code plan files from random names to meaningful titles.

## Problem

Claude Code generates plan files with random three-word names like `scalable-moseying-papert.md`, while the actual title lives inside the file as `# Plan: <title>`. This makes plan files hard to find and identify.

## Solution

A PostToolUse hook on ExitPlanMode that automatically renames the plan file to match its content title.

`scalable-moseying-papert.md` → `implement-auth-system.md`

## Installation

```bash
claude plugin add vampik33/claude-plugins/plan-renamer
```

## How It Works

1. Hook fires after ExitPlanMode completes
2. Finds the plans directory (checks settings, then `./plans`, then `~/.claude/plans`)
3. Locates the most recently modified random-named `.md` file
4. Extracts the title from the first `# Plan: ` heading
5. Slugifies the title and renames the file

## Commands

- `/rename-plans` — Batch-rename existing random-named plan files

## Configuration

No configuration required. The plugin detects the plans directory automatically.

### Debug Mode

Set `PLAN_RENAMER_DEBUG=1` to see detailed logs in stderr.
