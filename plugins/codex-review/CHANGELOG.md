# Changelog

All notable changes to the codex-review plugin will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.3.3] - 2026-10-26

### Fixed
- Codex's text holding `<codex-review` or `</codex-review` with no closing `>` is neutralised too, so it cannot open or close the review's fence
- A review whose `next_steps` holds a non-string is rejected as not matching the schema, instead of having those entries dropped
- A non-string `parseError` or `stderr` from the companion no longer becomes the job's error; the default message is used
- A companion job with a non-string id is not taken for ours

## [0.3.2] - 2026-10-14

### Changed
- Job start and end times, and the elapsed and "ago" texts the hooks draw, come from the engine's clock (`$.clock.now`) instead of `Date.now()`, so tests drive them through the mocked clock
- The line, cancel, button, survey and raw-review tests run on both terminal and desktop; a mobile test covers the plain-text line

## [0.3.1] - 2026-10-14

### Fixed
- A finished review opens the findings pane by itself only where the pane docks beside the transcript (fullscreen); elsewhere a toast says `/cx last` opens them, instead of the pane taking over the conversation
- `Send` and `verify only` send the findings ticked at the press, not the ones ticked when the pane was last drawn
- If the line's ticking module fails, the line falls back to plain text instead of disappearing for the rest of the session

### Changed
- The CodexReview tool is listed in Claude's tools from the start instead of behind ToolSearch

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
