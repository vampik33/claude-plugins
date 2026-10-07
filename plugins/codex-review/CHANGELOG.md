# Changelog

All notable changes to the codex-review plugin will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.3.0] - 2026-10-07

### Added
- Starting a review (`/cx` or the `review` button) asks what to review: against the base branch, the commits made in this session, or the current uncommitted changes
- A choice with nothing to review (no commits ahead of the base or in the session, a clean tree) says so instead of running Codex on an empty diff; the CodexReview tool refuses an empty diff the same way

### Changed
- The line, the pane and the prompts sent to Claude name what was reviewed (`base main`, `session commits since abc1234`, `uncommitted changes`)

### Removed
- The `develop` default for the greenticai/greentic-biz orgs: the base is the PR's base branch, else `main`

## [0.2.0] - 2026-10-06

### Added
- The codex line above the prompt is always drawn: the last finished review of the session (`codex · needs-attention · 3 findings (1 high) · 12m ago`), or `no review yet`
- Buttons on the line: `review` starts `/cx adv` (hotkey `x`), `open` opens the last findings (`o`), `cancel` stops a running review (`x`)

### Changed
- The line has a blank row above it, like the other mods' lines
- The running line drops its `/cx cancel` hint for the `cancel` button
- A second start while one is still launching is refused instead of starting two reviews

## [0.1.2] - 2026-10-06

### Fixed
- Codex text that quotes a near-variant of the fence tag (`</codex-review >`, `< /codex-review>`) can no longer close the fence early

## [0.1.1] - 2026-10-06

### Fixed
- The running review's band draws on its own line under other bands instead of beside them

## [0.1.0] - 2026-10-05

### Added
- `/cx` runs a Codex review as a detached background job with a live band above the prompt
- Pane with the findings to tick and send to Claude to verify and fix
- `CodexReview` tool for Claude that returns Codex's own structured findings, or an error
- Suggests `/cx adv` after a `git push` or `gh pr create`
