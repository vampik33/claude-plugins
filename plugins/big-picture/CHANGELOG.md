# Changelog

All notable changes to the big-picture plugin will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.1.2] - 2026-10-13

### Fixed
- The model's `<meta>` and `<link>` tags are now all dropped: a refresh's `http-equiv` could be entity-encoded past the 0.1.1 filter and navigate the tab away, and a `dns-prefetch` or `preconnect` link reaches out past the CSP; the page gets its own charset

## [0.1.1] - 2026-10-13

### Fixed
- The summary page ran whatever script Haiku wrote, so text injected into the session could run in the Orca tab; now the model's scripts and meta refreshes are stripped and a Content-Security-Policy lets only the mod's own Mermaid loader and Mermaid's pinned files run, with no other requests

## [0.1.0] - 2026-10-13

### Added
- Jev (TypeSafe) judges every 10 tool calls and at each turn's end whether the work is big; once it is, Haiku writes a visual HTML summary of the session in the style of HumanLayer's show-me (Mermaid diagrams, file and call trees)
- Jev then judges whether the work since needs the summary updated; Haiku updates the previous page; during a turn rewrites are at least 5 minutes apart, a turn's end may always rewrite
- `/big-picture` and a `summary` line above the prompt (hotkey `s`) show and hide the page in an Orca browser tab, reloaded on each rewrite; the line shows the summary's state
