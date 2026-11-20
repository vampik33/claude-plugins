---
description: Send a Telegram message
allowed-tools: ["Bash"]
argument-hint: "[message]"
---

# Send Telegram Message

Send a notification message via Telegram Bot API.

## Instructions

The message is `$ARGUMENTS`, or "Task completed" when that is empty.

Escape the message for HTML and send it with the shared script. Put the message text, exactly as given, on the line between the two `TELEGRAM_MESSAGE` markers: the quoted heredoc keeps quotes, `$` and backticks in it as plain text, so nothing in the message runs as shell.

```bash
source "${CLAUDE_PLUGIN_ROOT}/hooks/scripts/lib/html.sh"
RAW=$(cat <<'TELEGRAM_MESSAGE'
<the message>
TELEGRAM_MESSAGE
)
MESSAGE=$(escape_html "$RAW")
bash "${CLAUDE_PLUGIN_ROOT}/hooks/scripts/send-telegram.sh" "$MESSAGE"
```

Check the exit code and report any errors to the user.

## Examples

- `/telegram` - Sends "Task completed"
- `/telegram Build finished` - Sends "Build finished"
- `/telegram Tests passed, ready for review` - Sends custom message
