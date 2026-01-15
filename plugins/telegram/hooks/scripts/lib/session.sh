#!/bin/bash
# Session management and hook initialization utilities

# Extract and export session_id from hook input JSON
# Usage: Call after capturing stdin, e.g.:
#   HOOK_INPUT=$(cat)
#   extract_session_id "$HOOK_INPUT"
# Sets: CLAUDE_SESSION_ID (exported)
extract_session_id() {
  local input="${1:-}"
  export CLAUDE_SESSION_ID=$(echo "$input" | jq -r '.session_id // empty')
}

# Extract and export cwd from hook input JSON
# Usage: extract_cwd "$HOOK_INPUT"
# Sets: CLAUDE_CWD (exported)
extract_cwd() {
  local input="${1:-}"
  export CLAUDE_CWD=$(echo "$input" | jq -r '.cwd // empty')
}

# Extract transcript_path from hook input JSON
# Only available in Stop/SubagentStop hooks
# Usage: extract_transcript_path "$HOOK_INPUT"
# Sets: TRANSCRIPT_PATH
extract_transcript_path() {
  local input="${1:-}"
  TRANSCRIPT_PATH=$(echo "$input" | jq -r '.transcript_path // empty')
}

# Get session activity file path (tracks last user interaction)
# Uses Claude's session_id to avoid multi-instance conflicts
# Requires CLAUDE_SESSION_ID to be set via extract_session_id
get_session_file_path() {
  if [[ -z "${CLAUDE_SESSION_ID:-}" ]]; then
    # Fallback if session ID not available
    echo "/tmp/claude-telegram-session-unknown"
    return
  fi
  echo "/tmp/claude-telegram-session-${CLAUDE_SESSION_ID}"
}

# Clean up stale session files older than specified hours (default: 24)
# These can accumulate if Claude terminates abnormally
# Usage: cleanup_stale_session_files [hours]
cleanup_stale_session_files() {
  local max_age_hours="${1:-24}"
  find /tmp -maxdepth 1 -name 'claude-telegram-session-*' -type f -mmin "+$((max_age_hours * 60))" -delete 2>/dev/null || true
}
