# Changelog

All notable changes to the plan-renamer plugin will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [1.0.0] - 2026-02-15

### Added
- PostToolUse hook on ExitPlanMode to auto-rename plan files
- Title extraction from `# Plan: ` and `# ` headings
- Slugification with collision handling
- Plans directory detection from settings, project, and user-level paths
- `/rename-plans` command for batch renaming existing plan files
- Debug mode via `PLAN_RENAMER_DEBUG=1`
