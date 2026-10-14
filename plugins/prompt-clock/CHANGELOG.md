# Changelog

All notable changes to the prompt-clock plugin will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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
