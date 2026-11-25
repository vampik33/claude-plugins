# telegram-notifier

Send Telegram notifications from Claude Code sessions - manually via command or automatically after periods of inactivity.

## Features

- `/telegram` command for manual message sending
- Automatic notifications when idle time exceeds threshold
- Opt-in credential validation (only when enabled)
- Dual-scope configuration (user-level + project-level, like CLAUDE.md)
- Debug mode for troubleshooting

## Quick Start

1. Install dependencies: `jq` and `curl`
2. Set up credentials (see below)
3. Create config file to enable the plugin:
   - Global: `~/.claude/telegram-notifier.local.md`
   - Per-project: `.claude/telegram-notifier.local.md`
4. Use `/telegram` or wait for automatic notifications

## Requirements

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

```bash
claude plugin install telegram-notifier@vampik-plugins
```

## Usage

### Manual Notifications

```
/telegram Your message here
```

If no message provided, defaults to "Task completed".

### Automatic Notifications

The plugin sends notifications when:
1. `.claude/telegram-notifier.local.md` exists with `enabled: true`
2. Idle time (since last interaction) exceeds the configured threshold
3. Credentials are properly set

They come from classic hooks (SessionStart, UserPromptSubmit, Stop). Where an organization manages Claude Code and allows only managed hooks (`allowManagedHooksOnly`), these don't run; `/telegram` still works. The Stop notification sends the cwd, the session id and a summary of counts and names (base names of edited and created files, cut to 64 characters; the program name from the first line of each command run, without inline `NAME=value` assignments and at most 32 characters; file counts above 5 shown as 6+) to `api.telegram.org`; never Claude's answer text, command lines or file contents.

## Configuration

The plugin supports two configuration scopes, similar to CLAUDE.md:

| Scope | Location | Purpose |
|-------|----------|---------|
| User (global) | `~/.claude/telegram-notifier.local.md` | Default settings for all projects |
| Project | `.claude/telegram-notifier.local.md` | Project-specific overrides |

### Merge Behavior

- **Field resolution**: project value > user value > default
- Missing fields in project config **fall back to user config**
- `enabled: false` at either level **disables** the plugin
- Notification body uses **project body if present**, otherwise user body

### Example Setup

**User config** (`~/.claude/telegram-notifier.local.md`) - global defaults:

```markdown
---
enabled: true
session_threshold_minutes: 15
---

Claude Code task completed
```

**Project override** (`.claude/telegram-notifier.local.md`):

```markdown
---
session_threshold_minutes: 5
---

Build finished in my-project
```

**Result**: enabled=true (from user), threshold=5 min (from project), message="Build finished in my-project" (from project)

### Settings

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | boolean | true | Enable plugin (credential validation + auto notifications) |
| `session_threshold_minutes` | number | 10 | Minimum idle time (since last interaction) to trigger notification |

The markdown body (after `---`) is used as the notification message. Idle time is automatically appended (e.g., "Build completed, ready for review (15m)").

**Note:** If a config file exists but has no frontmatter (or empty frontmatter), the plugin treats it as `enabled: true` with default threshold. To explicitly disable, you must set `enabled: false`.

**Important:** Without any config file (user or project level), the plugin shows a warning but does not block. It will not validate credentials or send automatic notifications until configured.

### Gitignore

Add to your project's `.gitignore` (user-level config in `~/.claude/` is not in git):

```
.claude/*.local.md
```

## Debug Mode

For troubleshooting, enable debug mode:

```bash
export TELEGRAM_NOTIFIER_DEBUG=1
```

This shows verbose output including the request payload and the API response. The bot token is never printed: the scripts keep shell tracing off wherever it is expanded.

## Troubleshooting

See [troubleshooting guide](skills/telegram-messaging/references/troubleshooting.md) for common issues.

**Quick checks:**
- Credentials set? `[ -n "$TELEGRAM_BOT_TOKEN" ] && [ -n "$TELEGRAM_CHAT_ID" ] && echo set || echo missing` (prints neither value)
- Config exists? `cat ~/.claude/telegram-notifier.local.md` or `cat .claude/telegram-notifier.local.md`
- Test manually: `/telegram Test message`

## License

Apache-2.0. See [LICENSE](LICENSE).
