# Changelog

All notable changes to the continuity plugin will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.1.0] - 2026-10-05

### Added
- Live context gauge and session length above the prompt
- Past a threshold: handover note, compaction and a continue prompt, after a 5 s grace a prompt cancels
- Every compaction keeps the note's facts; after `/compact` it offers to continue
- Waits out a usage limit and continues after the reset
- `/handover` and `/continuity [on|off]`
