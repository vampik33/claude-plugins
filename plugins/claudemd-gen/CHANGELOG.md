# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-02-18

### Added

- Initial release
- `/claudemd-gen:generate` command with 5 modes:
  - Default: Interactive CLAUDE.md generation with project analysis
  - `--audit`: Review existing CLAUDE.md against best practices and anti-patterns
  - `--rules`: Generate .claude/rules/ structure with glob-matched rules
  - `--local`: Generate CLAUDE.local.md template for personal preferences
  - `--full`: Complete setup (CLAUDE.md + rules + local)
- Progressive disclosure skill with 3 levels:
  - L1: Core principles and quick reference (SKILL.md)
  - L2: Detailed references (best-practices, memory-system, templates, anti-patterns)
  - L3: Project-type examples (TypeScript monorepo, Python Django, Rust CLI, minimal)
- Natural language activation: "generate CLAUDE.md", "audit my CLAUDE.md", etc.
