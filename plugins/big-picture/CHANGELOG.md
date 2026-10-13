# Changelog

All notable changes to the big-picture plugin will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.1.0] - 2026-10-13

### Added
- Jev (TypeSafe) judges every 10 tool calls and at each turn's end whether the work is big; once it is, Haiku writes a visual HTML summary of the session in the style of HumanLayer's show-me (Mermaid diagrams, file and call trees)
- Jev then judges whether the work since needs the summary updated; Haiku updates the previous page; during a turn rewrites are at least 5 minutes apart, a turn's end may always rewrite
- `/big-picture` and a `summary` line above the prompt (hotkey `s`) show and hide the page in an Orca browser tab, reloaded on each rewrite; the line shows the summary's state
