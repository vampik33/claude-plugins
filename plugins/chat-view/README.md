# chat-view

Makes the terminal transcript read like a chat: your prompts sit in bubbles on the right with the time you sent each one, and each reply carries the time it started streaming.

```
                         ╭──────────────────────────────────────────╮
                         │ Check where the daily-work-report task   │
                         │ stores its working folder                │
                         ╰──────────────────────────────────────────╯
                                                             18:15:12
⏺ 18:15:14 · The working folder is already /home/vampik/work-reports…
✻ Cogitated for 24s · 18:15:12 → 18:15:35
```

In the Claude desktop app, which draws its own bubbles, the times go in front of the prompt and the reply instead.

Only the drawing changes: the model never sees the times, so the prompt cache is untouched.

Formerly `prompt-clock`.

## Installation

```bash
claude plugin install chat-view@vampik-plugins
```

Coming from `prompt-clock`: `claude plugin uninstall prompt-clock@vampik-plugins` first.

## How It Works

- `session.append` stamps each prompt you typed by its row id: at the terminal, in the desktop app (an SDK host, whose prompts arrive as `sdk` or unstamped) and through Remote Control. Notifications and other agents', teammates' or sessions' messages are left alone.
- `ui.render` on `UserMessage` draws the bubble on the terminal (at most 70% of the row, all of it below 60 columns) with the send time under it; on other surfaces, and with `bubbles` off, the time goes in front of the text.
- `turn.step` notes when each text block of the main loop streams its first non-blank token; the reply's row, when `session.append` writes it, takes that time. `ui.render` on `AssistantMessage` puts it in front of the block that opens a reply, on a line of its own before a heading, list, quote, table or code.
- `turn.complete` records each turn's end; `ui.render` on `TurnDuration` draws the line with start → end (terminal only: other surfaces draw their own footer).
- A resumed session reads earlier prompts' and replies' times from its transcript file. The file keeps when a reply's row was written, not its first token, so an earlier reply shows that time.
  That read runs in the classic `SessionStart` hook, which does not run where an organization manages Claude Code (there only plugins the organization lists run classic hooks): there, earlier rows of a resumed session show no time.
- Times from another day get the date: `Oct 4 23:10:05`.

## Configuration

| Option | Default | |
|---|---|---|
| `bubbles` | `true` | your prompts in a bubble on the right of the terminal |
| `seconds` | `true` | `16:42:07` instead of `16:42` |
| `turnRange` | `true` | start → end on the turn's line |

Needs function hooks (`CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`).
