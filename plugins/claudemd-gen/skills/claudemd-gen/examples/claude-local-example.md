# Example: CLAUDE.local.md

Personal preferences file that's gitignored. Not shared with team.

---

```markdown
# CLAUDE.local.md

## My Preferences

- Use pnpm for all package operations (team uses npm but I prefer pnpm locally)
- Open files in Cursor when referencing them
- Prefer verbose explanations when debugging — I'm learning this codebase

## Local Environment

- Docker Compose for local DB: `docker compose up -d postgres redis`
- Local API runs on port 3001 (default), but I forward to 8080
- My test database: `postgresql://localhost:5433/myapp_test`

## Debugging

- When I say "check logs", look at `~/.local/share/myapp/debug.log`
- I have `RUST_LOG=debug` set globally, so verbose output is expected

## Communication

- Keep responses concise unless I ask for detail
- When suggesting changes, show the diff format I can copy-paste
```
