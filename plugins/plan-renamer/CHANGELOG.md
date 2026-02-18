# Changelog

All notable changes to the plan-renamer plugin will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [1.2.1] - 2026-02-18

### Changed
- `/rename-plans` command now executes immediately without asking for confirmation

## [1.2.0] - 2026-02-16

### Removed
- PermissionRequest hook on ExitPlanMode — auto-rename broke plan workflow; use `/rename-plans` command instead

## [1.1.2] - 2026-02-15

### Changed
- Added comprehensive debug output across all stages: startup environment, settings file resolution, directory scanning, slug generation, and collision handling

## [1.1.1] - 2026-02-15

### Changed
- Removed 80-character truncation from slug generation, allowing full-length plan titles

## [1.1.0] - 2026-02-15

### Fixed
- Plans directory lookup now checks user-level settings (`~/.claude/settings.json`, `~/.claude/settings.local.json`)
- Relative `plansDirectory` paths in user-level settings resolve against `~/.claude/` instead of project dir
- Empty project `plans/` directory no longer intercepts lookup — directories must contain `.md` files

## [1.0.0] - 2026-02-15

### Added
- PostToolUse hook on ExitPlanMode to auto-rename plan files
- Title extraction from `# Plan: ` and `# ` headings
- Slugification with collision handling
- Plans directory detection from settings, project, and user-level paths
- `/rename-plans` command for batch renaming existing plan files
- Debug mode via `PLAN_RENAMER_DEBUG=1`
