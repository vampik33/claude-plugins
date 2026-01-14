#!/bin/bash
set -euo pipefail

# Check if Telegram credentials are set (opt-in based on config file)
# Runs on SessionStart to validate environment
# Only blocks if telegram.local.md exists with enabled: true

# Debug mode support
if [[ "${TELEGRAM_DEBUG:-}" == "1" ]]; then
  set -x
  exec 2>&1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/yaml-helpers.sh"

# Clean up stale session file from previous force-quit sessions
SESSION_FILE=$(get_session_file_path)
rm -f "$SESSION_FILE" 2>/dev/null || true

# Check if plugin is enabled (opt-in behavior with dual-scope support)
# User config: ~/.claude/telegram.local.md (global defaults)
# Project config: .claude/telegram.local.md (project overrides)
ENABLED_STATUS=$(is_plugin_enabled)

if [[ "$ENABLED_STATUS" == "unconfigured" ]]; then
  # No config at either level
  echo '{"systemMessage": "Telegram plugin: No config found. Create ~/.claude/telegram.local.md (global) or .claude/telegram.local.md (project) with enabled: true to enable notifications."}'
  exit 0
fi

if [[ "$ENABLED_STATUS" != "true" ]]; then
  # Explicitly disabled
  exit 0
fi

# Plugin is enabled - validate dependencies and credentials

# Check for required dependencies first
MISSING_DEPS=()
command -v jq &> /dev/null || MISSING_DEPS+=("jq")
command -v curl &> /dev/null || MISSING_DEPS+=("curl")

if [[ ${#MISSING_DEPS[@]} -gt 0 ]]; then
  DEPS_LIST=$(IFS=", "; echo "${MISSING_DEPS[*]}")
  cat >&2 <<EOF
{
  "error": "Missing dependencies: $DEPS_LIST",
  "systemMessage": "Telegram plugin: Missing required dependencies ($DEPS_LIST). Install them to use Telegram notifications:\n\n- jq: https://jqlang.github.io/jq/download/\n- curl: Usually pre-installed on most systems"
}
EOF
  exit 2
fi

# Check for credentials
MISSING_CREDS=()
[[ -z "${TELEGRAM_BOT_TOKEN:-}" ]] && MISSING_CREDS+=("TELEGRAM_BOT_TOKEN")
[[ -z "${TELEGRAM_CHAT_ID:-}" ]] && MISSING_CREDS+=("TELEGRAM_CHAT_ID")

if [[ ${#MISSING_CREDS[@]} -gt 0 ]]; then
  CREDS_LIST=$(IFS=", "; echo "${MISSING_CREDS[*]}")
  cat >&2 <<EOF
{
  "error": "Missing Telegram credentials: $CREDS_LIST",
  "systemMessage": "Telegram plugin: Missing required environment variables ($CREDS_LIST). See README.md for setup instructions."
}
EOF
  exit 2
fi

# Success message
echo '{"systemMessage": "Telegram plugin: Ready. Use /telegram to send messages."}'
exit 0
