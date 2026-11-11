# Changelog

All notable changes to the ship plugin will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.1.3] - 2026-11-11

### Changed
- The band line's slot key is renumbered now that palette's slot 10 is gone; the band order is unchanged

## [0.1.2] - 2026-11-10

### Changed
- The band line takes its new fixed slot; top to bottom the band reads palette, memory, summary, ship, watchdog, codex, fleet, then the continuity gauge

## [0.1.1] - 2026-11-10

### Changed
- The band line joins the column every vampik band mod shares: whichever of them are installed, in any order, their lines stack with one blank row above them and none between, codex-review on top, continuity at the bottom, the rest in a fixed order

## [0.1.0] - 2026-10-14

### Added
- A line above the prompt with the branch, commits not pushed, uncommitted files, installed mods behind the repo's `marketplace.json`, and `restart needed` after an update
- `/ship` and a `ship` button: push, refresh the marketplace, update only the mods behind, then report what changed and what needs a restart
