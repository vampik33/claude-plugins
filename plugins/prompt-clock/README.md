# prompt-clock

Shows when you sent each request.

```
❯ 18:15:12 · run the tests and fix what fails
✻ Cogitated for 24s · 18:15:12 → 18:15:35
```

Only the drawing changes: the model never sees the times, so the prompt cache is untouched.

## Installation

```bash
claude plugin install prompt-clock@vampik-plugins
```

## How It Works

- `session.append` stamps each typed prompt by its row id; `ui.render` on `UserMessage` puts the time in front.
- `turn.complete` records each turn's end; `ui.render` on `TurnDuration` draws the line with start → end.
- A resumed session reads earlier prompts' times from its transcript file.
- Times from another day get the date: `Oct 4 23:10:05`.

## Configuration

| Option | Default | |
|---|---|---|
| `seconds` | `true` | `16:42:07` instead of `16:42` |
| `turnRange` | `true` | start → end on the turn's line |

Needs function hooks (`CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`).
