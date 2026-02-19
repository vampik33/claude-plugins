---
name: claudemd-gen
description: This skill should be used when the user wants to generate, create, write, audit, improve, or review a CLAUDE.md file, set up .claude/rules/ for path-specific instructions, create a CLAUDE.local.md for personal preferences, set up project instructions, configure Claude Code for a project, ask what should go in a CLAUDE.md, or needs guidance on Claude Code memory configuration and project instruction best practices.
version: 1.1.0
---

# CLAUDE.md Generator

Generate effective CLAUDE.md files that encode project-specific knowledge for Claude Code.

## Core Principles

1. **WHAT/WHY/HOW framework** — Every section should answer: What does the project do? Why are things done this way? How to build/test/deploy?
2. **80% rule** — If Claude would get something right 80%+ of the time without instruction, don't include it
3. **Imperative, not descriptive** — Write instructions ("Use pnpm"), not descriptions ("This project uses pnpm")
4. **Reference, don't copy** — Point to existing docs ("See docs/api.md for endpoints"), don't duplicate them
5. **Keep it concise** — Target under 200 lines for most projects (monorepo roots may reach 300). If longer, split into .claude/rules/ with path patterns

## Memory Hierarchy

| Level | File | Scope | Use For |
|-------|------|-------|---------|
| 1 | `CLAUDE.md` or `.claude/CLAUDE.md` (repo root) | All sessions, all users | Build commands, architecture, conventions |
| 2 | `CLAUDE.md` (subdirectory) | When working in that dir | Package-specific rules |
| 3 | `.claude/rules/*.md` | Path-matched to file patterns | Path-specific rules (e.g., test patterns) |
| 4 | `CLAUDE.local.md` | Personal, gitignored | Individual preferences |
| 5 | `~/.claude/CLAUDE.md` | All projects for this user | Global personal preferences |
| 5b | `~/.claude/rules/*.md` | All projects for this user | Global personal rules (lower priority than project rules) |
| 6 | Auto-memory | Claude-managed per-project | Learned patterns across sessions (not user-editable) |

## Quick Decision Guide

| Situation | Action |
|-----------|--------|
| New project, no CLAUDE.md | Generate with `/claudemd-gen:generate` |
| Existing CLAUDE.md, unsure if good | Audit with `/claudemd-gen:generate --audit` |
| Large project, need path-specific rules | Generate rules with `/claudemd-gen:generate --rules` |
| Want personal preferences separate | Create local with `/claudemd-gen:generate --local` |
| Full setup from scratch | Complete setup with `/claudemd-gen:generate --full` |

## What Belongs in CLAUDE.md

**Always include:**
- Build/test/lint commands (the #1 most impactful content)
- Project architecture overview (key directories, entry points)
- Non-obvious conventions (naming, patterns, error handling)
- Common pitfalls specific to this codebase

**Never include:**
- Generic language tutorials or best practices
- Information already in package.json, Cargo.toml, etc.
- Task-specific instructions (use chat context instead)
- Obvious things Claude already knows

## References

For detailed guidance, read these on demand:
- `references/best-practices.md` — Detailed writing Do's and Don'ts
- `references/memory-system.md` — Full memory hierarchy, @import, rules/ patterns
- `references/templates.md` — Starter templates for different project sizes
- `references/anti-patterns.md` — Common mistakes and how to fix them

## Examples

Project-type examples (read when matching the user's stack):
- `examples/claudemd-typescript-monorepo.md` — Turborepo/Nx monorepo
- `examples/claudemd-python-django.md` — Django web application
- `examples/claudemd-rust-cli.md` — Rust CLI tool
- `examples/claudemd-minimal.md` — Bare minimum for small projects
- `examples/rules-structure.md` — .claude/rules/ directory layout
- `examples/claude-local-example.md` — CLAUDE.local.md personal preferences
