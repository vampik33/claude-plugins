# Changelog

All notable changes to the Telegram plugin will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
