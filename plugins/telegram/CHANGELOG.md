# Changelog

All notable changes to the Telegram plugin will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
- Automatic session-end notifications when duration exceeds threshold
- Configurable session threshold (default: 10 minutes)
- Custom notification message support
- Credential validation on session start
