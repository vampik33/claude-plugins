---
skill: claudemd-gen
allowed-tools: ["Read", "Write", "Edit", "Glob", "Grep", "Bash", "AskUserQuestion"]
description: Generate, audit, or improve CLAUDE.md files with best practices
argument-hint: "[--help] [--audit] [--rules] [--local] [--full]"
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

Parse `$ARGUMENTS` to determine mode. If multiple flags are provided, use the **first match** in this precedence order:

| Argument | Mode | Action |
|----------|------|--------|
| `--help` | **Help** | Print usage table and exit |
| `--full` | **Full Setup** | Generate CLAUDE.md + rules + local |
| `--audit` | **Audit** | Review existing CLAUDE.md against best practices |
| `--rules` | **Rules** | Generate .claude/rules/ structure |
| `--local` | **Local** | Generate CLAUDE.local.md template |
| (none) | **Generate** | Create or improve CLAUDE.md |

## Mode: Help (--help)

Print the mode selection table above and a brief description of each mode. Do not proceed with any generation.

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

Detect project class using these rules (first match wins):

1. **Monorepo** — workspaces field in package.json, lerna.json, nx.json, turbo.json, pnpm-workspace.yaml, or multiple packages/apps directories → use Monorepo template
2. **Minimal** — single manifest file AND fewer than 10 source files (count files in src/, lib/, app/, or root `*.{ts,js,py,rs,go}`) → use Minimal template
3. **Standard** — everything else → use Standard template

Templates are in `references/templates.md`.

Use AskUserQuestion to confirm the detected template choice and ask about any unclear conventions.

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

### Step 4: Verify (strict mode)

Before presenting to the user, verify every concrete claim in the draft:
- **Commands**: Check that each build/test/lint command exists in the project's package manifest (package.json scripts, Cargo.toml, Makefile targets, pyproject.toml scripts, etc.). If a command cannot be verified, remove it and flag it.
- **Paths**: Check that each referenced directory or file actually exists on disk. If a path doesn't exist, remove it and flag it.
- **Conventions**: Confirm detected conventions by checking at least 2 source files that follow the pattern.

If any items were removed, present the flagged items to the user via AskUserQuestion and ask them to provide the correct values. Do not write unverified commands or paths.

### Step 5: Review with User

Present the verified draft CLAUDE.md and use AskUserQuestion to ask:
- "Does this look correct? Anything to add or remove?"
- Offer to adjust sections

### Step 6: Write File

If CLAUDE.md (or `.claude/CLAUDE.md`) already exists, use AskUserQuestion to ask:
- **Overwrite** — Replace entirely
- **Merge** — Combine new content with existing (prefer new for conflicts)
- **Cancel** — Don't write

Write the file. Report what was created.

## Mode: Audit (--audit)

### Step 1: Read Existing Files

Read CLAUDE.md (and any subdirectory CLAUDE.md files, .claude/rules/, CLAUDE.local.md).

### Step 2: Check Against Anti-Patterns

Read `references/anti-patterns.md` and check the existing file against each anti-pattern listed there.

### Step 3: Check Best Practices

Read `references/best-practices.md` and verify:
- Uses WHAT/WHY/HOW framework
- Follows 80% rule
- Imperative style
- References external docs
- Appropriate size for project

### Step 4: Verify Commands (strict mode)

For every build/test/lint command mentioned in the existing CLAUDE.md:
- Check that the command exists in the project's package manifest or Makefile
- Flag commands that cannot be verified as "Stale reference" issues

### Step 5: Report

Score using this rubric (2 points each, 10 total):

| Category | 2 pts | 1 pt | 0 pts |
|----------|-------|------|-------|
| **Commands accuracy** | All commands verified in manifests | Some unverified | Commands missing or stale |
| **Architecture clarity** | Key dirs + entry points + WHY | Partial coverage | Missing or vague |
| **Convention specificity** | Project-specific 80%-rule content | Mix of specific and generic | Generic truths only |
| **Anti-pattern avoidance** | No anti-patterns detected | 1-2 minor anti-patterns | 3+ anti-patterns |
| **Brevity & relevance** | Right-sized, no bloat | Slightly over/under | Kitchen sink or too sparse |

Present findings as a structured report:

```
## CLAUDE.md Audit

### Score: X/10

| Category | Score | Notes |
|----------|-------|-------|
| Commands accuracy | X/2 | ... |
| Architecture clarity | X/2 | ... |
| Convention specificity | X/2 | ... |
| Anti-pattern avoidance | X/2 | ... |
| Brevity & relevance | X/2 | ... |

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

Create `.claude/rules/` directory with appropriate rule files, each with correct `paths` frontmatter.

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
