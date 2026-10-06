#!/bin/bash
# Session management and hook initialization utilities

# Extract and export session_id from hook input JSON
# Usage: Call after capturing stdin, e.g.:
#   HOOK_INPUT=$(cat)
#   extract_session_id "$HOOK_INPUT"
# Sets: CLAUDE_SESSION_ID (exported)
extract_session_id() {
  local input="${1:-}"
  local val
  val=$(echo "$input" | jq -r '.session_id // empty')
  export CLAUDE_SESSION_ID="$val"
}

# Extract and export cwd from hook input JSON
# Usage: extract_cwd "$HOOK_INPUT"
# Sets: CLAUDE_CWD (exported)
extract_cwd() {
  local input="${1:-}"
  local val
  val=$(echo "$input" | jq -r '.cwd // empty')
  export CLAUDE_CWD="$val"
}

# Extract transcript_path from hook input JSON
# Only available in Stop/SubagentStop hooks
# Usage: extract_transcript_path "$HOOK_INPUT"
# Sets: TRANSCRIPT_PATH (used by callers after sourcing)
extract_transcript_path() {
  local input="${1:-}"
  # shellcheck disable=SC2034 # TRANSCRIPT_PATH is read by callers after sourcing
  TRANSCRIPT_PATH=$(echo "$input" | jq -r '.transcript_path // empty')
}

# Extract last_assistant_message from hook input JSON
# Only available in Stop/SubagentStop hooks
# Usage: extract_last_assistant_message "$HOOK_INPUT"
# Sets: LAST_ASSISTANT_MESSAGE (exported for subprocesses)
extract_last_assistant_message() {
  local input="${1:-}"
  local val
  val=$(echo "$input" | jq -r '.last_assistant_message // empty')
  export LAST_ASSISTANT_MESSAGE="$val"
}

# Get session activity file path (tracks last user interaction)
# Uses Claude's session_id to avoid multi-instance conflicts
# Requires CLAUDE_SESSION_ID to be set via extract_session_id
get_session_file_path() {
  if [[ -z "${CLAUDE_SESSION_ID:-}" ]]; then
    # Fallback if session ID not available
    echo "/tmp/claude-telegram-notifier-session-unknown"
    return
  fi
  echo "/tmp/claude-telegram-notifier-session-${CLAUDE_SESSION_ID}"
}

# Clean up stale session files older than specified hours (default: 24)
# These can accumulate if Claude terminates abnormally
# Usage: cleanup_stale_session_files [hours]
cleanup_stale_session_files() {
  local max_age_hours="${1:-24}"
  find /tmp -maxdepth 1 -name 'claude-telegram-notifier-session-*' -type f -mmin "+$((max_age_hours * 60))" -delete 2>/dev/null || true
}
