---
name: plan-renamer
description: Rename randomly-named plan files (like scalable-moseying-papert.md) to meaningful slugified titles extracted from file content. Use this skill when the user asks to "rename plans", "fix plan names", "rename plan files", "clean up plan names", "organize plans", "give plans better names", "my plans folder is a mess", "I can't find my plans", or wants better names for Claude Code's auto-generated plan files. Also trigger when the user mentions random-looking plan filenames or wants to batch-organize their plans directory.
---

# Plan Renamer Skill

Rename plan files from Claude Code's random generated names (like `scalable-moseying-papert.md`) to meaningful slugified titles extracted from the file content.

## Usage

Use `/rename-plans` to batch-rename existing random-named plan files. The command finds plan files with Claude Code's default random names (like `scalable-moseying-papert.md`), extracts the title, and renames them via shell `mv`.

## Naming Rules

- Title extracted from first `# Plan: ` or `# ` heading
- Slugified: lowercase, non-alphanumeric chars replaced with hyphens
- Collisions handled with `-2`, `-3` suffixes

## Output

After renaming, a summary table is displayed:

```
| Old Name | New Name | Title |
|---|---|---|
| scalable-moseying-papert.md | implement-auth-system.md | Implement Auth System |
| brave-curious-turing.md | fix-login-timeout.md | Fix Login Timeout |
```

## Troubleshooting

Set `PLAN_RENAMER_DEBUG=1` environment variable to see detailed logs in stderr, including plans directory detection, candidate file selection, and rename operations.
