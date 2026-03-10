# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2026-03-10

### Added

- `--commits N` flag for explaining recent commit history
- "Inferring Intent" section with ordered strategies for deducing the "why" behind changes
- "Handling Large Diffs" section with grouping and prioritization guidance
- `references/git-commands.md` — shared git command reference for diff retrieval, untracked files, and binary files
- `references/examples.md` — six calibration examples showing good vs. mediocre explanations
- Expanded edge cases in `/explain` command (untracked files, binary files, shallow repos)

### Changed

- Skill description rewritten for better triggering accuracy
- Educational insight guidance now calibrated — skip insights for routine changes
- `/explain` command keeps minimal inline table for common cases, delegates edge cases to `git-commands.md`
- Untracked file handling: ≤10 read directly, 11+ ask user which to include

## [1.0.0] - 2026-02-02

### Added

- Initial release
- `/explain` command for explaining git changes with educational insights
- Support for `--staged` flag to explain only staged changes
- Support for `--unstaged` flag to explain only unstaged changes
- Support for file path arguments to filter changes
- Explanatory output style with `★ Insight` blocks
- Skill registration for natural language invocation
