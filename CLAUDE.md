# CLAUDE.md

Claude Code Plugin Marketplace (`vampik-plugins`) — add with `/plugin marketplace add vampik33/claude-plugins`, then `/plugin install <name>@vampik-plugins`.

## Testing Locally

```bash
claude --plugin-dir /path/to/claude-plugins/plugins/<plugin-name>
```

All checks (Lean proofs, property + differential tests, mod tests, telegram-notifier shellcheck + bats): `verification/run.sh`. See `verification/README.md`.

One target: `claude plugin test plugins/<mod>`; `(cd verification && bun test props/<mod>)`; `bats plugins/telegram-notifier/tests`.

`run.sh` stops at the first failing suite (`set -e`); fix it and rerun before reading later suites as passing.

## Repository Structure

`plans/` = implementation plans from Claude sessions; `verification/` = Lean models and proofs, property tests, `run.sh`.

Mods (TypeScript function-hook plugins) and shell-hook conventions: see `plugins/CLAUDE.md`.

## Conventions

### Plugin Configuration

Use markdown files with YAML frontmatter for user-facing config:
- User-level: `~/.claude/<plugin>.local.md`
- Project-level: `.claude/<plugin>.local.md`
- Resolution: project > user > defaults

### Versioning

- Semantic versioning in `plugin.json`
- CHANGELOG.md following [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format
- Commit messages: `type(plugin-name): description (vX.Y.Z)` (conventional commits; the version suffix is the bumped plugin version)

## Adding a New Plugin

Add `plugins/<name>/.claude-plugin/plugin.json` plus a `.claude-plugin/marketplace.json` entry (versions must match), plus `CHANGELOG.md`.

## Gotchas

- **Only telegram-notifier has shell hooks**: the mods' `hooks/` hold a TypeScript module instead; the other plugins are command+skill only
- **The `scripts/lib/` shared libraries are telegram-notifier-specific**: `config.sh`, `html.sh`, `session.sh`, `yaml.sh` live under telegram-notifier's hooks — they are not cross-plugin shared code
- **gtr has no CHANGELOG.md**: Unlike other plugins, gtr is missing its changelog
- **Daily-review issues and PRs** (`Daily review <date>` issue, branch `daily-review/<date>-main`) are made remotely without a checkout: before merging, rebase onto `main`, add a test, bump the version in both manifests and add the CHANGELOG entry. The repo doesn't delete merged branches.

## Updating a Plugin

Update version in **both** locations (must match):
- `plugins/<name>/.claude-plugin/plugin.json` — the `version` field
- `.claude-plugin/marketplace.json` — the plugin's `version` field

Update `CHANGELOG.md` in the plugin directory:
- Add new version section with date
- Document changes under: Added, Changed, Fixed, Removed
