# Claude Code Memory System

## Complete Hierarchy

Claude Code reads instructions from multiple sources, merged in priority order:

### 1. Managed Policy (highest priority)
- Managed by organization admins via OS-specific paths:
  - macOS: `/Library/Application Support/ClaudeCode/CLAUDE.md`
  - Linux: `/etc/claude-code/CLAUDE.md`
  - Windows: `C:\Program Files\ClaudeCode\CLAUDE.md`
- Cannot be overridden by users
- Not relevant for individual projects

### 2. CLAUDE.md Files (project-level)

```
project/
├── CLAUDE.md                      # Root — loaded for all sessions in this project
├── .claude/
│   ├── CLAUDE.md                  # Alternative root location (keeps project root clean)
│   └── rules/                     # Path-matched rules (see below)
├── packages/
│   ├── api/CLAUDE.md              # Loaded when working in packages/api/
│   └── web/CLAUDE.md              # Loaded when working in packages/web/
```

**Resolution:** Claude reads the root CLAUDE.md (or `.claude/CLAUDE.md`) always, plus any CLAUDE.md in the current working directory or its parents up to the project root.

### 3. .claude/rules/ (path-specific rules)

Rules files are loaded based on **path patterns** in their frontmatter:

```markdown
---
paths:
  - "src/**/*.test.ts"
  - "src/**/*.spec.ts"
---
Use `describe`/`it` blocks (not `test()`).
Mock external services with `vi.mock()`.
Always test error cases.
```

**Key rules for rules/:**
- Each file is a markdown file with optional YAML frontmatter
- The `paths` field determines when the rule is loaded (glob syntax)
- Without `paths`, the rule loads unconditionally for all files
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

### 5b. ~/.claude/rules/*.md (global personal rules)

User-level rules that apply across all projects. Same `paths` frontmatter format as project rules, but with lower priority than project-level `.claude/rules/`.

### 6. Auto-Memory (`~/.claude/projects/<project-hash>/memory/`)

Claude manages this automatically per-project. Contains:
- `MEMORY.md` index file (first 200 lines loaded at session start)
- Learned patterns from past sessions
- User preferences discovered through interaction
- Project-specific notes Claude writes for itself

## @import Syntax

CLAUDE.md supports importing other files using `@path` (no `import` keyword):

```markdown
@docs/architecture.md
@.cursor/rules/typescript.md
@~/.claude/my-shared-instructions.md
```

- Paths are relative to the CLAUDE.md file
- Home directory imports work: `@~/.claude/my-instructions.md`
- Imported content is included inline
- Max depth of 5 hops for recursive imports
- Imports are NOT evaluated inside code spans/blocks (avoids collisions with e.g. `@anthropic-ai/claude-code`)
- First-time external imports trigger an approval dialog
- Useful for sharing rules across tools (Cursor, Windsurf, etc.)

## .claude/rules/ Directory

### Structure Example

```
.claude/rules/
├── general.md              # No paths — applies unconditionally
├── testing.md              # paths: ["**/*.test.*"]
├── api-routes.md           # paths: ["src/routes/**"]
├── database.md             # paths: ["src/db/**", "prisma/**"]
├── components.md           # paths: ["src/components/**"]
└── ci.md                   # paths: [".github/**"]
```

### Frontmatter Format

```yaml
---
paths:
  - "pattern1"
  - "pattern2"
---
```

- `paths` — List of glob patterns (determines when the rule is loaded)
- Without `paths`, the rule loads unconditionally for all files

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
