# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2026-02-19

### Fixed

- **Critical:** `@import` syntax corrected from `@import path` to `@path` with details on max depth, code span exclusion, home dir support, and approval dialog
- **Critical:** Rules frontmatter field corrected from `globs:` to `paths:` across all references, templates, and examples
- **Critical:** Removed phantom fields `description` and `alwaysApply` from rules frontmatter (Cursor-specific, not Claude Code features)
- Auto-memory path corrected to `~/.claude/projects/<project-hash>/memory/` with MEMORY.md index
- "Enterprise Policy" renamed to "Managed policy" with OS-specific paths
- Size guidance contradiction resolved (under 200 lines default, monorepo roots up to 300)

### Added

- **Strict verification mode** (default): Generator verifies all commands exist in package manifests and all paths exist on disk before writing. Unverified items are flagged and require user input.
- **Audit scoring rubric**: 10-point scale (2 points each) for commands accuracy, architecture clarity, convention specificity, anti-pattern avoidance, and brevity/relevance
- **Command verification in audit mode**: Checks that all build/test/lint commands in existing CLAUDE.md actually exist in project manifests
- `--help` argument for printing usage information
- Multi-flag precedence order (--help > --full > --audit > --rules > --local)
- `.claude/CLAUDE.md` as alternative root location documented throughout
- `~/.claude/rules/*.md` user-level rules directory documented
- Deterministic template selection rules (monorepo detection via workspace configs, minimal via file count)
- Bun as package manager option in templates
- Broader skill trigger phrases: "set up project instructions", "configure Claude Code for this project"
- Marketplace-first installation docs consistent with other plugins

## [1.0.0] - 2026-02-18

### Added

- Initial release
- `/claudemd-gen:generate` command with 5 modes:
  - Default: Interactive CLAUDE.md generation with project analysis
  - `--audit`: Review existing CLAUDE.md against best practices and anti-patterns
  - `--rules`: Generate .claude/rules/ structure with path-matched rules
  - `--local`: Generate CLAUDE.local.md template for personal preferences
  - `--full`: Complete setup (CLAUDE.md + rules + local)
- Progressive disclosure skill with 3 levels:
  - L1: Core principles and quick reference (SKILL.md)
  - L2: Detailed references (best-practices, memory-system, templates, anti-patterns)
  - L3: Project-type examples (TypeScript monorepo, Python Django, Rust CLI, minimal)
- Natural language activation: "generate CLAUDE.md", "audit my CLAUDE.md", etc.
