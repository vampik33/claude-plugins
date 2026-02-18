# Example: Minimal CLAUDE.md

For small projects or scripts. The absolute minimum that's still useful.

---

```markdown
# CLAUDE.md

URL shortener microservice. Go + SQLite. Single binary deployment.

## Build & Test

- `go build -o shortener ./cmd/shortener` — Build
- `go test ./...` — Run all tests
- `golangci-lint run` — Lint

## Architecture

- `cmd/shortener/main.go` — HTTP server entry point
- `internal/store/` — SQLite storage layer
- `internal/handler/` — HTTP handlers

## Conventions

- Error wrapping: `fmt.Errorf("operation: %w", err)`
- Tests: table-driven with `t.Run()` subtests
```
