# Example: TypeScript Monorepo CLAUDE.md

This is a complete example for a Turborepo-based TypeScript monorepo.

---

```markdown
# CLAUDE.md

Full-stack SaaS platform. React frontend + Express API + shared type library. Turborepo for builds, pnpm workspaces.

## Build & Test

From project root:
- `pnpm build` — Build all packages (respects dependency graph)
- `pnpm test` — Run all tests across packages
- `pnpm lint` — ESLint + Prettier check
- `pnpm typecheck` — TypeScript compilation check (no emit)
- `pnpm build --filter=@acme/api` — Build specific package
- `pnpm test --filter=@acme/web -- --run src/auth` — Run specific tests

### Package Commands

| Package | Dev Server | Build | Test |
|---------|-----------|-------|------|
| `packages/api` | `pnpm --filter @acme/api dev` (port 3001) | `pnpm --filter @acme/api build` | `pnpm --filter @acme/api test` |
| `packages/web` | `pnpm --filter @acme/web dev` (port 3000) | `pnpm --filter @acme/web build` | `pnpm --filter @acme/web test` |

## Architecture

### Workspace Structure

- `packages/api/` — Express REST API. Repository pattern over Prisma ORM.
- `packages/web/` — Next.js 14 app router frontend.
- `packages/shared/` — Shared TypeScript types, validators (zod schemas), and utilities. Zero runtime dependencies.
- `packages/config/` — Shared ESLint, TypeScript, and Tailwind configs.

### Dependency Rules

- `shared` has no internal dependencies — it's the foundation
- `api` and `web` both depend on `shared`
- `api` and `web` never depend on each other
- Changes to `shared` types require testing both api and web

## Conventions

### Code Style

- Strict TypeScript: `noUncheckedIndexedAccess`, no `any`
- Imports: external → @acme/* → relative (enforced by ESLint)
- Barrel exports: each package exposes public API through `src/index.ts`
- Zod schemas in `shared` are the source of truth for types — derive TS types with `z.infer<>`

### API Patterns

- Routes in `src/routes/<resource>.ts`, one file per resource
- All endpoints return `{ data: T }` or `{ error: { code, message } }`
- Use `asyncHandler` wrapper — never write try/catch in route handlers
- Validate request body with zod: `validate(schema)` middleware

### Testing

- Vitest for all packages
- Test files: `*.test.ts` next to source
- API integration tests use `supertest` with test database
- Web component tests use `@testing-library/react`
- Run `pnpm db:test:reset` before API integration tests

### Git

- Conventional commits: `feat(api):`, `fix(web):`, `chore(shared):`
- Scope is the package name without @acme/ prefix
- PRs require passing CI and one approval

## Common Pitfalls

- Changing `shared` types without running `pnpm typecheck` across all packages
- Forgetting to run `pnpm db:migrate` after pulling — migration errors look like code bugs
- Port conflicts: kill existing dev servers before `pnpm dev`
```
