---
description: Send a Telegram message
allowed-tools: ["Bash"]
argument-hint: "[message]"
---

# Send Telegram Message

Send a notification message via Telegram Bot API.

## Instructions

The message is `$ARGUMENTS`, or "Task completed" when that is empty.

Escape the message for HTML and send it with the shared script, which reads it from stdin. Put the message text, exactly as given, between the two delimiter lines: the quoted heredoc keeps quotes, `$` and backticks in it as plain text, so nothing in the message runs as shell. A line equal to the delimiter would end the heredoc early and run the rest as shell, so replace `TELEGRAM_MESSAGE_7f3a9c` (in both places) with `TELEGRAM_MESSAGE_` and six random hex digits of your own, and check that no line of the message equals it; if one does, pick other digits.

```bash
source "${CLAUDE_PLUGIN_ROOT}/hooks/scripts/lib/html.sh"
RAW=$(cat <<'TELEGRAM_MESSAGE_7f3a9c'
<the message>
TELEGRAM_MESSAGE_7f3a9c
)
escape_html "$RAW" | bash "${CLAUDE_PLUGIN_ROOT}/hooks/scripts/send-telegram.sh"
```

Check the exit code and report any errors to the user.

## Examples

- `/telegram` - Sends "Task completed"
- `/telegram Build finished` - Sends "Build finished"
- `/telegram Tests passed, ready for review` - Sends custom message
