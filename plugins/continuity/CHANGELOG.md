# Changelog

All notable changes to the continuity plugin will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.3.3] - 2026-10-14

### Changed
- Times come from the engine's clock (`$.clock.now()`), not `Date.now()`: the handover note, the limit wait, the cache countdown and its toast, and the plain-text gauge's session length
- The limit tests take the reset time from the mocked clock's start; a test checks the session length follows the engine's clock

## [0.3.2] - 2026-10-14

### Changed
- The band tests run on terminal and desktop; a test covers the plain-text gauge on surfaces with no `Client`
- README: where an organization manages Claude Code, the limit resume and the compaction note do not run

## [0.3.1] - 2026-10-14

### Fixed
- `/handover` failed every time: the host refuses a compaction under the command's own turn, so it now starts once that turn has ended
- `/handover` during a usage-limit wait also drops the wait, so the session no longer continues twice
- A reload while waiting out a usage limit keeps the wait and its countdown instead of dropping the resume
- `/continuity off` during a handover now stops it from continuing; the compaction under way finishes and the gauge shows it
- The gauge fits a narrow band: under 60 columns it drops the token count and shortens the bar, and its note line is cut rather than wrapped

## [0.3.0] - 2026-10-07

### Changed
- Default `threshold` lowered from 75% to 60%

## [0.2.1] - 2026-10-06

### Changed
- A handover whose compaction is skipped now waits the same 3 turns as a completed one before trying again, instead of writing a new note every turn

### Fixed
- Token counts from 999.5k up to 1M showed as `1000k` instead of `1M`
- A non-finite context percentage drew no gauge bar at all instead of an empty one
- A non-positive cache lifetime coloured the countdown green instead of red
- Prompts or output that quote a near-variant of the fence tag (`</handover-note >`, `</ handover-note>`) can no longer close the handover note's fence early

## [0.2.0] - 2026-10-06

### Added
- Prompt-cache countdown on the gauge's line, merged in from the cache-timer mod (which is retired): same TTL rules, colours and red toast, options `cacheTtl`, `cacheYellowAt`, `cacheRedAt`, `cacheToast`

### Changed
- The band's lines stack in a column with a blank row above them; other plugins' bands draw on their own lines below instead of between the gauge and the clock

## [0.1.0] - 2026-10-05

### Added
- Live context gauge and session length above the prompt
- Past a threshold: handover note, compaction and a continue prompt, after a 5 s grace a prompt cancels
- Every compaction keeps the note's facts; after `/compact` it offers to continue
- Waits out a usage limit and continues after the reset
- `/handover` and `/continuity [on|off]`
