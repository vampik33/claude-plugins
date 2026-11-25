# plan-renamer

Auto-rename Claude Code plan files from random names to meaningful titles.

Claude Code generates plan files with random three-word names like `scalable-moseying-papert.md`, while the actual title lives inside the file as `# Plan: <title>`. This makes plan files hard to find and identify.

`/rename-plans` renames every randomly-named plan file to a slug of the title inside it.

`scalable-moseying-papert.md` → `implement-auth-system.md`

## Installation

```bash
claude plugin install plan-renamer@vampik-plugins
```

## Usage

- `/rename-plans` renames at once, without asking, and prints a table of old name, new name and title
- The skill also triggers when you ask to rename or tidy plan files

## How It Works

1. Finds the plans directory: `plansDirectory` in `.claude/settings.local.json` or `.claude/settings.json`, then `./plans`, then `~/.claude/plans`
2. Picks the `.md` files with Claude Code's random three-word names (`^[a-z]+-[a-z]+-[a-z]+\.md$`)
3. Takes the title from the first `# Plan: ` or `# ` heading
4. Slugifies it (lowercase, non-alphanumerics become hyphens) and renames with `mv`; a taken name gets `-2`, `-3`

There is no automatic rename: the ExitPlanMode hook was removed in v1.2.0 because it broke the plan workflow.

## Configuration

No configuration required. The plugin detects the plans directory automatically.

## License

Apache-2.0. See [LICENSE](../../LICENSE).
