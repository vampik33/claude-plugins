---
skill: explain-changes
allowed-tools: Bash(git *)
description: Explain code changes in detail - what was done and why
argument-hint: "[file...] [--staged] [--unstaged]"
---

## Context

- Git status: !`git status --short`
- Branch: !`git branch --show-current`
- Recent commits: !`git log --oneline -5 2>/dev/null || echo "No commits yet"`
- Arguments: `$ARGUMENTS`

## Arguments

Parse `$ARGUMENTS`:

- `(none)` - All changes (staged + unstaged)
- `--staged` - Staged changes only
- `--unstaged` - Unstaged changes only
- `<file>...` - Changes to specific files

Flags can combine with paths: `/explain --staged src/main.ts`

## Execution

Run the appropriate git diff based on arguments:

| Arguments | Command |
|-----------|---------|
| none | `git diff HEAD` |
| `--staged` | `git diff --cached` |
| `--unstaged` | `git diff` |
| with paths | append `-- <paths>` |

Run `--stat` first for summary, then full diff for analysis.

## Analysis

Follow the explain-changes skill guidelines to produce output covering:

1. **What changed** - Files and modifications (functions, logic, config)
2. **Why** - Inferred intent and motivation
3. **Impact** - Breaking changes, dependencies, behavior changes
4. **Insights** - Patterns, best practices, architectural decisions

## Edge Cases

- No changes: "No changes detected. Working tree is clean."
- Staged only: Note these are ready to commit
- Unstaged only: Note these need staging
- Not a git repo: Report appropriately
- File has no changes: Report for that specific file
