#!/bin/bash
# Turn off tracing inherited from `bash -x` or an exported SHELLOPTS=xtrace before
# any line runs: the trace would print the prompt (in the hook input) and the bot token
{ set +x; } 2>/dev/null
set -euo pipefail

# Update last activity timestamp on each user prompt
# Called by UserPromptSubmit hook

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Read hook input before sourcing (stdin must be captured first)
HOOK_INPUT=$(cat)
# shellcheck source=lib/config.sh
source "$SCRIPT_DIR/lib/config.sh"
# shellcheck source=lib/session.sh
source "$SCRIPT_DIR/lib/session.sh"
extract_session_id "$HOOK_INPUT"

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
date +%s > "$SESSION_FILE" 2>/dev/null || true

exit 0
