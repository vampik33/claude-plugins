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

STATE_FILE="${CLAUDE_PROJECT_DIR:-.}/.claude/telegram.local.md"

# Check if plugin is enabled (opt-in behavior)
PLUGIN_ENABLED=false
if [[ -f "$STATE_FILE" ]]; then
  FRONTMATTER=$(extract_frontmatter "$STATE_FILE")
  ENABLED_VALUE=$(parse_yaml_field "enabled" "true" "$FRONTMATTER")
  if [[ "$ENABLED_VALUE" == "true" ]]; then
    PLUGIN_ENABLED=true
  fi
fi

# If plugin not enabled, just exit silently (no blocking)
if [[ "$PLUGIN_ENABLED" != "true" ]]; then
  exit 0
fi

# Plugin is enabled - validate dependencies and credentials

# Check for required dependencies first
MISSING_DEPS=""
if ! command -v jq &> /dev/null; then
  MISSING_DEPS="jq"
fi
if ! command -v curl &> /dev/null; then
  if [[ -n "$MISSING_DEPS" ]]; then
    MISSING_DEPS="$MISSING_DEPS, curl"
  else
    MISSING_DEPS="curl"
  fi
fi

if [[ -n "$MISSING_DEPS" ]]; then
  cat >&2 <<EOF
{
  "error": "Missing dependencies: $MISSING_DEPS",
  "systemMessage": "Telegram plugin: Missing required dependencies ($MISSING_DEPS). Install them to use Telegram notifications:\n\n- jq: https://jqlang.github.io/jq/download/\n- curl: Usually pre-installed on most systems"
}
EOF
  exit 2
fi

# Check for credentials
MISSING=""
if [[ -z "${TELEGRAM_BOT_TOKEN:-}" ]]; then
  MISSING="TELEGRAM_BOT_TOKEN"
fi

if [[ -z "${TELEGRAM_CHAT_ID:-}" ]]; then
  if [[ -n "$MISSING" ]]; then
    MISSING="$MISSING, TELEGRAM_CHAT_ID"
  else
    MISSING="TELEGRAM_CHAT_ID"
  fi
fi

if [[ -n "$MISSING" ]]; then
  cat >&2 <<EOF
{
  "error": "Missing Telegram credentials: $MISSING",
  "systemMessage": "Telegram plugin: Missing required environment variables ($MISSING). See README.md for setup instructions."
}
EOF
  exit 2
fi

# Credentials present - record session start time (avoid duplicates)
if [[ -n "${CLAUDE_ENV_FILE:-}" && -w "${CLAUDE_ENV_FILE:-/dev/null}" ]]; then
  if ! grep -q "TELEGRAM_SESSION_START" "$CLAUDE_ENV_FILE" 2>/dev/null; then
    echo "export TELEGRAM_SESSION_START=$(date +%s)" >> "$CLAUDE_ENV_FILE"
  fi
fi

# Success message
echo '{"systemMessage": "Telegram plugin: Ready. Use /telegram to send messages."}'
exit 0
