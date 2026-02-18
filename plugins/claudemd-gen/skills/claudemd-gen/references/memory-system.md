# Claude Code Memory System

## Complete Hierarchy

Claude Code reads instructions from multiple sources, merged in priority order:

### 1. Enterprise Policy (highest priority)
- Managed by organization admins
- Cannot be overridden by users
- Not relevant for individual projects

### 2. CLAUDE.md Files (project-level)

```
project/
├── CLAUDE.md                      # Root — loaded for all sessions in this project
├── packages/
│   ├── api/CLAUDE.md              # Loaded when working in packages/api/
│   └── web/CLAUDE.md              # Loaded when working in packages/web/
└── .claude/
    └── rules/                     # Glob-matched rules (see below)
```

**Resolution:** Claude reads the root CLAUDE.md always, plus any CLAUDE.md in the current working directory or its parents up to the project root.

### 3. .claude/rules/ (path-specific rules)

Rules files are loaded based on **glob patterns** in their frontmatter:

```markdown
---
globs: ["src/**/*.test.ts", "src/**/*.spec.ts"]
---
Use `describe`/`it` blocks (not `test()`).
Mock external services with `vi.mock()`.
Always test error cases.
```

**Key rules for rules/:**
- Each file is a markdown file with optional YAML frontmatter
- The `globs` field determines when the rule is loaded
- Without `globs`, the rule loads for all files
- Rules are additive — multiple matching rules all apply
- Keep each rule file focused on one topic

### 4. CLAUDE.local.md (personal, gitignored)

```
project/
├── CLAUDE.md            # Shared with team (committed)
└── CLAUDE.local.md      # Personal only (gitignored)
```

Use for: preferred editor commands, personal debugging habits, custom aliases, tool preferences.

### 5. ~/.claude/CLAUDE.md (global personal)

Applies to **all projects** for this user. Use for:
- Universal personal preferences
- Global tool preferences ("Always use pnpm")
- Communication style preferences

### 6. Auto-Memory (~/.claude/memory/)

Claude manages this automatically. Contains:
- Learned patterns from past sessions
- User preferences discovered through interaction
- Project-specific notes Claude writes for itself

## @import Syntax

CLAUDE.md supports importing other files:

```markdown
@import docs/architecture.md
@import .cursor/rules/typescript.md
```

- Paths are relative to the CLAUDE.md file
- Imported content is included inline
- Useful for sharing rules across tools (Cursor, Windsurf, etc.)

## .claude/rules/ Directory

### Structure Example

```
.claude/rules/
├── general.md              # No globs — applies everywhere
├── testing.md              # globs: ["**/*.test.*"]
├── api-routes.md           # globs: ["src/routes/**"]
├── database.md             # globs: ["src/db/**", "prisma/**"]
├── components.md           # globs: ["src/components/**"]
└── ci.md                   # globs: [".github/**"]
```

### Frontmatter Format

```yaml
---
globs: ["pattern1", "pattern2"]
description: Optional description of what this rule covers
alwaysApply: false
---
```

- `globs` — Array of glob patterns (uses minimatch syntax)
- `description` — Shown when Claude lists active rules
- `alwaysApply` — If true, loads regardless of current file (default: false)

### Decision Matrix: CLAUDE.md vs rules/

| Content | Where |
|---------|-------|
| Build/test commands | CLAUDE.md (root) |
| Architecture overview | CLAUDE.md (root) |
| Universal conventions | CLAUDE.md (root) |
| Package-specific commands | CLAUDE.md (subdirectory) |
| Test file conventions | .claude/rules/testing.md |
| API route patterns | .claude/rules/api.md |
| Component patterns | .claude/rules/components.md |
| Personal preferences | CLAUDE.local.md |

## Practical Tips

- **Start with CLAUDE.md only** — Add rules/ when the file exceeds ~200 lines
- **One topic per rule file** — Makes it clear what each rule covers
- **Use descriptive filenames** — `testing.md` not `rule-003.md`
- **Test glob patterns** — Verify rules load for the right files
- **Don't over-segment** — 3-5 rule files is usually enough
