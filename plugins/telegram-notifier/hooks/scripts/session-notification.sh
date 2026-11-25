#!/bin/bash
# Turn off tracing inherited from `bash -x` or an exported SHELLOPTS=xtrace
# before any line runs, and while the hook input is read (see "Debug mode support" below)
{ set +x; } 2>/dev/null
set -euo pipefail

# Send Telegram notification when session ends (if configured)
# Checks session duration against threshold from settings

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Read hook input before sourcing (stdin must be captured first)
HOOK_INPUT=$(cat)
# shellcheck source=lib/config.sh
source "$SCRIPT_DIR/lib/config.sh"
# shellcheck source=lib/session.sh
source "$SCRIPT_DIR/lib/session.sh"
# shellcheck source=lib/html.sh
source "$SCRIPT_DIR/lib/html.sh"

# Reading the event needs jq and sending needs curl. Without them, skip quietly
# when notifications are off; when on, say so in one line (exit 1: Claude Code
# shows it without blocking the stop, as exit 2 would). curl alone is checked
# below, once the session file is consumed
if ! command -v jq &> /dev/null; then
  [[ "$(is_plugin_enabled)" == "true" ]] || exit 0
  MISSING="jq"
  command -v curl &> /dev/null || MISSING="jq, curl"
  echo "Telegram Notifier: session notification skipped, missing $MISSING" >&2
  exit 1
fi

extract_session_id "$HOOK_INPUT"
extract_cwd "$HOOK_INPUT"
extract_transcript_path "$HOOK_INPUT"
# Clear rather than unset: a trace prefix (PS4) naming it would fail under set -u
HOOK_INPUT=""

# Debug mode support. Tracing starts only after the fields above are read: the
# Stop event holds Claude's last answer, and tracing the reads would print it
if [[ "${TELEGRAM_NOTIFIER_DEBUG:-}" == "1" ]]; then
  set -x
  exec 2>&1
fi

# Read session file early to ensure cleanup happens even if plugin is disabled
# This handles cases where user disables plugin mid-session
SESSION_FILE=$(get_session_file_path)
SESSION_START="0"

if [[ -f "$SESSION_FILE" ]]; then
  SESSION_START=$(cat "$SESSION_FILE" 2>/dev/null || echo "0")
  rm -f "$SESSION_FILE" 2>/dev/null || true
fi

# Check if plugin is enabled at any level (user or project config)
ENABLED_STATUS=$(is_plugin_enabled)

if [[ "$ENABLED_STATUS" != "true" ]]; then
  exit 0
fi

if ! command -v curl &> /dev/null; then
  echo "Telegram Notifier: session notification skipped, missing curl" >&2
  exit 1
fi

# Get threshold (project > user > default of 10 minutes)
THRESHOLD=$(resolve_config_field "session_threshold_minutes" "10")
# Validate threshold is numeric
if ! [[ "$THRESHOLD" =~ ^[0-9]+$ ]]; then
  THRESHOLD=10
fi

if [[ "$SESSION_START" == "0" || ! "$SESSION_START" =~ ^[0-9]+$ ]]; then
  # Invalid timestamp, skip
  exit 0
fi

CURRENT_TIME=$(date +%s)
ELAPSED_SECONDS=$((CURRENT_TIME - SESSION_START))
ELAPSED_MINUTES=$((ELAPSED_SECONDS / 60))

# Check if threshold exceeded
if [[ $ELAPSED_MINUTES -lt $THRESHOLD ]]; then
  exit 0
fi

# Get project name (used in message and custom body resolution)
PROJECT_NAME=$(basename "${CLAUDE_PROJECT_DIR:-$(pwd)}")

# Get custom message (project body > user body)
CUSTOM_MESSAGE=$(get_notification_body)

# Get transcript summary if available
TASK_SUMMARY=""
if [[ -n "${TRANSCRIPT_PATH:-}" && -f "${TRANSCRIPT_PATH}" ]]; then
  # At most 4 s where coreutils' timeout exists, so a huge transcript on a slow
  # machine leaves time to send; past it, the message goes without a summary
  SUMMARIZE=("$SCRIPT_DIR/summarize-transcript.sh" "$TRANSCRIPT_PATH")
  if command -v timeout &> /dev/null; then
    SUMMARIZE=(timeout 4 "${SUMMARIZE[@]}")
  fi
  # Only stdout goes into the message: in debug mode the summarizer's stderr
  # (its trace, under an exported SHELLOPTS=xtrace) goes to the hook output
  if [[ "${TELEGRAM_NOTIFIER_DEBUG:-}" == "1" ]]; then
    TASK_SUMMARY=$("${SUMMARIZE[@]}" || echo "")
  else
    TASK_SUMMARY=$("${SUMMARIZE[@]}" 2>/dev/null || echo "")
  fi
fi

# Build notification message parts
MESSAGE_PARTS=()
if [[ -n "$CUSTOM_MESSAGE" ]]; then
  MESSAGE_PARTS+=("<b>$(escape_html "$CUSTOM_MESSAGE") (${ELAPSED_MINUTES}m)</b>")
else
  MESSAGE_PARTS+=("<b>Claude Code session completed in $(escape_html "$PROJECT_NAME") (${ELAPSED_MINUTES}m)</b>")
fi

# Summary is already HTML-escaped by summarize-transcript.sh
if [[ -n "$TASK_SUMMARY" ]]; then
  MESSAGE_PARTS+=("$TASK_SUMMARY")
fi

# Add session metadata
if [[ -n "${CLAUDE_CWD:-}" ]]; then
  MESSAGE_PARTS+=("<i>Dir: $(escape_html "${CLAUDE_CWD}")</i>")
fi
if [[ -n "${CLAUDE_SESSION_ID:-}" ]]; then
  MESSAGE_PARTS+=("<i>Session: $(escape_html "${CLAUDE_SESSION_ID}")</i>")
fi

# Join parts with blank lines between sections
MESSAGE=$(printf '%s\n\n' "${MESSAGE_PARTS[@]}")
MESSAGE="${MESSAGE%$'\n\n'}"

# curl gets the time left until 8 s after this script started (SECONDS), so the
# hook ends inside its 10 s
SEND_TIME=$((8 - SECONDS))
((SEND_TIME >= 1)) || SEND_TIME=1

# Send notification using shared script (handles JSON escaping and response validation)
if [[ "${TELEGRAM_NOTIFIER_DEBUG:-}" == "1" ]]; then
  echo "Sending notification: $MESSAGE" >&2
  bash "$SCRIPT_DIR/send-telegram.sh" "$MESSAGE" "$SEND_TIME" || echo "Warning: Failed to send session notification" >&2
else
  bash "$SCRIPT_DIR/send-telegram.sh" "$MESSAGE" "$SEND_TIME" > /dev/null 2>&1 || echo "Warning: Failed to send session notification" >&2
fi

exit 0
