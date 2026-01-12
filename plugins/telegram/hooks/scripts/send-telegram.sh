#!/bin/bash
set -euo pipefail

# Shared Telegram message sender
# Usage: send-telegram.sh "message"
# Returns: 0 on success, 1 on failure
# Output: JSON response on success, error message on failure
# Debug: Set TELEGRAM_DEBUG=1 for verbose output

# Debug mode support
if [[ "${TELEGRAM_DEBUG:-}" == "1" ]]; then
  set -x
fi

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
  '{chat_id: $chat_id, text: $text}')

if [[ "${TELEGRAM_DEBUG:-}" == "1" ]]; then
  echo "Payload: $JSON_PAYLOAD" >&2
fi

# Send with timeout and capture response
# Disable tracing to prevent token leak in debug mode
{ set +x; } 2>/dev/null
RESPONSE=$(curl -s -m 10 -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
  -H "Content-Type: application/json" \
  -d "$JSON_PAYLOAD" 2>&1) || {
  echo "Error: curl failed" >&2
  exit 1
}
# Re-enable tracing if debug mode is on
if [[ "${TELEGRAM_DEBUG:-}" == "1" ]]; then set -x; fi

if [[ "${TELEGRAM_DEBUG:-}" == "1" ]]; then
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
