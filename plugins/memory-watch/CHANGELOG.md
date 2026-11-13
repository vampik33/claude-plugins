# Changelog

All notable changes to the memory-watch plugin will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.1.8] - 2026-11-13

### Fixed
- The band line is its own part of the band with no blank row above it, so mods' lines no longer have blank rows between them. The shared `stack.ts` column is gone: Claude Code now draws each mod's band tree as a separate part, so the column could no longer merge or order the mods' lines

## [0.1.7] - 2026-11-13

### Changed
- In the desktop app, the band's `show`/`hide` button sits at the row's far end with no hotkey badge; the terminal keeps `m`

## [0.1.6] - 2026-11-11

### Changed
- The band line's slot key is renumbered now that palette's slot 10 is gone; the band order is unchanged

## [0.1.5] - 2026-11-10

### Changed
- The band line takes its new fixed slot; top to bottom the band reads palette, memory, summary, ship, watchdog, codex, fleet, then the continuity gauge

## [0.1.4] - 2026-11-10

### Changed
- The band line joins the column every vampik band mod shares: whichever of them are installed, in any order, their lines stack with one blank row above them and none between, codex-review on top, continuity at the bottom, the rest in a fixed order

## [0.1.3] - 2026-10-14

### Changed
- Every pane and band test runs on both the terminal and the desktop surface

## [0.1.2] - 2026-10-14

### Fixed
- A `/clear` empties the pane's list and the `● N new` count, as the new conversation has written no memory yet
- Memory written under a non-default `CLAUDE_CONFIG_DIR`, or in the directory the `autoMemoryDirectory` setting names (`~/` expanded; ignored in the checked-in project settings, as Claude Code does), is listed too

## [0.1.1] - 2026-10-13

### Changed
- The `memory  show` / `hide` line above the prompt appears only once the session has written memory, or while the pane is open

## [0.1.0] - 2026-10-13

### Added
- A side pane listing each auto-memory file the session's `Write` / `Edit` calls create or update, newest first (last 50): the memory's name (or file), time, action, type, lines added and removed, and its description
- `/memory-watch` and a `memory  show` / `hide` line above the prompt (hotkey `m`) toggle the pane; the line counts writes made while it was hidden
