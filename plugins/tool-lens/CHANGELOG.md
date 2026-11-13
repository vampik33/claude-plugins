# Changelog

All notable changes to the tool-lens plugin will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.1.0] - 2026-11-13

### Added
- A line under every tool call: a colored icon per tool (yellow running, green done, red errored), how long it ran and an estimate of the tokens it used (arguments plus result, about 4 characters a token)
- A `▸ diff +N −M` toggle on Edit, Write and file-changing Bash calls that expands the change inline; Claude Code's own Edit/Write diff moves into it. A Bash diff Claude Code recorded only in part says how many changed files it leaves out (`+12 more files`) and keeps Claude Code's own diff under the call
- One line per call under a folded group (`Read 3 files, ran 2 shell commands`), so the figures show without ctrl+o
- Calls made before the mod loaded, or in a resumed session, get their figures from the tail of the session log, marked `≈`
