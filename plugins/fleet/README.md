# fleet

A side pane with this session's subagents, background shells and the repo's worktrees.

```
FLEET · deployer

AGENTS  2 running · 1 done · 0 failed
▶ rust-reviewer      6m12s
   review plan · Bash cargo clippy
✓ Explore            2m03s
   map snapshot callers

BACKGROUND
▶ cargo test --workspace     2m03s

WORKTREES
  main               clean
  p31-snap           ●3 changed ↑2
```

Read-only. Elapsed times tick live.

## Installation

```bash
claude plugin install fleet@vampik-plugins
```

## Behaviour

- Opens by itself when 2 or more agents run at once (an unasked pane needs a 144-column terminal).
- `/fleet` toggles the pane any time. Once an agent or shell has run (or while the pane is open), a line above the prompt shows `fleet 2▶ 1✓ 0✗ · bg 1  show`: click `show`/`hide`, or focus the band (ctrl+x tab) and press `f`.
- A toast for each finish or failure; when a batch of 2+ is all done, one more toast.
- A chime (`paplay`, freedesktop sounds) on a failure and on all done.
- A Telegram summary on all done when you have not typed for `idleMinutes`, through telegram-notifier's bot (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`).

Named agents (agent teams) go idle between turns: they show as done without a toast.

## How It Works

`agent.spawn` and `tool.call` record agents and their last tool; `$.agent.list()` is polled every 2 s while any runs; a turn's end and task notifications report finishes at once; worktrees come from `git worktree list` every 15 s while the pane is shown.

## Configuration

| Option | Default | |
|---|---|---|
| `autoOpen` | `true` | open the pane at 2+ running agents |
| `sound` | `true` | chime on failure and all done |
| `telegram` | `true` | Telegram summary when away |
| `idleMinutes` | `5` | away after this long since your last prompt |

Needs function hooks (`CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`).
