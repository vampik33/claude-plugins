# Changelog

All notable changes to the codex-review plugin will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.1.1] - 2026-10-06

### Fixed
- The running review's band draws on its own line under other bands instead of beside them

## [0.1.0] - 2026-10-05

### Added
- `/cx` runs a Codex review as a detached background job with a live band above the prompt
- Pane with the findings to tick and send to Claude to verify and fix
- `CodexReview` tool for Claude that returns Codex's own structured findings, or an error
- Suggests `/cx adv` after a `git push` or `gh pr create`
