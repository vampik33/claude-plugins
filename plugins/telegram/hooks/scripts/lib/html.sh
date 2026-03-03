#!/bin/bash
# HTML escaping for Telegram's HTML parse mode
# Escapes &, <, > so dynamic content is safe inside HTML messages

# Escape text for safe use in Telegram HTML messages
# Must escape & first to avoid double-escaping
escape_html() {
  local text="${1:-}"
  text="${text//&/&amp;}"
  text="${text//</&lt;}"
  text="${text//>/&gt;}"
  echo "$text"
}
