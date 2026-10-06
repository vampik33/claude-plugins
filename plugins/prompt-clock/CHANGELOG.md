# Changelog

All notable changes to the prompt-clock plugin will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.1.1] - 2026-10-06

### Fixed
- `cap` with `keep = 0` kept every entry (`slice(-0)`) instead of none

## [0.1.0] - 2026-10-05

### Added
- Send time in front of each typed prompt in the transcript
- Start → end times on each turn's duration line
- Times for a resumed session read from its transcript
