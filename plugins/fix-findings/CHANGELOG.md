# Changelog

All notable changes to the fix-findings plugin will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.1.0] - 2026-11-09

### Added
- The `fix-findings` skill: verify each review finding, fix the valid ones, attack the diff, run the gates, report the evidence
- `converge` mode: a ledger, a failing regression test per finding, and up to five independent review rounds, stopping when a finding has come back twice
- A Stop hook that sends the model back once per turn while this session's loop is still running
