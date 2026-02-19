# Example: .claude/rules/ Directory Layout

Shows how to organize path-specific rules for a medium-to-large project.

---

## Directory Structure

```
.claude/rules/
├── testing.md          # Test file conventions
├── api-routes.md       # API endpoint patterns
├── components.md       # React component patterns
├── database.md         # Database and migration rules
└── ci-workflows.md     # CI/CD file conventions
```

## testing.md

```markdown
---
paths:
  - "**/*.test.ts"
  - "**/*.test.tsx"
  - "**/*.spec.ts"
---

Use `describe`/`it` blocks with clear descriptions.
Mock external services with `vi.mock()` — never call real APIs in tests.
Use `beforeEach` for setup, not `beforeAll` (isolate test state).
Test file lives next to source: `Button.tsx` → `Button.test.tsx`.
Prefer `@testing-library/react` queries: `getByRole` > `getByTestId` > `getByText`.
```

## api-routes.md

```markdown
---
paths:
  - "src/routes/**"
  - "src/middleware/**"
---

Every route handler uses `asyncHandler` wrapper from `src/lib/async-handler.ts`.
Return format: `{ data: T }` for success, `{ error: { code, message } }` for errors.
Validate request body with zod schema middleware: `validate(CreateUserSchema)`.
Route files export a single router: `export const userRouter = Router()`.
Use HTTP status codes correctly: 201 for creation, 204 for deletion, 409 for conflicts.
```

## components.md

```markdown
---
paths:
  - "src/components/**/*.tsx"
  - "src/components/**/*.ts"
---

One component per file. File name matches component name: `UserCard.tsx` exports `UserCard`.
Props interface named `<Component>Props` and exported.
Use `forwardRef` for components that wrap native elements.
Styles via Tailwind classes. No inline `style` props. No CSS modules.
Storybook story lives next to component: `UserCard.stories.tsx`.
```

## database.md

```markdown
---
paths:
  - "src/db/**"
  - "prisma/**"
  - "drizzle/**"
---

Never modify existing migration files — create new ones.
Use transactions for multi-table writes: `prisma.$transaction([...])`.
Index any column used in WHERE clauses or JOINs.
Soft delete via `deletedAt` timestamp — never hard delete user data.
Seed data in `prisma/seed.ts`, run with `pnpm db:seed`.
```

## ci-workflows.md

```markdown
---
paths:
  - ".github/**/*.yml"
  - ".github/**/*.yaml"
---

Use reusable workflows from `.github/workflows/shared/`.
Pin action versions to SHA, not tags: `actions/checkout@abc123`.
Secrets come from GitHub environment, not hardcoded.
Test matrix: Node 18 + 20, Ubuntu latest only.
```
