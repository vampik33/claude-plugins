# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.2] - 2026-11-25

### Added
- `LICENSE` with the MIT license text the plugin is released under

### Changed
- README follows the repository's layout: the plugin's name as the title, Requirements before Installation, and a License section

## [1.1.1] - 2026-11-19

### Fixed

- README: install with `claude plugin install explain-changes@vampik-plugins` instead of `claude plugin add …`, which is not a Claude Code command
- README: documents `--commits N`, untracked files in the default scope, and how untracked, binary and large diffs are handled

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
