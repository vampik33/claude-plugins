---
skill: claudemd-gen
allowed-tools: ["Read", "Write", "Edit", "Glob", "Grep", "Bash", "AskUserQuestion"]
description: Generate, audit, or improve CLAUDE.md files with best practices
argument-hint: "[--audit] [--rules] [--local] [--full]"
---

## Context

- Project root: !`pwd`
- Git status: !`git status --short 2>/dev/null | head -20 || echo "Not a git repo"`
- Language files: !`ls -1 package.json Cargo.toml pyproject.toml go.mod build.gradle pom.xml mix.exs Gemfile Makefile deno.json composer.json 2>/dev/null || echo "No manifest files found"`
- Source directories: !`ls -1d src/ lib/ app/ pkg/ internal/ cmd/ packages/ apps/ crates/ modules/ 2>/dev/null || echo "No standard source dirs"`
- Existing CLAUDE.md: !`head -30 CLAUDE.md 2>/dev/null || echo "No CLAUDE.md found"`
- Existing rules: !`ls -1 .claude/rules/*.md 2>/dev/null || echo "No .claude/rules/ found"`
- Existing local: !`head -10 CLAUDE.local.md 2>/dev/null || echo "No CLAUDE.local.md found"`
- Arguments: `$ARGUMENTS`

## Mode Selection

Parse `$ARGUMENTS` to determine mode:

| Argument | Mode | Action |
|----------|------|--------|
| (none) | **Generate** | Create or improve CLAUDE.md |
| `--audit` | **Audit** | Review existing CLAUDE.md against best practices |
| `--rules` | **Rules** | Generate .claude/rules/ structure |
| `--local` | **Local** | Generate CLAUDE.local.md template |
| `--full` | **Full Setup** | Generate CLAUDE.md + rules + local |

## Mode: Generate (default)

### Step 1: Analyze Project

Use the dynamic context above plus additional exploration:
- Read package manifests (package.json, Cargo.toml, pyproject.toml, etc.)
- Check directory structure for architecture patterns
- Look for existing documentation (README.md, docs/)
- Detect monorepo patterns (workspaces, lerna, turborepo, nx)
- Identify test framework and patterns
- Check for existing CI/CD (.github/workflows/, .gitlab-ci.yml)

### Step 2: Choose Template

Based on analysis, select a template from `references/templates.md`:
- **Minimal** — Small project, <10 source files
- **Standard** — Typical single-package project
- **Monorepo** — Workspace-based with multiple packages

Use AskUserQuestion to confirm template choice and ask about any unclear conventions.

### Step 3: Draft CLAUDE.md

Fill the template with real values from the project:
- Actual build/test/lint commands from package manifests
- Real directory structure and entry points
- Detected conventions (from code patterns)
- Technology-specific considerations

Read the appropriate example file from `examples/` for the detected tech stack.

Consult `references/best-practices.md` to ensure the draft follows all guidelines:
- Imperative style, not descriptive
- Only 80%-rule content (skip obvious things)
- Reference existing docs, don't copy
- Specific and actionable, not vague

### Step 4: Review with User

Present the draft CLAUDE.md and use AskUserQuestion to ask:
- "Does this look correct? Anything to add or remove?"
- Offer to adjust sections

### Step 5: Write File

If CLAUDE.md already exists, use AskUserQuestion to ask:
- **Overwrite** — Replace entirely
- **Merge** — Combine new content with existing (prefer new for conflicts)
- **Cancel** — Don't write

Write the file. Report what was created.

## Mode: Audit (--audit)

### Step 1: Read Existing Files

Read CLAUDE.md (and any subdirectory CLAUDE.md files, .claude/rules/, CLAUDE.local.md).

### Step 2: Check Against Anti-Patterns

Read `references/anti-patterns.md` and check the existing file against each of the 10 anti-patterns:
1. Command overload
2. Universal truths
3. Redundant detail
4. Formatting mandates
5. Stale references
6. Kitchen sink
7. Task-specific instructions
8. Auto-generated verbosity
9. Negative instruction overload
10. Missing WHAT section

### Step 3: Check Best Practices

Read `references/best-practices.md` and verify:
- Uses WHAT/WHY/HOW framework
- Follows 80% rule
- Imperative style
- References external docs
- Appropriate size for project

### Step 4: Report

Present findings as a structured report:

```
## CLAUDE.md Audit

### Score: X/10

### Issues Found
- [Anti-pattern name]: [Description] → [Fix suggestion]

### Strengths
- [What's done well]

### Recommendations
- [Specific improvements with examples]
```

Offer to apply fixes automatically.

## Mode: Rules (--rules)

### Step 1: Analyze Project Structure

Identify distinct areas that need different rules:
- Test files (test patterns, mocking conventions)
- API/route files (endpoint patterns)
- UI components (styling, prop patterns)
- Database files (migration rules)
- Config/CI files

### Step 2: Propose Rules

Read `examples/rules-structure.md` for the pattern. Use AskUserQuestion to confirm which rule files to create.

### Step 3: Generate Rule Files

Create `.claude/rules/` directory with appropriate rule files, each with correct glob frontmatter.

## Mode: Local (--local)

### Step 1: Generate Template

Read `examples/claude-local-example.md` for the pattern. Create a CLAUDE.local.md template with common sections.

### Step 2: Ensure Gitignored

Check if `CLAUDE.local.md` is in `.gitignore`. If not, offer to add it.

### Step 3: Write File

Write CLAUDE.local.md with placeholder content the user can customize.

## Mode: Full Setup (--full)

Run Generate, then Rules, then Local in sequence. Use AskUserQuestion between each stage for confirmation.

## Edge Cases

- **No tech stack detected:** Ask the user about their project before proceeding
- **Monorepo detected:** Offer to create both root and per-package CLAUDE.md files
- **Very large existing CLAUDE.md:** Suggest splitting into rules/ as part of audit
- **Not a git repo:** Skip git-related suggestions, warn the user
