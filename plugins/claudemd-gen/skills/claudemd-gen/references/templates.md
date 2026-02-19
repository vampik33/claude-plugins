# CLAUDE.md Templates

**Placement:** All templates below can be placed at either `CLAUDE.md` (project root) or `.claude/CLAUDE.md` (keeps root clean). Both locations are equivalent.

**Package managers:** Templates use `<package-manager>` as placeholder. Replace with the project's actual manager: npm, pnpm, yarn, or bun.

## Minimal Template (~20 lines)

For small projects with simple setup:

```markdown
# CLAUDE.md

## Build & Run

- `<build-command>` — Build the project
- `<test-command>` — Run tests
- `<lint-command>` — Lint and format

## Architecture

<1-2 sentence description of what this project does and how it's organized.>

## Conventions

- <Most important convention #1>
- <Most important convention #2>
- <Most important convention #3>
```

## Standard Template (~60 lines)

For typical single-package projects:

```markdown
# CLAUDE.md

## Build & Test

- `<package-manager> build` — Build the project
- `<package-manager> test` — Run all tests
- `<package-manager> test -- <path>` — Run specific tests
- `<package-manager> lint` — Lint check
- `<package-manager> format` — Auto-format

## Architecture

<2-3 sentences: What the project does, key technology choices, deployment target.>

### Key Directories

- `src/` — Source code
- `src/<main-module>/` — <What this module does>
- `src/<other-module>/` — <What this module does>
- `tests/` — Test files

### Entry Points

- `src/main.<ext>` — Application entry point
- `src/config.<ext>` — Configuration loading

## Conventions

### Code Style

- <Naming convention, e.g., "Use camelCase for variables, PascalCase for types">
- <Import ordering, e.g., "Group imports: external, internal, relative">
- <Error handling pattern, e.g., "Use Result type, never unwrap in library code">

### Testing

- Test files: `<pattern, e.g., "*.test.ts next to source files">`
- <Testing framework and key patterns>
- <Mocking approach>

### Git

- Branch naming: `<pattern>`
- Commit style: `<pattern, e.g., "conventional commits">`

## Common Pitfalls

- <Pitfall #1 — what goes wrong and how to avoid it>
- <Pitfall #2>
```

## Monorepo Template (~100 lines)

For workspace-based projects:

```markdown
# CLAUDE.md

## Build & Test

Root commands (run from project root):
- `<package-manager> build` — Build all packages
- `<package-manager> test` — Run all tests
- `<package-manager> lint` — Lint all packages
- `<package-manager> build --filter=<package>` — Build specific package

### Package-Specific Commands

| Package | Build | Test |
|---------|-------|------|
| `packages/<pkg1>` | `<cmd>` | `<cmd>` |
| `packages/<pkg2>` | `<cmd>` | `<cmd>` |

## Architecture

<Monorepo tool (Turborepo/Nx/pnpm workspaces). How packages relate.>

### Workspace Structure

- `packages/<pkg1>/` — <Purpose> (depends on: <deps>)
- `packages/<pkg2>/` — <Purpose> (depends on: <deps>)
- `packages/shared/` — Shared types and utilities
- `apps/<app>/` — <Purpose>

### Dependency Rules

- `shared` has zero internal dependencies
- `<pkg>` depends only on `shared`
- Apps can depend on any package

## Conventions

### Cross-Package

- Shared types live in `packages/shared/src/types/`
- Each package has its own CLAUDE.md for package-specific rules
- Changes to `shared` require testing all dependent packages

### Versioning

- <Versioning strategy>

## Common Pitfalls

- <Build order issues>
- <Circular dependency risks>
- <Workspace-specific gotchas>
```

## Rules Template

For `.claude/rules/*.md` files:

```markdown
---
paths:
  - "<glob-pattern>"
---

<Imperative instructions specific to files matching the path pattern.>

- <Rule 1>
- <Rule 2>
- <Rule 3>
```

## CLAUDE.local.md Template

```markdown
# CLAUDE.local.md

## My Preferences

- <Editor/tool preference>
- <Communication style preference>
- <Debugging approach>

## Local Setup

- <Local-specific env vars or config>
- <Custom aliases or scripts>
```
