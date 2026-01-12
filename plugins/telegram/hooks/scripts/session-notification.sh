#!/bin/bash
set -euo pipefail

# Send Telegram notification when session ends (if configured)
# Checks session duration against threshold from settings

# Debug mode support
if [[ "${TELEGRAM_DEBUG:-}" == "1" ]]; then
  set -x
  exec 2>&1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/yaml-helpers.sh"

STATE_FILE="${CLAUDE_PROJECT_DIR:-.}/.claude/telegram.local.md"

# Quick exit if settings file doesn't exist
if [[ ! -f "$STATE_FILE" ]]; then
  exit 0
fi

FRONTMATTER=$(extract_frontmatter "$STATE_FILE")

# Check if enabled (default: true if file exists)
ENABLED=$(parse_yaml_field "enabled" "true" "$FRONTMATTER")
if [[ "$ENABLED" != "true" ]]; then
  exit 0
fi

# Get threshold (default 10 minutes)
THRESHOLD=$(parse_yaml_field "session_threshold_minutes" "10" "$FRONTMATTER")
# Validate threshold is numeric
if ! [[ "$THRESHOLD" =~ ^[0-9]+$ ]]; then
  THRESHOLD=10
fi

# Check session duration
SESSION_START="${TELEGRAM_SESSION_START:-0}"
if [[ "$SESSION_START" == "0" ]]; then
  # No start time recorded, skip
  exit 0
fi

CURRENT_TIME=$(date +%s)
ELAPSED_SECONDS=$((CURRENT_TIME - SESSION_START))
ELAPSED_MINUTES=$((ELAPSED_SECONDS / 60))

# Check if threshold exceeded
if [[ $ELAPSED_MINUTES -lt $THRESHOLD ]]; then
  exit 0
fi

# Get custom message from markdown body (after second ---)
CUSTOM_MESSAGE=$(extract_body "$STATE_FILE" | head -c 500)

# Build notification message
if [[ -n "$CUSTOM_MESSAGE" ]]; then
  MESSAGE="$CUSTOM_MESSAGE (${ELAPSED_MINUTES}m)"
else
  PROJECT_NAME=$(basename "${CLAUDE_PROJECT_DIR:-$(pwd)}")
  MESSAGE="Claude Code session completed in $PROJECT_NAME (${ELAPSED_MINUTES}m)"
fi

# Send notification using shared script (handles JSON escaping and response validation)
if [[ "${TELEGRAM_DEBUG:-}" == "1" ]]; then
  echo "Sending notification: $MESSAGE" >&2
  bash "$SCRIPT_DIR/send-telegram.sh" "$MESSAGE" || {
    echo "Warning: Failed to send session notification" >&2
  }
else
  bash "$SCRIPT_DIR/send-telegram.sh" "$MESSAGE" > /dev/null 2>&1 || {
    echo "Warning: Failed to send session notification" >&2
  }
fi

exit 0
