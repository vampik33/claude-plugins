# Plan: Send Telegram messages in HTML format

## Context

Telegram plugin currently sends all messages as plain text (no `parse_mode`). Messages lack visual structure — header, summary, and metadata all look the same. Switching to Telegram's HTML parse mode allows bold headers, italic metadata, and cleaner visual hierarchy.

## Changes

### 1. Create `hooks/scripts/lib/html.sh` — shared HTML escape utility

```bash
escape_html() {
  local text="${1:-}"
  text="${text//&/&amp;}"  # & first to avoid double-escaping
  text="${text//</&lt;}"
  text="${text//>/&gt;}"
  echo "$text"
}
```

Consistent with existing `lib/config.sh`, `lib/session.sh`, `lib/yaml.sh` pattern.

### 2. Modify `hooks/scripts/send-telegram.sh` — add `parse_mode: "HTML"`

One-line change to the jq payload (line 33-36):

```diff
-  '{chat_id: $chat_id, text: $text}')
+  '{chat_id: $chat_id, text: $text, parse_mode: "HTML"}')
```

### 3. Modify `hooks/scripts/session-notification.sh` — format with HTML tags

- Source `lib/html.sh`
- Escape all dynamic content before interpolating
- **Header**: `<b>Claude Code session completed in PROJECT (12m)</b>`
- **Summary**: escaped plain text (no HTML tags — just safe for HTML mode)
- **Metadata**: `<i>Dir: /path</i>` and `<i>Session: abc-123</i>`

### 4. Modify `hooks/scripts/summarize-transcript.sh` — escape output for HTML safety

- Source `lib/html.sh`
- Tier 1 (last assistant message): escape the entire output
- Tier 2 (tool extraction): escape file names and commands in the output

This way `session-notification.sh` does NOT double-escape the summary — it uses it as-is.

### 5. Modify `commands/telegram.md` — escape user input

Source `lib/html.sh` and escape `$ARGUMENTS` before passing to `send-telegram.sh`.

## Files to modify

| File | Action |
|------|--------|
| `hooks/scripts/lib/html.sh` | **Create** |
| `hooks/scripts/send-telegram.sh` | Add `parse_mode: "HTML"` |
| `hooks/scripts/session-notification.sh` | Source html.sh, wrap header in `<b>`, metadata in `<i>`, escape dynamic values |
| `hooks/scripts/summarize-transcript.sh` | Source html.sh, escape all output |
| `commands/telegram.md` | Source html.sh, escape user input |

## Verification

1. Set `TELEGRAM_DEBUG=1` and trigger a `/telegram test <message> & more` — verify payload has `parse_mode: "HTML"` and `<`, `&` are escaped
2. Run a session long enough to trigger the Stop hook notification — verify bold header and italic metadata render correctly in Telegram
3. Edge case: message with `<script>alert(1)</script>` should be escaped to `&lt;script&gt;...`
