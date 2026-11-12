# Changelog

All notable changes to the fix-findings plugin will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.2.0] - 2026-11-12

### Changed
- `converge` stops after three rounds instead of five, naming the defects that kept coming and asking whether to rethink the approach
- After the first two reviews, a review covers only what changed since the last one (`reviews` in the ledger)
- A fix covers every instance of the defect class, not one line
- A settled finding raised again stays settled unless its code changed or the review brings new evidence

### Added
- The `pre-existing` verdict and ledger state: a defect the change did not introduce is reported, not fixed, and does not keep the loop going

## [0.1.0] - 2026-11-09

### Added
- The `fix-findings` skill: verify each review finding, fix the valid ones, attack the diff, run the gates, report the evidence
- `converge` mode: a ledger, a failing regression test per finding, and up to five independent review rounds, stopping when a finding has come back twice
- A Stop hook that sends the model back once per turn while this session's loop is still running
