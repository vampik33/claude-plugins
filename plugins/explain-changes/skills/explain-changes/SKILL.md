---
name: explain-changes
description: Explain git diffs and code changes with educational insights — what changed, why, and what it means. Use this skill whenever a user wants to understand recent modifications to their codebase, whether staged, unstaged, committed, or across branches. This is different from code review — it explains changes rather than judging them. Trigger on phrases like "explain changes", "what did I change", "walk me through the diff", "describe modifications", "summarize what was done", "what happened in this branch". Also trigger when users seem confused about what happened or want to understand someone else's changes.
---

# Explain Changes Skill

Transform git diffs into meaningful explanations covering what changed, why, and what it means.

## Getting the Diff

When invoked via the `/explain` command, the command handles argument parsing and git commands. When invoked standalone (e.g., user says "explain what changed" mid-conversation), obtain the diff yourself:

1. Run `git status --short` to see the current state
2. Run the appropriate `git diff` variant — see `references/git-commands.md` for the command table, untracked file handling, and binary file guidance

## Process

### 1. Categorize Changes

Group by type:
- **Feature** - New functionality
- **Bug fix** - Behavior corrections
- **Refactor** - Restructuring without behavior change
- **Config** - Settings, dependencies, build
- **Docs** - Comments, READMEs
- **Tests** - Test additions/modifications

### 2. Explain Each Group

For each category:
- **What changed** - Specific files, functions, logic
- **Why** - Inferred motivation and intent (see "Inferring Intent" below)
- **Impact** - Effects on codebase behavior

### 3. Add Educational Insights

Include `★ Insight` blocks when the change demonstrates a non-obvious pattern, makes an interesting trade-off, or teaches something a mid-level developer might not know. Skip insights for routine changes — not every file rename or version bump needs one. One good insight is better than three filler ones.

Good candidates for insights:
- Design patterns demonstrated
- Best practices followed or violated
- Architectural decisions and their trade-offs
- Subtle gotchas the change avoids or introduces

## Inferring Intent

The "why" is the hardest and most valuable part of an explanation. Use these strategies in order:

1. **Commit messages** - If explaining committed changes, the commit message is the most direct signal of intent
2. **PR/issue references** - Look for issue numbers, ticket IDs, or PR descriptions in commit messages
3. **Code context** - Naming patterns, comments, and surrounding code often reveal purpose (e.g., a function renamed from `getUser` to `getUserOrThrow` signals error-handling intent)
4. **Change shape** - The pattern of modifications hints at goals: adding validation across multiple endpoints suggests a security hardening effort; extracting repeated code into a helper suggests a DRY refactor
5. **Be honest about uncertainty** - When intent is genuinely unclear, say "The motivation isn't obvious from the diff alone" rather than fabricating a plausible-sounding explanation. A wrong "why" is worse than an honest "unclear"

## Handling Large Diffs

For diffs spanning 20+ files or 500+ lines:

1. **Start with a high-level summary** - "This changeset touches N files across M areas of the codebase"
2. **Group by area/module** rather than listing every file individually
3. **Prioritize significant changes** - Focus detailed explanation on logic changes; mention config/formatting changes briefly
4. **Call out the core change** - Often a large diff has one or two key changes with many follow-on modifications. Identify and explain the core change first, then explain the ripple effects.

## Output Format

```markdown
## Changes Explanation

[1-2 sentence summary]

### [Category]: [Title]

**What changed:**
- [Specific change with file/function names]

**Why:**
[Motivation and intent]

`★ Insight ─────────────────────────────────────`
[Educational points about patterns or practices]
`─────────────────────────────────────────────────`

## Summary

[Overall summary and important notes]
```

For output quality reference, see `references/examples.md`.

## Guidelines

- **Be specific** - Reference exact file names, line numbers, function names
- **Infer intent thoughtfully** - Use the strategies above; don't guess
- **Stay focused** - Explain actual changes, don't speculate about improvements
- **Distinguish staged/unstaged** - When relevant, note what's ready to commit
- **Scale your depth** - Small diffs get detailed line-by-line treatment; large diffs (20+ files or 500+ lines) get grouped high-level summaries with deep-dives on the important parts
