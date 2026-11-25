# Changelog

All notable changes to the fix-findings plugin will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.2.5] - 2026-11-25

### Changed
- README follows the repository's layout: the plugin's name as the title, Requirements before Installation, and a License section

## [0.2.4] - 2026-11-20

### Changed
- The turn-end hook lists agents only once it has found a running ledger this session owns, not on every turn, and reads the ledger again after listing them, so a ledger that another session took over or that finished meanwhile sends nothing back
- The send-back recognises its own prompt by `$.plugin.name` rather than a copy of the plugin's name

## [0.2.3] - 2026-11-20

### Fixed
- `plugin.json` names the `$.state` contract (`"types": "./types/index.d.ts"`), as the other mods do
- The description, README and skill say "turn-end hook" for what has been a `turn.complete` hook since 0.2.2, not "Stop hook"

## [0.2.2] - 2026-11-20

### Fixed
- The Stop hook no longer gets skipped where an organization manages Claude Code: it sends the model back from `turn.complete` with `$.prompt.submit`, not from the classic `Stop` hook, which the organization's `cc-plugin-sec-default` runs only for plugins it lists

### Changed
- The send-back is a prompt from the fix-findings plugin after the turn ends, rather than a block of the stop; it still comes once per turn that you or a background task started, and a refused prompt shows a toast and frees it for the next turn
- It waits while a subagent is pending or running, but no longer sees background shells

## [0.2.1] - 2026-11-19

### Fixed
- README: notes the Stop hook needs function hooks (`CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`)

## [0.2.0] - 2026-11-12

### Changed
- `converge` stops after three rounds instead of five, naming the defects that kept coming and asking whether to rethink the approach
- After the first two reviews, a review covers only what changed since the last one (`reviews` in the ledger)
- A fix covers every instance of the defect class, not one line
- A settled finding raised again stays settled unless its code changed or the review brings new evidence

### Added
- The `pre-existing` verdict and ledger state: a defect the change did not introduce is reported, not fixed, and does not keep the loop going

## [0.1.0] - 2026-11-09

### Added
- The `fix-findings` skill: verify each review finding, fix the valid ones, attack the diff, run the gates, report the evidence
- `converge` mode: a ledger, a failing regression test per finding, and up to five independent review rounds, stopping when a finding has come back twice
- A Stop hook that sends the model back once per turn while this session's loop is still running
