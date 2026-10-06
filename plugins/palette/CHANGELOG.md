# Changelog

All notable changes to the palette plugin will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.1.0] - 2026-10-06

### Added
- `/palette` shows or hides a side pane listing the session's custom agents, skills and slash commands, grouped by source: project, user, each plugin, MCP (built-ins left out)
- Clicking a command or skill puts `/<name> ` at the start of the prompt (replacing a leading command, keeping the rest of the draft); clicking an agent inserts `@agent-<name> ` at the cursor. Nothing is sent
- Group headers fold and unfold; `↻` re-reads the lists
