# Changelog

All notable changes to the Telegram Notifier plugin will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.9.11] - 2026-11-25

### Security
- Debug mode (`TELEGRAM_NOTIFIER_DEBUG=1`) in the Stop hook no longer traces the Stop event, which holds Claude's last answer: `session-notification.sh` starts tracing only after it has read the session ID, cwd and transcript path from the event. Tracing inherited from `bash -x` or an exported `SHELLOPTS=xtrace` is turned off for the whole hook unless debug mode turns it back on. `tests/hooks.bats` checks that the answer never appears in the hook's output

## [1.9.10] - 2026-11-25

### Security
- The automatic Stop notification no longer sends the start of Claude's last answer (up to 1000 characters), which could quote file contents, commands or secrets; it sends only the counts and names it took from the transcript (file base names, the first word of commands). `tests/hooks.bats` checks the payload sent to the stubbed `curl`
- The summary's command names come only from the first line of each command, skip leading `NAME=value` assignments and keep only a word shaped like a program name (no `=`, at most 32 characters; a path is cut to its base name): heredoc body lines and inline assignments such as `GITHUB_TOKEN=…` or `DB_PASSWORD=…` were sent as command names
- The summary is bounded in size: file base names are cut to 64 characters and a command word too long for a program name is left out, so one huge command or file name can no longer make the message too long for `send-telegram.sh`'s arguments and drop the notification
- The summary keeps at most 6 distinct edited and 6 created file names, so a transcript with tens of thousands of distinct edits no longer runs past the Stop hook's 10 s; 6 or more files show as `Edited 6+ files` / `Created 6+ files`, and 4 or 5 edits (3 to 5 creates) show their exact count (6 or more used to show as 5)

### Removed
- `extract_last_assistant_message` in `lib/session.sh`, which only that excerpt used

## [1.9.9] - 2026-11-25

### Security
- README: the troubleshooting check for credentials tests whether `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` are set instead of echoing the token, which put it in terminal scrollback or tool output

## [1.9.8] - 2026-11-25

### Changed
- README: the title is the plugin's name, Prerequisites is now Requirements, and the License section links the license file

### Removed
- The README's Testing section: running the checks is now in the repository's CONTRIBUTING.md

## [1.9.7] - 2026-11-20

### Changed
- The Stop hook's transcript summary reads the transcript in one streaming `jq` pass instead of one per tool, keeping only what it shows (file base names, the first word of up to five command lines, a count of reads) rather than whole commands, and takes base names in `jq` instead of running `basename` once per edit: a 112 MB transcript with 1,600 edits took 1.1 s instead of 5.3 s, well inside the hook's 10 s, and a 64 MB one of large Bash commands 0.6 s instead of 1.6 s, within 64 MB of memory
- `lib/config.sh` looks up the project and user configs in one loop instead of two copies of the same block; `summarize-transcript.sh` joins its file and command lists through one helper; `update-activity.sh` no longer runs `mkdir -p /tmp`

### Fixed
- A file name with a quote or backslash in it (`Ed's.ts`) no longer drops itself and the names after it from the summary's Edited and Created lists: the names went through `xargs`, which reads quotes and backslashes as quoting
- A transcript line that isn't valid JSON no longer ends the summary's tool extraction there: the lines after it still count

## [1.9.6] - 2026-11-20

### Security
- Debug mode (`TELEGRAM_NOTIFIER_DEBUG=1`) no longer prints the bot token: `send-telegram.sh` drops `set -x` (it traced the credential check, which expands the token), and `check-credentials.sh` turns tracing off around its credential check, whose trace went to the hook output
- Running a hook script under `bash -x` (or with `SHELLOPTS=xtrace` exported) no longer prints the bot token: `send-telegram.sh` turns tracing off before it reads the token, and so does `update-activity.sh` before its credential check

### Fixed
- `/telegram` passes the message through a quoted heredoc, so quotes, `$` and backticks in it stay text instead of running as shell
- curl gives up after 8 s (5 s to connect), inside the Stop hook's 10 s timeout, so a slow send fails with the script's own error
- The hook commands quote `${CLAUDE_PLUGIN_ROOT}`, so a plugin path with spaces works
- The skill's `name` is `telegram-messaging`, matching its folder

### Added
- `network.hosts` in `plugin.json` names `api.telegram.org`
- README: the automatic notifications are classic hooks, which don't run where an organization allows only managed hooks; what the Stop notification sends

## [1.9.5] - 2026-11-19

### Fixed
- Without `jq`, the SessionStart hook exited 127 while reading the session ID, before its dependency check, so the "Install jq" message never showed; it now reads the session ID only when `jq` is present and reports `jq` as a missing dependency

## [1.9.4] - 2026-11-19

### Fixed
- SessionStart hook printed its missing-credentials and missing-dependency errors as multi-line JSON, and Claude Code shows only the first line of a failing hook's stderr, so the error read just `{`; each error is now one line

## [1.9.3] - 2026-11-19

### Fixed
- README: install with `claude plugin install telegram-notifier@vampik-plugins` instead of `claude plugin add …`, which is not a Claude Code command

## [1.9.2] - 2026-11-12

### Fixed
- telegram-messaging skill pointed to a nonexistent `examples/telegram-notifier.local.md.example`; it now names the real `examples/telegram.local.md.example`

## [1.9.1] - 2026-10-06

### Fixed
- HTML escaping on bash 5.2+ turned `<` and `>` into `<lt;` and `>gt;` (`&` in a `${var//…/…}` replacement means the matched text), breaking Telegram's HTML parse
- A `#` inside a config value (with no space before it) was stripped as a comment
- `extract_body` used a bare `((dash_count++))`, which fails under `set -e` when the count is 0

### Added
- shellcheck-clean scripts and a bats suite (`bats plugins/telegram-notifier/tests`), with `curl` stubbed

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
