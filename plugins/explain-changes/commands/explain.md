---
skill: explain-changes
allowed-tools: Bash(git *), Read
description: Explain code changes in detail - what was done and why
argument-hint: "[file...] [--staged] [--unstaged] [--commits N]"
---

## Context

- Git status: !`git status --short`
- Branch: !`git branch --show-current`
- Recent commits: !`git log --oneline -5 2>/dev/null || echo "No commits yet"`
- Arguments: `$ARGUMENTS`

## Arguments

Parse `$ARGUMENTS`:

- `(none)` - All changes (staged + unstaged + untracked)
- `--staged` - Staged changes only
- `--unstaged` - Unstaged changes only
- `--commits N` - Last N commits (default: 1)
- `<file>...` - Changes to specific files

Flags can combine with paths: `/explain --staged src/main.ts`

## Execution

Run the appropriate git diff based on parsed arguments:

| Scope | Command |
|-------|---------|
| All changes | `git diff HEAD` |
| Staged only | `git diff --cached` |
| Unstaged only | `git diff` |
| Specific files | append `-- <paths>` to any above |

For `--commits N`, flag combinations, untracked file handling, and binary file guidance, see `references/git-commands.md` (in the explain-changes skill).

Run `--stat` first for summary, then full diff for analysis.

## Analysis

Follow the explain-changes skill guidelines to produce output covering:

1. **What changed** - Files and modifications (functions, logic, config)
2. **Why** - Inferred intent and motivation (use the skill's inference strategies)
3. **Impact** - Breaking changes, dependencies, behavior changes
4. **Insights** - Patterns, best practices, architectural decisions (only when non-trivial)

## Edge Cases

- No changes: "No changes detected. Working tree is clean."
- Staged only: Note these are ready to commit
- Unstaged only: Note these need staging
- Untracked only: Note these are new files not yet tracked by git
- `--commits N` with commit count <= N: Use `git rev-list --count HEAD` to check; explain all commits from the beginning (diff root commit to `HEAD`) instead of using `HEAD~N`
- `--staged --unstaged` together: Treat as default (all changes)
- Binary files: Note the change, infer from filename/context, don't read contents
- Not a git repo: Report appropriately
- File has no changes: Report for that specific file
- Very large diff (20+ files): Group by area, prioritize significant changes
