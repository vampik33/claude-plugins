# Changelog

All notable changes to the memory-watch plugin will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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
