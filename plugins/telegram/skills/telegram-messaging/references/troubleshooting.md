# Telegram Plugin Troubleshooting

Common issues and solutions. For setup instructions, see [README.md](../../../README.md).

## Credential Issues

| Error | Cause | Fix |
|-------|-------|-----|
| "Missing credentials" | Env vars not set | Set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` |
| "Unauthorized" | Invalid/expired token | Regenerate via @BotFather → `/mybots` → API Token |
| "chat not found" | Wrong chat ID or bot not started | Verify with @userinfobot; send `/start` to bot first |

## Notification Issues

### Automatic notifications not sending

**Checklist:**
1. `.claude/telegram.local.md` exists?
2. Contains `enabled: true` in frontmatter?
3. Session exceeded `session_threshold_minutes`?
4. Credentials are set?

**Debug:**
```bash
export TELEGRAM_DEBUG=1
# Then run your session and check output
```

### Session threshold not working

Threshold is in **minutes**, not seconds.

- `10` = notifications only after 10+ minute sessions
- `0` = notify for all sessions

### Custom message not appearing

Custom message must come after the frontmatter closing `---`:

```markdown
---
enabled: true
session_threshold_minutes: 10
---

Your custom message here
```

## Message Issues

### Special characters breaking messages

The plugin uses `jq` for safe JSON encoding. If issues persist:
- Keep messages under 4096 characters (Telegram limit)
- Avoid excessive special characters

### Rate limiting ("Too Many Requests")

Telegram allows ~30 messages/second. Normal usage won't trigger this.

If it occurs, check `retry_after` in response for wait time.

## Environment Issues

### Credentials not persisting

`export` only works for current shell session. See [README - Credentials Setup](../../../README.md#credentials-setup) for persistence options.

### Different credentials per project

Use [direnv](https://direnv.net/) with `.envrc` file in project root.

## Plugin Issues

### Commands not available

1. Is plugin in Claude Code's plugin path?
2. Is `plugin.json` valid JSON?
3. Restart Claude Code after adding plugins

### Hooks not running

1. Is `hooks/hooks.json` valid JSON?
2. Are scripts executable? (`chmod +x hooks/scripts/*.sh`)
3. Check for syntax errors: `bash -n hooks/scripts/*.sh`

### Debug mode

See [README - Debug Mode](../../../README.md#debug-mode) for verbose output options.
