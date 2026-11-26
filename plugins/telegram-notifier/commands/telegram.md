---
description: Send a Telegram message
allowed-tools: ["Bash", "Write"]
argument-hint: "[message]"
---

# Send Telegram Message

Send a notification message via Telegram Bot API.

## Instructions

The message is `$ARGUMENTS`, or "Task completed" when that is empty. It never goes into a shell command: it goes into a file, which the shared script reads.

1. Make a private directory for it (mode 0700); the command prints its path:

   ```bash
   mktemp -d "${TMPDIR:-/tmp}/telegram-message.XXXXXX"
   ```

2. With the Write tool, write the message text, exactly as given, to `message.txt` in that directory.

3. Escape the message for HTML, send it with the shared script (it reads the message on stdin) and remove the directory, putting the printed path in place of `<the directory>`, inside the single quotes:

   ```bash
   TELEGRAM_DIR='<the directory>'
   source "${CLAUDE_PLUGIN_ROOT}/hooks/scripts/lib/html.sh"
   escape_html "$(cat "$TELEGRAM_DIR/message.txt")" | bash "${CLAUDE_PLUGIN_ROOT}/hooks/scripts/send-telegram.sh"
   TELEGRAM_STATUS=$?
   rm -rf "$TELEGRAM_DIR"
   (exit "$TELEGRAM_STATUS")
   ```

Check the exit code and report any errors to the user.

## Examples

- `/telegram` - Sends "Task completed"
- `/telegram Build finished` - Sends "Build finished"
- `/telegram Tests passed, ready for review` - Sends custom message
