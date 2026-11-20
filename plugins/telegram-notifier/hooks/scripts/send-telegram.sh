#!/bin/bash
set -euo pipefail

# Shared Telegram message sender
# Usage: send-telegram.sh "message"
# Returns: 0 on success, 1 on failure
# Output: JSON response on success, error message on failure
# Debug: Set TELEGRAM_NOTIFIER_DEBUG=1 to print the payload and the response
# (never `set -x`: the trace would print the bot token wherever it is expanded)

# Turn off tracing inherited from `bash -x` or an exported SHELLOPTS=xtrace, for the same reason
{ set +x; } 2>/dev/null

MESSAGE="${1:-}"

if [[ -z "$MESSAGE" ]]; then
  echo "Error: No message provided" >&2
  exit 1
fi

if [[ -z "${TELEGRAM_BOT_TOKEN:-}" ]] || [[ -z "${TELEGRAM_CHAT_ID:-}" ]]; then
  echo "Error: Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID" >&2
  exit 1
fi

# Use jq for proper JSON escaping (handles quotes, backslashes, newlines, control chars)
if ! command -v jq &> /dev/null; then
  echo "Error: jq is required for safe JSON encoding" >&2
  exit 1
fi

JSON_PAYLOAD=$(jq -n \
  --arg chat_id "$TELEGRAM_CHAT_ID" \
  --arg text "$MESSAGE" \
  '{chat_id: $chat_id, text: $text, parse_mode: "HTML"}')

if [[ "${TELEGRAM_NOTIFIER_DEBUG:-}" == "1" ]]; then
  echo "Payload: $JSON_PAYLOAD" >&2
fi

# Send with timeout and capture response; 8 s keeps it inside the Stop hook's 10 s
RESPONSE=$(curl -s --connect-timeout 5 -m 8 -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
  -H "Content-Type: application/json" \
  -d "$JSON_PAYLOAD" 2>&1) || {
  echo "Error: curl failed" >&2
  exit 1
}

if [[ "${TELEGRAM_NOTIFIER_DEBUG:-}" == "1" ]]; then
  echo "Response: $RESPONSE" >&2
fi

# Validate API response
if echo "$RESPONSE" | jq -e '.ok == true' > /dev/null 2>&1; then
  echo "$RESPONSE"
  exit 0
else
  ERROR_DESC=$(echo "$RESPONSE" | jq -r '.description // "Unknown error"' 2>/dev/null || echo "Invalid response")
  echo "Error: Telegram API failed - $ERROR_DESC" >&2
  exit 1
fi
