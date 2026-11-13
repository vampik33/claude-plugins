# Changelog

All notable changes to the chat-view plugin (formerly prompt-clock) will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.2.1] - 2026-11-13

### Fixed
- A typed slash command (`/review the diff`, a skill) shows when you sent it: a `sent 16:42:07` line under the command, kept in the transcript. Claude Code draws a command's line itself and no mod can restyle it, so it gets no bubble; it never shows the time twice

## [0.2.0] - 2026-11-13

### Added
- Your prompts drawn as bubbles on the right of the terminal, with the send time under each (`bubbles` option, on by default)
- The time each reply started streaming, in front of the block that opens it; a resumed session's earlier replies show when their row was written

### Changed
- Renamed from `prompt-clock` to `chat-view`: uninstall `prompt-clock@vampik-plugins` and install `chat-view@vampik-plugins`

### Fixed
- Prompts sent from the Claude desktop app get their send time: the desktop app's prompts arrive as `sdk` or unstamped, not `composer`, so the mod skipped them. Remote Control (`bridge`) prompts get it too

## [0.1.3] - 2026-10-26

### Fixed
- A prompt typed `__proto__` keeps its send time: the time maps have no prototype
- A prompt typed `constructor`, `toString` or another `Object.prototype` name is no longer shown an inherited function as its send time

## [0.1.2] - 2026-10-14

### Changed
- Times come from the engine's clock (`$.clock.now`), so tests can pin them
- The transcript is read only for a resumed or forked session, not on every fresh start
- README notes that a resumed session's earlier times need classic hooks, which an organization-managed Claude Code runs only for plugins it lists

## [0.1.1] - 2026-10-06

### Fixed
- `cap` with `keep = 0` kept every entry (`slice(-0)`) instead of none

## [0.1.0] - 2026-10-05

### Added
- Send time in front of each typed prompt in the transcript
- Start → end times on each turn's duration line
- Times for a resumed session read from its transcript
