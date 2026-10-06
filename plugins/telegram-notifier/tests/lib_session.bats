#!/usr/bin/env bats

# Tests for lib/session.sh — session ID extraction, file paths, cleanup

setup() {
  PLUGIN_DIR="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)"
  source "$PLUGIN_DIR/hooks/scripts/lib/session.sh"

  # Reset globals
  unset CLAUDE_SESSION_ID
  unset CLAUDE_CWD
  unset TRANSCRIPT_PATH
  unset LAST_ASSISTANT_MESSAGE
}

# --- extract_session_id ---

@test "extract_session_id: sets CLAUDE_SESSION_ID from JSON" {
  extract_session_id '{"session_id": "abc-123"}'
  [ "$CLAUDE_SESSION_ID" = "abc-123" ]
}

@test "extract_session_id: sets empty when session_id missing" {
  extract_session_id '{"cwd": "/tmp"}'
  [ "$CLAUDE_SESSION_ID" = "" ]
}

@test "extract_session_id: handles empty input" {
  extract_session_id ""
  [ "$CLAUDE_SESSION_ID" = "" ]
}

# --- extract_cwd ---

@test "extract_cwd: sets CLAUDE_CWD from JSON" {
  extract_cwd '{"cwd": "/home/user/project"}'
  [ "$CLAUDE_CWD" = "/home/user/project" ]
}

@test "extract_cwd: sets empty when cwd missing" {
  extract_cwd '{"session_id": "x"}'
  [ "$CLAUDE_CWD" = "" ]
}

# --- extract_transcript_path ---

@test "extract_transcript_path: sets TRANSCRIPT_PATH from JSON" {
  extract_transcript_path '{"transcript_path": "/tmp/transcript.jsonl"}'
  [ "$TRANSCRIPT_PATH" = "/tmp/transcript.jsonl" ]
}

@test "extract_transcript_path: sets empty when field missing" {
  extract_transcript_path '{"session_id": "x"}'
  [ "$TRANSCRIPT_PATH" = "" ]
}

# --- extract_last_assistant_message ---

@test "extract_last_assistant_message: sets LAST_ASSISTANT_MESSAGE" {
  extract_last_assistant_message '{"last_assistant_message": "All done."}'
  [ "$LAST_ASSISTANT_MESSAGE" = "All done." ]
}

@test "extract_last_assistant_message: handles multiline JSON value" {
  extract_last_assistant_message '{"last_assistant_message": "Line1\nLine2"}'
  [[ "$LAST_ASSISTANT_MESSAGE" == *"Line1"* ]]
}

# --- get_session_file_path ---

@test "get_session_file_path: returns path with session ID" {
  export CLAUDE_SESSION_ID="test-session-42"
  run get_session_file_path
  [ "$output" = "/tmp/claude-telegram-notifier-session-test-session-42" ]
}

@test "get_session_file_path: returns unknown fallback without session ID" {
  unset CLAUDE_SESSION_ID
  run get_session_file_path
  [ "$output" = "/tmp/claude-telegram-notifier-session-unknown" ]
}

@test "get_session_file_path: returns unknown fallback for empty session ID" {
  export CLAUDE_SESSION_ID=""
  run get_session_file_path
  [ "$output" = "/tmp/claude-telegram-notifier-session-unknown" ]
}

# --- cleanup_stale_session_files ---

@test "cleanup_stale_session_files: does not crash when no files exist" {
  run cleanup_stale_session_files 24
  [ "$status" -eq 0 ]
}
