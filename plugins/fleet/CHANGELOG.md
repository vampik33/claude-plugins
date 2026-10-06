# Changelog

All notable changes to the fleet plugin will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.2.1] - 2026-10-06

### Changed
- A blank row between the bands above and the fleet line

### Fixed
- The band's button reads `hide` only while the pane is drawn: a pane opened by itself on a terminal too narrow waited undrawn yet read `hide`, so the first press closed an invisible pane; `show` now opens it at any width
- The button and `/fleet` toggle on whether the pane is drawn, not on the module's own flag

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
