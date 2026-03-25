# Telegram Notifier Plugin Configuration

Extracted from the [plugin README](../../../README.md) (at `plugins/telegram-notifier/README.md`).

## Credentials

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

**Persistence:** Add to your shell profile (`~/.bashrc`, `~/.zshrc`).

**Per-project credentials:** Use [direnv](https://direnv.net/) with a `.envrc` file in the project root.

## Dependencies

- `jq` - Required for safe JSON encoding ([installation](https://jqlang.github.io/jq/download/))
- `curl` - For API requests (usually pre-installed)

## Configuration File

The plugin supports two configuration scopes:

| Scope | Location | Purpose |
|-------|----------|---------|
| User (global) | `~/.claude/telegram-notifier.local.md` | Default settings for all projects |
| Project | `.claude/telegram-notifier.local.md` | Project-specific overrides |

### Merge Behavior

- **Field resolution**: project value > user value > default
- Missing fields in project config **fall back to user config**
- `enabled: false` at either level **disables** the plugin
- Notification body uses **project body if present**, otherwise user body

### Settings

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | boolean | true | Enable plugin (credential validation + auto notifications) |
| `session_threshold_minutes` | number | 10 | Minimum idle time (since last interaction) to trigger notification |

The markdown body (after `---`) is used as the notification message. Idle time is automatically appended (e.g., "Build completed, ready for review (15m)").

**Note:** If a config file exists but has no frontmatter (or empty frontmatter), the plugin treats it as `enabled: true` with default threshold. To explicitly disable, set `enabled: false`.

**Without any config file**, the plugin shows a warning but does not block. It will not validate credentials or send automatic notifications until configured.

### Gitignore

Add to your project's `.gitignore`:

```
.claude/*.local.md
```

## Debug Mode

Enable verbose output for troubleshooting:

```bash
export TELEGRAM_NOTIFIER_DEBUG=1
```

This shows API requests and responses.
