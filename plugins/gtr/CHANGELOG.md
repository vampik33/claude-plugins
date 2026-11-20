# Changelog

All notable changes to the gtr plugin will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [1.0.2] - 2026-11-20

### Fixed
- `ai`, `config`, `copy`, `editor`, `new`, `rm` and `run` tell Claude to pass each argument as its own shell word: `git gtr new "$ARGUMENTS"` handed `feature --force --name backend` to gtr as one argument

## [1.0.1] - 2026-11-19

### Fixed
- README: install with `claude plugin install gtr@vampik-plugins` instead of `claude plugin add …`, which is not a Claude Code command

## [1.0.0]

### Added
- Initial release (changes before 1.0.1 were not recorded)
