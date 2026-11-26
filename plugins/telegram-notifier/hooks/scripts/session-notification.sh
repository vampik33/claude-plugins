#!/bin/bash
# Turn off tracing inherited from `bash -x` or an exported SHELLOPTS=xtrace
# before any line runs, and while the hook input is read (see "Debug mode support" below);
# the trace goes to stdout too where BASH_XTRACEFD=1
{ set +x; } >/dev/null 2>&1
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
# shellcheck source=lib/last_error.sh
source "$SCRIPT_DIR/lib/last_error.sh"
# shellcheck source=lib/html.sh
source "$SCRIPT_DIR/lib/html.sh"

# Reading the event needs jq and sending needs curl. Without them, skip quietly
# when notifications are off; when on, say so in one line (exit 1: Claude Code
# shows it without blocking the stop, as exit 2 would). curl alone is checked
# below, where the session file is consumed too
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
  # Only where the trace goes to stderr: a BASH_XTRACEFD naming stdout would put
  # it into every $(…) value, the message among them
  if [[ "${BASH_XTRACEFD:-2}" == "2" ]]; then
    set -x
  fi
  exec 2>&1
fi

# Read the session file into SESSION_START ("0" without one) and remove it. Every
# path below consumes it, so it is cleaned up even if the plugin is disabled (a
# user disabling it mid-session); the main path consumes it only once the config
# is read, right before the job below starts, so a hook stopped while it reads
# the config leaves the file in place
consume_session_file() {
  SESSION_FILE=$(get_session_file_path)
  SESSION_START="0"

  if [[ -f "$SESSION_FILE" ]]; then
    SESSION_START=$(cat "$SESSION_FILE" 2>/dev/null || echo "0")
    rm -f "$SESSION_FILE" 2>/dev/null || true
  fi
}

# Check if plugin is enabled at any level (user or project config)
ENABLED_STATUS=$(is_plugin_enabled)

if [[ "$ENABLED_STATUS" != "true" ]]; then
  consume_session_file
  exit 0
fi

if ! command -v curl &> /dev/null; then
  consume_session_file
  echo "Telegram Notifier: session notification skipped, missing curl" >&2
  exit 1
fi

# Get threshold (project > user > default of 10 minutes)
THRESHOLD=$(resolve_config_field "session_threshold_minutes" "10")
# Validate threshold is numeric, and read it in base 10 (a leading 0 means octal
# in bash arithmetic: 010 would be 8, and 08 an error)
if ! [[ "$THRESHOLD" =~ ^[0-9]{1,6}$ ]]; then
  THRESHOLD=10
fi
THRESHOLD=$((10#$THRESHOLD))

consume_session_file

if [[ ! "$SESSION_START" =~ ^[0-9]{1,12}$ ]] || ((10#$SESSION_START == 0)); then
  # Invalid timestamp, skip
  exit 0
fi
SESSION_START=$((10#$SESSION_START))

CURRENT_TIME=$(date +%s)
ELAPSED_SECONDS=$((CURRENT_TIME - SESSION_START))
ELAPSED_MINUTES=$((ELAPSED_SECONDS / 60))

# Check if threshold exceeded
if [[ $ELAPSED_MINUTES -lt $THRESHOLD ]]; then
  exit 0
fi

# Summarize, build the message and send it
deliver() {
  # Get project name (used in message and custom body resolution)
  PROJECT_NAME=$(basename "${CLAUDE_PROJECT_DIR:-$(pwd)}")

  # Get custom message (project body > user body)
  CUSTOM_MESSAGE=$(get_notification_body)

  # Get transcript summary if available
  TASK_SUMMARY=""
  if [[ -n "${TRANSCRIPT_PATH:-}" && -f "${TRANSCRIPT_PATH}" ]]; then
    # At most 4 s under coreutils' timeout (gtimeout from Homebrew on macOS), so a
    # huge transcript on a slow machine leaves time to send; past it, the message
    # goes without a summary. With neither, only a transcript of at most 10 MB is
    # summarized (about 0.1 s); a larger one goes without a summary
    SUMMARIZE=("$SCRIPT_DIR/summarize-transcript.sh" "$TRANSCRIPT_PATH")
    TIMEOUT_BIN=$(command -v timeout || command -v gtimeout || true)
    if [[ -n "$TIMEOUT_BIN" ]]; then
      SUMMARIZE=("$TIMEOUT_BIN" 4 "${SUMMARIZE[@]}")
    else
      # BSD wc pads the count with spaces
      TRANSCRIPT_BYTES=$(wc -c < "$TRANSCRIPT_PATH" 2>/dev/null || echo 0)
      if ((${TRANSCRIPT_BYTES// /} > 10 * 1024 * 1024)); then
        SUMMARIZE=(true)
      fi
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

  # curl gets the time left until 8 s after this script started (SECONDS): in debug
  # mode the hook ends inside its 10 s, and the detached job ends too
  SEND_TIME=$((8 - SECONDS))
  ((SEND_TIME >= 1)) || SEND_TIME=1

  # Send notification using shared script (handles JSON escaping and response validation)
  if [[ "${TELEGRAM_NOTIFIER_DEBUG:-}" == "1" ]]; then
    echo "Sending notification: $MESSAGE" >&2
  fi
  # The detached job's output goes nowhere, so a failure's reason (the sender's last
  # stderr line, which never holds the token) is recorded for the next SessionStart
  # to report (lib/last_error.sh)
  local err sent=1
  err=$(printf '%s' "$MESSAGE" | bash "$SCRIPT_DIR/send-telegram.sh" "$SEND_TIME" 2>&1 > /dev/null) || sent=0
  # Debug mode: the sender's payload and response lines
  if [[ "${TELEGRAM_NOTIFIER_DEBUG:-}" == "1" && -n "$err" ]]; then
    printf '%s\n' "$err" >&2
  fi
  if ((sent)); then
    clear_send_failure
  else
    err=${err##*$'\n'}
    err=${err#Error: }
    record_send_failure "$err"
    echo "Warning: Failed to send session notification: $err" >&2
  fi
}

# The session file is consumed above, so a hook stopped from here on would lose
# the notification: the slow part (summary and send) runs as a detached job and the
# hook ends at once, out of reach of its 10 s timeout. Job control (set -m, for
# this one job) starts it in its own process group, so a signal to the hook's
# group (a runner cancelling the hook with SIGTERM) doesn't reach it. The job
# holds none of the hook's input or output and ignores SIGHUP (a closed terminal)
# and SIGINT (Ctrl+C), which a background job no longer ignores under job
# control. Debug mode keeps it in the foreground, so its trace and the API
# response show in the hook output
if [[ "${TELEGRAM_NOTIFIER_DEBUG:-}" == "1" ]]; then
  deliver
else
  set -m
  (
    trap '' HUP INT
    deliver
  ) < /dev/null > /dev/null 2>&1 &
  set +m
fi

exit 0
