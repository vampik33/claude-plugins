---
name: plan-renamer
description: This skill should be used when the user asks to "rename plans", "fix plan names", "rename plan files", "clean up plan names", "organize plans", "give plans better names", or wants to rename randomly-named plan files (like scalable-moseying-papert.md) to meaningful slugified titles extracted from the file content.
version: 1.0.0
---

# Plan Renamer Skill

Rename plan files from Claude Code's random generated names (like `scalable-moseying-papert.md`) to meaningful slugified titles extracted from the file content.

## Automatic Behavior

The plugin automatically renames plan files when ExitPlanMode is used. The PostToolUse hook extracts the `# Plan: <title>` from the file and renames it to a slugified version.

## Manual Command

Use `/rename-plans` to batch-rename existing random-named plan files.

## Naming Rules

- Title extracted from first `# Plan: ` or `# ` heading
- Slugified: lowercase, non-alphanumeric chars replaced with hyphens
- Truncated to 80 characters
- Collisions handled with `-2`, `-3` suffixes

## Troubleshooting

Set `PLAN_RENAMER_DEBUG=1` environment variable to see detailed logs in stderr, including plans directory detection, candidate file selection, and rename operations.
