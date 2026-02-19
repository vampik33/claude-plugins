# Best Practices for Writing CLAUDE.md

## The WHAT/WHY/HOW Framework

Every CLAUDE.md section should answer at least one:

- **WHAT** — What does this project do? What are its key parts?
- **WHY** — Why are things done this way? What constraints exist?
- **HOW** — How to build, test, deploy, and work with the code?

### Example: Build Commands (HOW)

```markdown
## Build & Test

- `pnpm build` — Build all packages
- `pnpm test` — Run tests (uses Vitest)
- `pnpm lint` — ESLint + Prettier check
- `pnpm test -- --run src/auth` — Run specific test directory
```

### Example: Architecture (WHAT + WHY)

```markdown
## Architecture

Monorepo with shared packages. API and web app deploy independently.

- `packages/api/` — Express REST API (port 3001)
- `packages/web/` — Next.js frontend (port 3000)
- `packages/shared/` — Types and utilities shared between api/web

API uses repository pattern because we plan to swap databases later.
```

## The 80% Rule

Only document things Claude would get wrong without instruction:

| Include | Skip |
|---------|------|
| "Always use `pnpm`, never `npm`" | "Use async/await for promises" |
| "Tests go in `__tests__/` next to source" | "Write unit tests for functions" |
| "We use barrel exports — add to index.ts" | "Export functions from modules" |
| "Error type is `AppError`, not raw Error" | "Handle errors properly" |

**Test:** If you removed the instruction, would Claude still do it right most of the time? If yes, remove it.

## Writing Style Guidelines

### Do: Write imperatives

```markdown
Use `pnpm` for all package operations.
Run `make lint` before committing.
Name test files `*.test.ts` (not `*.spec.ts`).
```

### Don't: Write descriptions

```markdown
<!-- BAD: This tells Claude what exists, not what to do -->
This project uses pnpm for package management.
The linter is configured with ESLint.
Test files use the .test.ts extension.
```

### Do: Be specific and actionable

```markdown
## Database Migrations

Create migrations: `pnpm db:migrate:create <name>`
Run migrations: `pnpm db:migrate`
Never modify existing migration files — create new ones instead.
```

### Don't: Be vague

```markdown
<!-- BAD: Claude can't act on this -->
Follow standard database migration practices.
Be careful with migrations.
```

## Progressive Disclosure

For large projects, layer information:

1. **CLAUDE.md (root)** — Universal: build commands, architecture, top-level conventions
2. **CLAUDE.md (subdirectory)** — Package-specific: that package's commands, patterns, gotchas
3. **.claude/rules/** — Path-specific: rules that apply only when editing certain files

This keeps each file short and relevant.

## Size Guidelines

| Project Size | Target Lines (root CLAUDE.md) | Strategy |
|-------------|-------------------------------|----------|
| Small (<10 files) | 15-30 | Single CLAUDE.md, minimal template |
| Medium (10-50 files) | 50-100 | CLAUDE.md + maybe 1-2 rules |
| Large (50-200 files) | 100-200 | CLAUDE.md + subdirectory files + rules/ |
| Monorepo (200+ files) | 200-300 root + per-package | Root CLAUDE.md + package CLAUDE.md + rules/ |

**General guideline:** Keep under 200 lines for most projects. Only monorepo roots should exceed 200.

## Reference, Don't Copy

```markdown
<!-- GOOD: Points to existing docs -->
See `docs/api.md` for API endpoint documentation.
See `CONTRIBUTING.md` for PR workflow.

<!-- BAD: Copies content that will go stale -->
## API Endpoints
- GET /users — List all users
- POST /users — Create user
... (50 more lines that duplicate docs/api.md)
```

## Maintenance

- Review CLAUDE.md when changing build tools or conventions
- Remove instructions for deleted features
- Keep it a living document, not a historical record
