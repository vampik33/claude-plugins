#!/bin/bash
set -euo pipefail

# Update last activity timestamp on each user prompt
# Called by UserPromptSubmit hook

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/yaml-helpers.sh"

# Check if plugin is enabled
ENABLED_STATUS=$(is_plugin_enabled)
if [[ "$ENABLED_STATUS" != "true" ]]; then
  exit 0
fi

# Check credentials are present (skip silently if not)
[[ -z "${TELEGRAM_BOT_TOKEN:-}" ]] && exit 0
[[ -z "${TELEGRAM_CHAT_ID:-}" ]] && exit 0

# Update activity timestamp
SESSION_FILE=$(get_session_file_path)
SESSION_DIR="$(dirname "$SESSION_FILE")"

mkdir -p "$SESSION_DIR" 2>/dev/null || true
echo "$(date +%s)" > "$SESSION_FILE" 2>/dev/null || true

exit 0
