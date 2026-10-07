# continuity

Keep working through a compaction, and keep the prompt cache warm.

```
ctx ██████████░░░░░░ 61% 610k/1M   session 2h13m   ⏱ 42:17
over 60%: handover + compact after this turn
```

Its lines sit in a column above the prompt, a blank row above them; other plugins' bands (surveys, tips, codex-review, fleet) draw on their own lines below.

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

### Cache timer

A real-time countdown to the prompt cache's expiry, on the gauge's line (formerly the cache-timer mod):

```
⏱ 42:17        green while more than 25% of the cache lifetime is left
⏱ 9:58         yellow from 25%
⏱ 4:31         red from 10%, with one toast: send a message to keep it warm
● cache cold   once it has expired
```

- `turn.step` records each main-loop request's cache read/write; the countdown starts from that request's start.
- The lifetime follows Claude Code's order: `FORCE_PROMPT_CACHING_5M`, `CLAUDE_CODE_PROMPT_CACHE_TTL`, `promptCacheTtl` in settings, `ENABLE_PROMPT_CACHING_1H`, then 1h on a subscription and 5m otherwise. A cache hit after more than 5 minutes proves 1h; a miss proves 5m.

The note holds: your first and latest prompts, cwd, branch and worktree, uncommitted files, last commit, open to-dos (TodoWrite or the Task tools), and the last test/lint/build run with its last 15 lines.

## Commands

- `/handover`: do it now
- `/continuity [on|off]`: status, pause, resume

## Configuration

| Option | Default | |
|---|---|---|
| `threshold` | `60` | handover at this % of context |
| `resumeAfterLimit` | `true` | continue after a usage limit resets |
| `cacheTtl` | `auto` | `auto`, `5m` or `1h` |
| `cacheYellowAt` | `0.25` | share of the cache lifetime left when the timer turns yellow |
| `cacheRedAt` | `0.1` | share left when it turns red |
| `cacheToast` | `true` | one toast when it turns red |

Needs function hooks (`CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`).
