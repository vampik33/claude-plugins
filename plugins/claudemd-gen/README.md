# CLAUDE.md Generator Plugin

Writing effective CLAUDE.md files is the highest-leverage activity for Claude Code users, yet most files are too long, too vague, or contain the wrong kind of instructions. This plugin encodes best practices into an interactive generator with audit capabilities.

## Installation

### From Marketplace (Recommended)

```
/plugin marketplace add vampik33/claude-plugins
/plugin install claudemd-gen
```

### From local directory (development)

```bash
claude --plugin-dir /path/to/claude-plugins/plugins/claudemd-gen
```

## Usage

### Generate CLAUDE.md

```bash
/claudemd-gen:generate                # Analyze project and generate CLAUDE.md
/claudemd-gen:generate --audit        # Audit existing CLAUDE.md against best practices
/claudemd-gen:generate --rules        # Generate .claude/rules/ with path-specific rules
/claudemd-gen:generate --local        # Generate CLAUDE.local.md template
/claudemd-gen:generate --full         # Complete setup: CLAUDE.md + rules + local
/claudemd-gen:generate --help         # Print usage information
```

### Natural Language

The skill also activates naturally:
- "Generate a CLAUDE.md for this project"
- "Audit my CLAUDE.md"
- "Help me improve my CLAUDE.md"
- "Set up project instructions"
- "Configure Claude Code for this project"
- "Set up .claude/rules"

## What It Does

1. **Analyzes your project** — Reads package manifests, directory structure, existing docs
2. **Chooses a template** — Minimal, Standard, or Monorepo based on deterministic project detection
3. **Generates content** — Fills template with real commands, paths, and conventions
4. **Verifies strictly** — Every command and path is checked against manifests and disk before writing
5. **Reviews with you** — Interactive confirmation before writing files
6. **Follows best practices** — WHAT/WHY/HOW framework, 80% rule, imperative style

## Built-In Knowledge

The plugin includes curated guidance:

- **Best practices** — Writing style, progressive disclosure, size guidelines
- **Memory system** — Full hierarchy, @import syntax, .claude/rules/ patterns
- **Templates** — Starter templates for 3 project sizes
- **Anti-patterns** — 10 common mistakes with fixes
- **Examples** — Complete CLAUDE.md files for TypeScript, Python, Rust, and more

## License

Apache-2.0
