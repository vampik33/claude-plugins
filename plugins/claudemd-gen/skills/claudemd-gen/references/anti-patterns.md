# CLAUDE.md Anti-Patterns

Ten common mistakes that make CLAUDE.md files ineffective, with fixes.

## 1. Command Overload

**Problem:** Dumping every possible command without context.

```markdown
<!-- BAD -->
npm run build
npm run build:prod
npm run build:staging
npm run build:dev
npm run build:watch
npm run build:analyze
npm run test
npm run test:unit
npm run test:e2e
npm run test:coverage
... (30 more commands)
```

**Fix:** Include only the 3-5 commands Claude actually needs. Group by workflow.

```markdown
- `npm run build` — Build for production
- `npm test` — Run all tests
- `npm run test -- --watch` — Watch mode during development
```

## 2. Universal Truths

**Problem:** Stating things Claude already knows.

```markdown
<!-- BAD -->
Use meaningful variable names.
Handle errors appropriately.
Write clean, maintainable code.
Follow SOLID principles.
```

**Fix:** Only include project-specific conventions that override or extend defaults.

## 3. Redundant Detail

**Problem:** Repeating what's in config files Claude can read.

```markdown
<!-- BAD -->
ESLint is configured with the following rules:
- no-unused-vars: error
- semi: ["error", "always"]
... (copies .eslintrc.json)
```

**Fix:** "ESLint config is in `.eslintrc.json`. Run `npm run lint` to check."

## 4. Formatting Mandates

**Problem:** Specifying formatting that Prettier/formatters handle.

```markdown
<!-- BAD -->
Use 2-space indentation.
Always use single quotes.
Add trailing commas in arrays.
Maximum line length is 100.
```

**Fix:** "Code is auto-formatted with Prettier. Run `npm run format` before committing."

## 5. Stale References

**Problem:** Instructions that reference deleted files, renamed commands, or old patterns.

```markdown
<!-- BAD -->
Run `gulp build` to compile.  <!-- Project migrated to Vite 2 years ago -->
See `src/legacy/` for the old API.  <!-- Directory was deleted -->
```

**Fix:** Review CLAUDE.md when changing tools or structure. Keep it a living document.

## 6. Kitchen Sink

**Problem:** Including everything "just in case."

```markdown
<!-- BAD: 800-line CLAUDE.md covering every possible scenario -->
## Docker Setup
## AWS Configuration
## Database Migrations
## API Documentation
## Frontend Components
## Mobile App
## CI/CD Pipeline
## Monitoring
## Incident Response
...
```

**Fix:** Keep root CLAUDE.md to essentials. Use `.claude/rules/` for path-specific content. Reference external docs.

## 7. Task-Specific Instructions

**Problem:** Using CLAUDE.md for current task context.

```markdown
<!-- BAD -->
We are currently refactoring the auth module.
The login page has a bug where tokens expire too early.
TODO: Fix the database connection pooling issue.
```

**Fix:** Task context belongs in chat, not CLAUDE.md. CLAUDE.md is for stable, project-wide knowledge.

## 8. Auto-Generated Verbosity

**Problem:** Generating CLAUDE.md from README/docs without editing.

```markdown
<!-- BAD: Copy-pasted from README with installation instructions,
     badge descriptions, contributor guidelines, etc. -->
```

**Fix:** Curate. Extract only what Claude needs to work effectively. A human should review it.

## 9. Negative Instruction Overload

**Problem:** Long lists of "don't do X" without positive alternatives.

```markdown
<!-- BAD -->
Don't use var.
Don't use any type.
Don't use console.log in production.
Don't commit .env files.
Don't use synchronous file operations.
```

**Fix:** State the positive expectation. One "don't" is fine if critical; five is a code smell.

```markdown
Use `const`/`let` (never `var`).
Type everything explicitly — no `any`.
Use the `logger` module for output.
```

## 10. Missing WHAT Section

**Problem:** Instructions without context about what the project actually is.

```markdown
<!-- BAD: Jumps straight into commands -->
## Commands
npm run build
npm test
```

**Fix:** Start with 1-2 sentences about what the project does and its key architecture. Claude needs context to make good decisions.

```markdown
# CLAUDE.md

Real-time collaborative editor built with CRDT sync. Express API + React frontend + WebSocket server.

## Build & Test
...
```
