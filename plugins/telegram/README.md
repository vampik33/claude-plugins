# Telegram Plugin for Claude Code

Send Telegram notifications from Claude Code sessions - manually via command or automatically when sessions exceed a configured duration.

## Features

- `/telegram` command for manual message sending
- Automatic notifications when sessions exceed time threshold
- Opt-in credential validation (only when enabled)
- Configurable per-project settings
- Debug mode for troubleshooting

## Quick Start

1. Install dependencies: `jq` and `curl`
2. Set up credentials (see below)
3. Create `.claude/telegram.local.md` to enable the plugin
4. Use `/telegram` or wait for automatic notifications

## Prerequisites

### Dependencies

- `jq` - Required for safe JSON encoding ([installation](https://jqlang.github.io/jq/download/))
- `curl` - For API requests (usually pre-installed)

### Credentials Setup

Set these environment variables:

```bash
export TELEGRAM_BOT_TOKEN="your-bot-token"
export TELEGRAM_CHAT_ID="your-chat-id"
```

**How to get credentials:**

1. **Bot Token**: Message [@BotFather](https://t.me/botfather) on Telegram
   - Send `/newbot` or `/mybots`
   - Copy the API token provided

2. **Chat ID**: Message [@userinfobot](https://t.me/userinfobot) on Telegram
   - It will reply with your chat ID
   - For groups: add the bot first, then check ID

**Persistence:** Add to your shell profile (`~/.bashrc`, `~/.zshrc`):

```bash
export TELEGRAM_BOT_TOKEN="your-bot-token"
export TELEGRAM_CHAT_ID="your-chat-id"
```

**Per-project credentials:** Use [direnv](https://direnv.net/):

```bash
# .envrc
export TELEGRAM_BOT_TOKEN="project-token"
export TELEGRAM_CHAT_ID="project-chat"
```

## Installation

Add to your Claude Code plugins or use `--plugin-dir`:

```bash
claude --plugin-dir /path/to/telegram
```

## Usage

### Manual Notifications

```
/telegram Your message here
```

If no message provided, defaults to "Task completed".

### Automatic Notifications

The plugin sends notifications when:
1. `.claude/telegram.local.md` exists with `enabled: true`
2. Session duration exceeds the configured threshold
3. Credentials are properly set

## Configuration

Create `.claude/telegram.local.md` in your project to enable the plugin:

```markdown
---
enabled: true
session_threshold_minutes: 10
---

Build completed, ready for review
```

### Settings

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | boolean | true | Enable plugin (credential validation + auto notifications) |
| `session_threshold_minutes` | number | 10 | Minimum session duration to trigger notification |

The markdown body (after `---`) is used as the notification message. Session duration is automatically appended (e.g., "Build completed, ready for review (15m)").

**Important:** Without `.claude/telegram.local.md`, the plugin does not validate credentials or send automatic notifications.

### Gitignore

Add to your `.gitignore`:

```
.claude/*.local.md
```

## Debug Mode

For troubleshooting, enable debug mode:

```bash
export TELEGRAM_DEBUG=1
```

This shows verbose output including API requests and responses.

## Troubleshooting

See [troubleshooting guide](skills/telegram-messaging/references/troubleshooting.md) for common issues.

**Quick checks:**
- Credentials set? `echo $TELEGRAM_BOT_TOKEN`
- Config exists? `cat .claude/telegram.local.md`
- Test manually: `/telegram Test message`

## License

Apache-2.0
