---
name: fix-findings
description: Verify code-review findings against the code, fix only the valid ones, attack the resulting diff, run an adversarial review and report the evidence. With `converge`, repeat failing test, fix and independent review until nothing material remains, for up to five rounds. This skill should be used when the user says "verify these findings", "fix the valid ones", "check the review comments", "converge on these findings", "run a convergence loop", or "/fix-findings", or pastes findings from Codex, CodeRabbit, a security scan or a human reviewer. For an open PR that has no findings yet, run a code review first, or use `converge`, which starts with one.
argument-hint: "[converge] [findings or file]"
---

# fix-findings

Arguments: $ARGUMENTS

Input: findings pasted by the user, a file of findings, or a review tool's output. A finding is a claim to be proven, not a task.

If the first argument is `converge`, follow **Converge mode** below; it uses steps 1 to 4 inside each round. Otherwise run steps 1 to 5 once.

## 1. Verify each finding

Check each one against the code and, when behaviour depends on a host, device or running service, against that real environment. A plausible reading is not evidence. Use one agent per finding when there are more than a few: `finding-verifier` where it is installed, otherwise a general-purpose agent briefed with this step.

Mark each **valid**, **partly valid** or **invalid**, and cite the file and line or the observed behaviour that decides it. Look in the project's plans, tests and rules for intent before calling a deliberate choice a bug.

## 2. Fix only what is valid

Make the smallest fix that removes the failure. Follow the project's CLAUDE.md for version bumps, commit shape and branch policy. Report an invalid finding with its evidence; do not change code to quiet it.

## 3. Attack the diff

List concrete scenarios in your own changes, with file and line: stale state, responses arriving out of order, cached failures, retries, failure paths, and callers of the changed code. Fix the real ones.

## 4. Run the gates

Run the project's tests and linters. Then run its adversarial review on the diff, Codex where available. If the review cannot run, say so; never substitute your own. Treat its findings as new input to step 1.

## 5. Report

A table with each finding, its verdict, the evidence and the fix. Then what was verified and how, and what stayed unverified. Commit or push only if the user asked.

# Converge mode

Asking for this mode permits local commits, because the Codex review reads commits and not the working tree. It never permits a push.

## Start

If `.fix-findings/ledger.json` exists with `status` `running`, resume from it and set its `sessionId` to `${CLAUDE_SESSION_ID}`. Otherwise:

1. Add `.fix-findings/ledger.json` to `.git/info/exclude`, so it is never committed.
2. Record `base`: the commit before the work under review. On a feature branch that is the merge base with the default branch. On the default branch, ask the user unless it is obvious from the request.
3. If the change under review is still uncommitted, ask the user before going on.
4. If no findings were given, run the first review against `base` and take its findings as round 1.
5. Create the ledger.

## The ledger

`.fix-findings/ledger.json` in the session's working directory, updated after every state change:

```json
{
  "sessionId": "${CLAUDE_SESSION_ID}",
  "status": "running",
  "base": "<commit>",
  "round": 1,
  "stopReason": null,
  "findings": [
    {
      "id": "F1",
      "claim": "one line, with file and line",
      "state": "open",
      "rounds": [1],
      "evidence": "what decided the verdict",
      "test": "path::name, or 'skipped: no test suite'",
      "commit": "<sha>"
    }
  ]
}
```

- `sessionId` is this session's id, exactly as shown. The Stop hook ignores a ledger that names another session.
- `status` is `running`, `converged` or `stopped`.
- `state` is `open` until the finding is settled, then `fixed` or `invalid`.
- `rounds` lists every round that raised the finding. A review that raises a settled finding again adds the round to the same entry and sets it back to `open`; it is not a new entry.

## Each round

For each `open` finding:

1. Verify it as in step 1. Have a separate agent of that kind do it, so the verdict is not your own. Invalid findings are settled with their evidence.
2. Write a regression test and run it. Show that it fails, and for the expected reason.
3. Make the smallest fix, as in step 2, and show the test passing.
4. Make one local commit per logical fix, staging only the files of that fix, in the project's commit style.

In a project with no test suite, do not add one. Record `skipped: no test suite` in `test`, verify the fix the way the project's CLAUDE.md requires, and list the finding as unproven by test in the report.

When none are `open`:

5. List scenarios as in step 3, over what changed since the last such pass, but do not fix them here. Add each real one to the ledger as `open` under the current round and go back to the steps above.
6. Run the complete tests and linters. A failure caused by the loop's changes goes into the ledger the same way.
7. Confirm that every file the loop changed is committed, and note `HEAD`. The gates and the review must judge that same state.
8. Run the adversarial review of everything since `base`, with the `CodexReview` tool (`base` set to the ledger's) where available. If it cannot run, set `status` to `stopped` and say so.
9. Add what it raises to the ledger under the next round, and increase `round`. If it raises nothing material and `HEAD` and those files are unchanged since step 7, set `status` to `converged`.

## Stop

Set `status` to `stopped`, with `stopReason`, when:

- a finding has come back twice, so three entries in `rounds`;
- round 5 is finished and the latest review still raised something;
- a product decision is needed, or a gate cannot run.

While `status` is `running`, a Stop hook sends you back once per turn if you try to end early. To end for a reason above, set `status` first.

## Report

The table of step 5 with each finding's test, commit and rounds. Then the number of rounds, why the loop ended, the commits made, and what stayed unverified. Do not push.
