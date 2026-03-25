---
name: Telegram Messaging
description: This skill should be used when the user asks about sending Telegram messages, setting up Telegram notifications, configuring Telegram bot tokens or chat IDs, enabling automatic session notifications, troubleshooting "chat not found" or "unauthorized" errors, fixing notifications not sending, or using the /telegram command. Covers credential setup, telegram-notifier.local.md configuration, idle threshold tuning, and debug mode.
---

# Telegram Messaging

Send messages to Telegram using the Bot API. The plugin provides both manual (`/telegram`) and automatic session notifications.

## Quick Start

```
/telegram Your message here
```

## Credentials

Set two environment variables (add to `~/.bashrc` or `~/.zshrc` for persistence):

```bash
export TELEGRAM_BOT_TOKEN="your-bot-token"   # from @BotFather
export TELEGRAM_CHAT_ID="your-chat-id"       # from @userinfobot
```

## Configuration

Create `.claude/telegram-notifier.local.md` (project) or `~/.claude/telegram-notifier.local.md` (global):

```markdown
---
enabled: true
session_threshold_minutes: 10
---

Your custom notification message here
```

See `examples/telegram-notifier.local.md.example` for a working config template.

## Plugin Behavior

**Opt-in design:** The plugin only validates credentials and sends automatic notifications when `.claude/telegram-notifier.local.md` exists with `enabled: true`.

**Manual command:** The `/telegram` command works anytime if credentials are set, regardless of the config file.

## Resources

- **Full documentation:** [README.md](../../README.md) (at `plugins/telegram-notifier/README.md`)
- **Configuration details:** [references/configuration.md](references/configuration.md)
- **Troubleshooting:** [references/troubleshooting.md](references/troubleshooting.md)
