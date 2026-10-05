# continuity

Keep working through a compaction.

```
ctx ████████████░░░░ 76% 760k/1M   session 2h13m
over 75%: handover + compact after this turn
```

## Installation

```bash
claude plugin install continuity@vampik-plugins
```

## Behaviour

- The gauge turns yellow 15 points before the threshold and red at it; the session length ticks live.
- When an answered main-loop turn ends at or past the threshold, a toast gives 5 s to cancel (send a prompt, or `/continuity off`). Then it writes `~/.claude/handover/<session>.md`, compacts with instructions to keep the note's facts, and submits a prompt that continues from the note.
- Guards: not after an interrupted or failed turn, not in subagents, at most once per 3 turns.
- Every other compaction (`/compact`, the engine's automatic one) gets the note's facts too; after `/compact`, "Continue from the handover" is proposed in the prompt box.
- When a turn stops at a usage limit, it waits for the reset (countdown in the band) and continues.

The note holds: your first and latest prompts, cwd, branch and worktree, uncommitted files, last commit, open to-dos (TodoWrite or the Task tools), and the last test/lint/build run with its last 15 lines.

## Commands

- `/handover`: do it now
- `/continuity [on|off]`: status, pause, resume

## Configuration

| Option | Default | |
|---|---|---|
| `threshold` | `75` | handover at this % of context |
| `resumeAfterLimit` | `true` | continue after a usage limit resets |

Needs function hooks (`CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`).
