# Changelog

All notable changes to the palette plugin will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.2.0] - 2026-10-06

### Added
- A `most used` group on top: the 10 items used most, counted across sessions in the plugin's store from commands run, skills invoked (typed or through the Skill tool) and agents spawned

### Changed
- Each item takes two lines, its name then its description indented below, with a blank line between items; items are indented under their group header

## [0.1.0] - 2026-10-06

### Added
- `/palette` shows or hides a side pane listing the session's custom agents, skills and slash commands, grouped by source: project, user, each plugin, MCP (built-ins left out)
- Clicking a command or skill puts `/<name> ` at the start of the prompt (replacing a leading command, keeping the rest of the draft); clicking an agent inserts `@agent-<name> ` at the cursor. Nothing is sent
- Group headers fold and unfold; `↻` re-reads the lists
