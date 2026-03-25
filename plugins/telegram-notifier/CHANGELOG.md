# Changelog

All notable changes to the Telegram Notifier plugin will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.9.0] - 2026-03-25

### Changed
- **BREAKING: Plugin renamed from `telegram` to `telegram-notifier`** to avoid conflict with Anthropic's official telegram plugin
- Config file renamed: `telegram.local.md` → `telegram-notifier.local.md`
- Debug env var renamed: `TELEGRAM_DEBUG` → `TELEGRAM_NOTIFIER_DEBUG`
- Session temp files renamed: `claude-telegram-session-*` → `claude-telegram-notifier-session-*`
- Install command: `claude plugin add vampik33/claude-plugins/telegram-notifier`
- Plugin status messages now say "Telegram Notifier plugin" instead of "Telegram plugin"

### Unchanged
- `/telegram` slash command name (kept short for convenience)
- `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` env vars (Telegram API credentials, not plugin-specific)
- `skills/telegram-messaging/` directory name

### Migration
1. Rename config files: `mv ~/.claude/telegram.local.md ~/.claude/telegram-notifier.local.md`
2. Update env var in shell profile: `TELEGRAM_DEBUG` → `TELEGRAM_NOTIFIER_DEBUG`
3. Re-install the plugin: `claude plugin add vampik33/claude-plugins/telegram-notifier`

## [1.8.0] - 2026-03-10

### Added
- **Configuration reference**: New `references/configuration.md` for progressive disclosure of setup details
- **Inline credentials and config**: SKILL.md now includes credentials and configuration sections directly, so Claude can answer setup questions without loading the README

### Changed
- **Improved skill trigger description**: Rewritten with explicit trigger phrases for better skill matching accuracy
- **Troubleshooting links**: Updated to reference the new configuration reference doc

## [1.7.0] - 2026-03-03

### Added
- **HTML formatting**: Telegram messages now use HTML parse mode for visual hierarchy — bold headers, italic metadata
- New `lib/html.sh` shared library with `escape_html()` for safe HTML content escaping
- All dynamic content (project names, file paths, user input, summaries) is escaped to prevent HTML injection

## [1.6.4] - 2026-03-03

### Changed
- Add blank line separators between report sections (title, summary, dir, session) for better readability

## [1.6.3] - 2026-03-02

### Fixed
- **Broken sentence-boundary truncation**: `grep -oP '.*[.!?]' | tail -1` discarded all content except the last line containing a dot — file path dots (e.g. `lib.rs`) were treated as sentence endings, producing garbage like `| runtime/src/lib.`
- **Aggressive markdown stripping**: Now removes table rows, backticks, insight blocks (★...─), and heading markers (was broken due to BRE vs ERE regex)
- Simplified truncation to word-boundary cut at 500 chars instead of flawed sentence detection

## [1.6.2] - 2026-03-02

### Fixed
- **Session summary extraction**: Use full `last_assistant_message` text instead of searching for `## Summary` heading that Claude rarely produces
- Truncate to last complete sentence within 1000 chars (no mid-word cuts)
- Strips markdown formatting for cleaner Telegram notifications

## [1.6.1] - 2026-03-02

### Fixed
- **Session summary extraction**: Use `last_assistant_message` from Stop hook input instead of non-existent `type=="summary"` transcript entries
- Summary now correctly extracts `## Summary` section from Claude's final response
- Strips markdown bold markers for cleaner Telegram notifications

## [1.6.0] - 2026-01-30

### Changed
- **Improved transcript summaries**: Session-end notifications now use Claude's natural language session summary instead of mechanical tool extraction
- Falls back to tool-based summary (edited files, commands run) if no session summary is available

## [1.5.0] - 2026-01-15

### Added
- **Session metadata**: Notifications now include session ID and working directory for better tracking

## [1.4.0] - 2026-01-15

### Added
- **Transcript summaries**: Session-end notifications now include a brief summary of actions taken (edited files, created files, bash commands run)
- New `summarize-transcript.sh` script extracts meaningful activity from session transcripts
- New `extract_transcript_path()` function in session.sh library

## [1.3.0] - 2026-01-14

### Fixed
- **Multi-instance conflict**: Session files now use Claude's `session_id` to prevent conflicts when running multiple Claude Code instances simultaneously
- **Stale file cleanup**: Automatic cleanup of session files older than 24 hours on SessionStart

### Changed
- Session files moved to `/tmp/` with unique names based on session ID

### Refactored
- Split `lib/yaml-helpers.sh` into focused modules:
  - `lib/yaml.sh` - Pure YAML frontmatter parsing
  - `lib/config.sh` - Configuration resolution (user/project scope)
  - `lib/session.sh` - Session management and hook initialization

## [1.2.0] - 2026-01-14

### Changed
- **Breaking**: Session notifications now trigger based on idle time (time since last interaction) instead of total session duration
- Activity timestamp is updated on each user prompt, so notifications fire only after periods of inactivity
- Moved from environment variable (`TELEGRAM_SESSION_START`) to file-based tracking (`.claude/.telegram-session-start`)

### Added
- New `UserPromptSubmit` hook to track user activity timestamps

## [1.1.1] - 2026-01-13

### Fixed
- Fixed hooks.json schema: wrapped event handlers in required top-level `"hooks"` key to match Claude Code's expected format

## [1.1.0] - 2026-01-13

### Added
- Dual-scope configuration support: settings can now be defined at both user level (`~/.claude/telegram.local.md`) and project level (`.claude/telegram.local.md`)
- Project-level settings override user-level settings for flexible per-project customization

### Changed
- Refactored shell scripts to use idiomatic bash patterns:
  - Use arrays instead of string concatenation for collecting missing dependencies/credentials
  - Use parameter expansion (`${value:-$default}`) for default values
  - Combine multiple `sed` calls into single invocations
  - Simplify error handling syntax

## [1.0.0] - 2026-01-09

### Added
- Initial release
- `/telegram` command for sending manual notifications
- Automatic session-end notifications when idle time exceeds threshold
- Configurable session threshold (default: 10 minutes)
- Custom notification message support
- Credential validation on session start
