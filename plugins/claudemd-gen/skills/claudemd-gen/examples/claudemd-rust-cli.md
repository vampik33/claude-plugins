# Example: Rust CLI CLAUDE.md

This is a complete example for a Rust command-line tool.

---

```markdown
# CLAUDE.md

Fast file deduplication CLI. Finds and removes duplicate files using content hashing. Single binary, no runtime dependencies.

## Build & Test

- `cargo build` — Debug build
- `cargo build --release` — Release build (enables LTO)
- `cargo test` — Run all tests
- `cargo test -- --nocapture` — Tests with stdout visible
- `cargo clippy -- -D warnings` — Lint (treat warnings as errors)
- `cargo fmt --check` — Format check

### Running

- `cargo run -- <args>` — Run in debug mode
- `./target/release/dedup scan /path` — Scan directory
- `./target/release/dedup clean --dry-run /path` — Preview deletions

## Architecture

- `src/main.rs` — CLI argument parsing (clap) and entry point
- `src/scanner.rs` — Directory traversal with `walkdir`, respects .gitignore
- `src/hasher.rs` — Content hashing (xxhash for speed, SHA-256 for verification)
- `src/dedup.rs` — Duplicate detection and grouping logic
- `src/output.rs` — Formatters: table, json, csv

### Error Handling

All public functions return `Result<T, DeduError>`. `DeduError` is in `src/error.rs` using `thiserror`. Never `unwrap()` or `expect()` in library code — only in `main.rs` for top-level error display.

## Conventions

- Use `&Path` not `&str` for file paths
- Prefer `rayon` parallel iterators for CPU-bound work (hashing)
- Async only for I/O-heavy operations (network, large file reads) — most code is sync
- Tests use `tempdir` crate for filesystem fixtures. Clean up is automatic.
- Integration tests in `tests/` test full CLI invocations with `assert_cmd`

## Common Pitfalls

- Symlink loops: `walkdir` handles these but `follow_links` must stay `false`
- Large file hashing: stream with `BufReader`, never read entire file into memory
- Cross-platform paths: use `Path`/`PathBuf`, never string manipulation for paths
```
