# Plan: Create `claudemd-gen` Plugin

## Context

Writing effective CLAUDE.md files is the highest-leverage activity for Claude Code users, yet most files are too long, too vague, or contain the wrong kind of instructions. This plugin encodes best practices from [HumanLayer research](https://www.humanlayer.dev/blog/writing-a-good-claude-md) and [Claude Code memory docs](https://code.claude.com/docs/en/memory) into an interactive generator with audit capabilities.

The plugin will live at `plugins/claudemd-gen/` following the established patterns from gtr, telegram, explain-changes, and plan-renamer plugins.

## File Structure (14 files)

```
plugins/claudemd-gen/
├── .claude-plugin/plugin.json
├── commands/
│   └── generate.md                          # /claudemd-gen:generate command
├── skills/
│   └── claudemd-gen/
│       ├── SKILL.md                         # L1: Core principles + quick reference
│       ├── references/
│       │   ├── best-practices.md            # L2: Detailed writing guidelines
│       │   ├── memory-system.md             # L2: Full memory hierarchy + rules patterns
│       │   ├── templates.md                 # L2: Templates for minimal/standard/monorepo
│       │   └── anti-patterns.md             # L2: 10 anti-patterns with fixes
│       └── examples/
│           ├── claudemd-typescript-monorepo.md  # L3: Complete example (~80 lines)
│           ├── claudemd-python-django.md         # L3: Complete example (~50 lines)
│           ├── claudemd-rust-cli.md              # L3: Complete example (~40 lines)
│           ├── claudemd-minimal.md               # L3: Bare minimum (~15 lines)
│           ├── rules-structure.md                # L3: Example .claude/rules/ layout
│           └── claude-local-example.md           # L3: Example CLAUDE.local.md
├── CHANGELOG.md
└── README.md
```

## Implementation Steps

### 1. Create plugin manifest
- **File:** `plugins/claudemd-gen/.claude-plugin/plugin.json`
- Version 1.0.0, Apache-2.0 license, matching existing plugin patterns

### 2. Create SKILL.md (core — progressive disclosure Level 1)
- **File:** `plugins/claudemd-gen/skills/claudemd-gen/SKILL.md`
- Frontmatter with rich trigger phrases: "generate CLAUDE.md", "create CLAUDE.md", "set up claude memory", "configure claude code", "improve my CLAUDE.md", "audit my CLAUDE.md", "create rules", etc.
- Body (~80 lines): Core principles, WHAT/WHY/HOW framework, memory hierarchy table, quick decision guide, references pointers
- This is what Claude loads every session — must be concise and universally useful

### 3. Create reference docs (Level 2 — read on demand)
- **`references/best-practices.md`** (~80 lines): WHAT/WHY/HOW framework details, 80% rule, size guidelines, progressive disclosure pattern, "reference don't copy", "not a linter", writing Do's and Don'ts
- **`references/memory-system.md`** (~80 lines): Complete hierarchy (6 levels), all file locations, @import syntax, .claude/rules/ with glob patterns, decision matrix
- **`references/templates.md`** (~100 lines): Minimal template (~20 lines), Standard template (~60 lines), Monorepo template (~100 lines), Rules templates, CLAUDE.local.md template
- **`references/anti-patterns.md`** (~70 lines): 10 anti-patterns: command overload, universal solutions, redundant detail, formatting rules, stale code, kitchen sink, task-specific instructions, auto-generated, negative instructions overload, missing WHAT section

### 4. Create example files (Level 3 — read for specific project types)
- **`examples/claudemd-typescript-monorepo.md`**: Turborepo/Nx monorepo example with workspace structure
- **`examples/claudemd-python-django.md`**: Django project with virtualenv, manage.py, migrations
- **`examples/claudemd-rust-cli.md`**: Rust CLI tool with cargo commands
- **`examples/claudemd-minimal.md`**: Bare minimum for small projects
- **`examples/rules-structure.md`**: Example .claude/rules/ directory with glob patterns
- **`examples/claude-local-example.md`**: CLAUDE.local.md with personal preferences

### 5. Create slash command
- **File:** `plugins/claudemd-gen/commands/generate.md`
- Frontmatter: `skill: claudemd-gen`, `allowed-tools: ["Read", "Write", "Edit", "Glob", "Grep", "Bash", "AskUserQuestion"]`
- Dynamic context via `!` backticks: git status, language files, package manifests, existing CLAUDE.md
- Five modes via `$ARGUMENTS`:
  - `(none)` — Generate CLAUDE.md (analyze project → choose template → draft → review → write)
  - `--audit` — Audit existing CLAUDE.md against best practices and anti-patterns
  - `--rules` — Generate .claude/rules/ structure with path-specific rules
  - `--local` — Generate CLAUDE.local.md template
  - `--full` — Complete setup (CLAUDE.md + rules + local)
- Interactive: uses AskUserQuestion at template selection and before writing
- Edge cases: existing file (overwrite/merge/cancel), no tech stack detected, monorepo detection

### 6. Create CHANGELOG.md and README.md
- Standard changelog with initial 1.0.0 entry
- README with problem statement, solution overview, installation, usage examples

### 7. Register in marketplace
- **File:** `.claude-plugin/marketplace.json` — add new entry
- Category: "Documentation", keywords: claude-md, memory, documentation, configuration, best-practices

### 8. Validate with plugin-dev agents
- Run `plugin-dev:plugin-validator` to check structure
- Run `plugin-dev:skill-reviewer` to review skill quality
- Run `plugin-dev:agent-creator` if an agent is needed (optional)

## Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Single command with flags | vs. multiple commands | Keeps plugin simple; one entry point with clear modes |
| Skill-heavy, no hooks | vs. hooks for enforcement | This plugin generates docs, doesn't enforce rules |
| Examples as separate files | vs. inline in templates.md | Progressive disclosure — only loaded when needed for specific project type |
| Audit mode separate from generate | vs. combined | Different use case: existing projects vs. new setup |

## Verification

1. **Structure check:** `ls -R plugins/claudemd-gen/` — verify all 14 files present
2. **Plugin validation:** Run `plugin-dev:plugin-validator` agent
3. **Skill review:** Run `plugin-dev:skill-reviewer` agent
4. **Manual test:** `claude --plugin-dir plugins/claudemd-gen` then:
   - Type "generate a CLAUDE.md" — should trigger the skill
   - Run `/claudemd-gen:generate` — should show dynamic context and start interactive flow
   - Run `/claudemd-gen:generate --audit` — should analyze existing CLAUDE.md
5. **Marketplace:** Verify version matches between plugin.json and marketplace.json
