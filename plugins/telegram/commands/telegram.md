---
description: Send a Telegram message
allowed-tools: ["Bash"]
argument-hint: "[message]"
---

# Send Telegram Message

Send a notification message via Telegram Bot API.

## Instructions

If `$ARGUMENTS` is empty or not provided, set the message "Task completed".

Send the message using the shared script:

```bash
MESSAGE="${ARGUMENTS:-Task completed}"
bash "${CLAUDE_PLUGIN_ROOT}/hooks/scripts/send-telegram.sh" "$MESSAGE"
```

Check the exit code and report any errors to the user.

## Examples

- `/telegram` - Sends "Task completed"
- `/telegram Build finished` - Sends "Build finished"
- `/telegram Tests passed, ready for review` - Sends custom message
