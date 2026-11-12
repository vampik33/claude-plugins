# fix-findings

Treats review findings as claims to prove. Each one is checked against the code, only the valid ones are fixed, the resulting diff is attacked, and an adversarial review runs before the report.

## Installation

```bash
claude plugin install fix-findings@vampik-plugins
```

## Usage

```
/fix-findings <findings, or a file of them>
/fix-findings converge <findings, or a file of them>
```

For an open PR with no findings yet, run a code review first, or use `converge`, which starts with one.

## Converge mode

Each round verifies the open findings with a separate agent, writes a regression test that fails first, makes the smallest fix covering every instance of the defect, and commits locally. Once none are open, it runs the full tests and an adversarial review: of everything since the base commit for the first two reviews, then only of what changed since the last one. What that review raises starts the next round. **It never pushes.**

The loop ends when a review raises nothing material. It stops early when a finding has come back twice, after three rounds (then it names the defects that kept coming and asks whether to rethink the approach), when a product decision is needed, or when a gate cannot run.

A real defect the change did not introduce is marked `pre-existing`: reported, not fixed, and it does not keep the loop going. A settled finding raised again stays settled unless its code changed or the review brings new evidence.

- Progress lives in `.fix-findings/ledger.json`, which the skill adds to `.git/info/exclude`. A loop with `status: running` resumes after a crash.
- The `CodexReview` tool comes from the `codex-review` plugin. Without it the skill uses the project's own adversarial review. If none can run, the loop stops rather than substituting Claude's own review.
- A project with no test suite skips the failing test. The report lists those findings as unproven by test.

## The Stop hook

If Claude tries to end a turn while `.fix-findings/ledger.json` in the session's working directory says `running`, the hook sends it back with what is still open. It does so once per turn and not while background work is in flight, so it cannot hold a session forever. A ledger whose `sessionId` names another session is ignored.

`classic.*` hooks don't run where an organization manages Claude Code. There the skill still works, without the hook.
