# Changelog

All notable changes to the big-picture plugin will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.3.1] - 2026-10-13

### Changed
- The progress question no longer sends the running shells' output to Jev (TypeSafe, a third party), as it may hold secrets: Jev gets the commands alone and judges whether their progress is worth a rewrite; only Haiku reads the output

### Fixed
- The progress check took a running shell's id and output file from the Bash result's text, so any command that printed "running in background with ID: … Output is being written to: ….output" could make the mod read that file and send its end to Jev and Haiku. The id now comes from the call's record (`backgroundTaskId`), and the file must be that id's `.output` in a `tasks` directory, with no `..`

## [0.3.0] - 2026-10-13

### Added
- Every 30 minutes, the background shells still running (found in the transcript: started, with no completion notice yet) have the last 2 KB of their output read; when it moved since the last look, Jev is asked whether it changed the picture, and on a yes the summary is rewritten with it. Nothing is asked before a summary exists, with no shell running, or on output unchanged since a no
- Every summary write is handed the running commands and their latest output, so turn-end updates show their progress too
- `/big-picture update` and an `update` button on the `summary` line (hotkey `u`) rewrite the summary now, through the same Haiku write, with no Jev question; from then on the work counts as big. A press while a check runs is run once after it

### Fixed
- The hooks description said the summary comes from `$.model.fork`; it is Haiku via `$.model.complete`

## [0.2.2] - 2026-10-13

### Changed
- The `summary` line above the prompt shows only once there is something to show (a summary being written, written, or failing), or while the summary is open so it can be hidden; before that, and while Jev only judges work with no summary yet, it is hidden

## [0.2.1] - 2026-10-13

### Fixed
- Looking for a tab closed by hand started a new `orca tab list` every 2 seconds while Orca took about 8 seconds to answer (as it does when no browser tab is left), piling up processes; a look now waits for the last one
- The README said the button turns back to `show` within 2 seconds; it is within about 10

## [0.2.0] - 2026-10-13

### Added
- Outside Orca, the summary is shown in a terminal pane: Haiku writes it as text (headings, paragraphs, diagrams and trees drawn in text) instead of an HTML page, and `/big-picture` and the `summary` line open and close the pane

### Fixed
- A tab closed in Orca by hand left the button on `hide`; the mod now looks for its open tab every 2 seconds and turns the button back to `show`
- Presses while a show or hide was under way each opened another tab; they are now dropped

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
