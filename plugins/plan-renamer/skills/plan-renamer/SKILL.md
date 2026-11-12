---
name: plan-renamer
description: Rename Claude Code's randomly-named plan files (three-word names like scalable-moseying-papert.md) to slugified titles taken from their content. Use when the user wants plan files renamed, tidied or made easier to find, or mentions random-looking plan file names.
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
