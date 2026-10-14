# fleet

A side pane with this session's subagents, background shells and the repo's worktrees.

```
FLEET · deployer

AGENTS  2 running · 1 done · 0 failed
▶ rust-reviewer      6m12s
   review plan · Bash cargo clippy
✓ Explore            2m03s · 10:42
   map snapshot callers

BACKGROUND
▶ uv run python sim.py       38m12s
   ▓▓▓▓░░░░░░ 40% ~52m · month 12/30
▶ ./retrain.sh d57           21m40s
   ⚠ no output 6m · fitting fold 3
▶ until grep -q DONE log; …  9m02s
   waiting
✓ cargo build                41s · 10:38

WORKTREES
  main               clean
  p31-snap           ●3 changed ↑2
```

Elapsed times tick live; a finished agent or shell also shows when it finished (with the date when not today).

Each running background shell shows its last line of output. When that line holds a count (`14/30`) or a percentage, a bar and an ETA at the rate seen so far (after 30 s of movement); after 5 minutes with no output, `⚠ no output 6m` and one toast. A wait loop (`until …; do …; done`, a `while` that sleeps) shows `waiting` and is never counted as stalled. Under the list, a `stop <shell>` button per running shell stops it through the TaskStop tool, as the model would.

## Installation

```bash
claude plugin install fleet@vampik-plugins
```

## Behaviour

- Opens by itself when 2 or more agents run at once (only in the fullscreen layout, where it docks beside the transcript, and from 144 columns).
- `/fleet` toggles the pane any time. Once an agent or shell has run (or while the pane is open), a line above the prompt shows `fleet 2▶ 1✓ 0✗ · bg 2 · sim.py 40% ~52m · retrain.sh d57 ⚠ 6m  show`: click `show`/`hide`, or focus the band (ctrl+x tab) and press `f`.
- A toast for each finish or failure; when a batch of 2+ is all done, one more toast.
- A chime (`paplay`, freedesktop sounds) on a failure and on all done.
- A Telegram summary on all done when you have not typed for `idleMinutes`, through telegram-notifier's bot (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`).

Named agents (agent teams) go idle between turns: they show as done without a toast.

Marking a shell lost relies on the classic `Stop` hook, which does not run where an organization manages Claude Code (only plugins the organization lists run classic hooks there): a shell that ends without a notification may stay shown as running.

## How It Works

`agent.spawn` and `tool.call` record agents and their last tool, and each background shell with the output file its result names; every 5 s while one runs, the file is checked and its last 4 KB read when it grew; `$.agent.list()` is polled every 2 s while any runs; a turn's end and task notifications report finishes at once; at each turn's end a background shell no longer in the engine's in-flight list is marked lost (`?`), its exit unknown; worktrees come from `git worktree list` every 15 s while the pane is shown.

## Configuration

| Option | Default | |
|---|---|---|
| `autoOpen` | `true` | open the pane at 2+ running agents |
| `sound` | `true` | chime on failure and all done |
| `telegram` | `true` | Telegram summary when away |
| `idleMinutes` | `5` | away after this long since your last prompt |

Needs function hooks (`CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`).
