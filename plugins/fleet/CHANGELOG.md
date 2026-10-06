# Changelog

All notable changes to the fleet plugin will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.2.0] - 2026-10-06

### Added
- A line above the prompt with the batch's counts and a `show`/`hide` button (hotkey `f` while the band is focused) that toggles the pane; drawn once an agent or shell has run, or while the pane is open

### Changed
- `/fleet` toggles the pane: closes it when open

### Removed
- The status-line entry: the line above the prompt shows the same counts

## [0.1.0] - 2026-10-05

### Added
- Side pane with the session's subagents, background shells and the repo's worktrees, elapsed times ticking live
- Opens by itself when 2+ agents run; `/fleet` opens it any time
- Toast per finish or failure, a chime on failure and on all done, a Telegram summary when away
