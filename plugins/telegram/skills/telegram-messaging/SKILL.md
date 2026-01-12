---
name: Telegram Messaging
description: Send Telegram messages via /telegram command or automatic session notifications. Helps with Bot API setup, credential configuration, and troubleshooting delivery issues.
---

# Telegram Messaging

Send messages to Telegram using the Bot API. The plugin provides both manual (`/telegram`) and automatic session notifications.

## Quick Start

```
/telegram Your message here
```

For setup instructions (credentials, configuration), see the [plugin README](../../README.md).

## Plugin Behavior

**Opt-in design:** The plugin only validates credentials and sends automatic notifications when `.claude/telegram.local.md` exists with `enabled: true`.

**Manual command:** The `/telegram` command works anytime if credentials are set, regardless of the config file.

## Resources

- **Full documentation:** [README.md](../../README.md)
- **Troubleshooting:** [references/troubleshooting.md](references/troubleshooting.md)
