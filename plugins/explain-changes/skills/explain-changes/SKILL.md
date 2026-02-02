---
name: explain-changes
description: This skill should be used when the user asks to "explain changes", "explain what was done", "explain the diff", "describe modifications", "what did I change", "summarize changes", "explain my code changes", "review my changes", "what happened", "walk me through the changes", or needs detailed explanation of git changes with educational insights.
version: 1.0.0
---

# Explain Changes Skill

Transform git diffs into meaningful explanations covering what changed, why, and what it means.

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
- **Why** - Inferred motivation and intent
- **Impact** - Effects on codebase behavior

### 3. Add Educational Insights

Use `★ Insight` blocks for:
- Design patterns demonstrated
- Best practices followed or violated
- Architectural decisions
- Trade-offs made

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

## Guidelines

- **Be specific** - Reference exact file names, line numbers, function names
- **Infer intent** - Understand the goal, not just mechanical changes
- **Stay focused** - Explain actual changes, don't speculate about improvements
- **Distinguish staged/unstaged** - When relevant, note what's ready to commit
