#!/usr/bin/env bats

# End-to-end tests for hook entrypoints:
# check-credentials.sh, update-activity.sh, session-notification.sh,
# send-telegram.sh, summarize-transcript.sh

bats_require_minimum_version 1.5.0

setup() {
  PLUGIN_DIR="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)"
  SCRIPTS="$PLUGIN_DIR/hooks/scripts"
  FIXTURES="$(cd "$(dirname "$BATS_TEST_FILENAME")" && pwd)/fixtures"

  # Isolate from real config
  export HOME="$BATS_TEST_TMPDIR/home"
  export CLAUDE_PROJECT_DIR="$BATS_TEST_TMPDIR/project"
  mkdir -p "$HOME/.claude"
  mkdir -p "$CLAUDE_PROJECT_DIR/.claude"

  # Stub curl: record args, return success JSON
  mkdir -p "$BATS_TEST_TMPDIR/bin"
  cat > "$BATS_TEST_TMPDIR/bin/curl" <<'CURL'
#!/bin/bash
printf '%s\n' "$@" >> "$BATS_TEST_TMPDIR/curl_args"
echo '{"ok":true,"result":{"message_id":1}}'
CURL
  chmod +x "$BATS_TEST_TMPDIR/bin/curl"
  export PATH="$BATS_TEST_TMPDIR/bin:$PATH"

  # Default credentials
  export TELEGRAM_BOT_TOKEN="test-token-123"
  export TELEGRAM_CHAT_ID="test-chat-456"
}

# Print a dir to use as PATH: every system tool except the named ones
path_without() {
  local dir="$BATS_TEST_TMPDIR/path-without-${*// /-}"
  mkdir -p "$dir"
  local f
  for f in /usr/bin/* /bin/*; do
    [[ " $* " == *" $(basename "$f") "* ]] && continue
    ln -sf "$f" "$dir/" 2>/dev/null || true
  done
  echo "$dir"
}

# =========================================================
# check-credentials.sh
# =========================================================

@test "check-credentials: shows unconfigured when no config" {
  rm -f "$HOME/.claude/telegram-notifier.local.md"
  rm -f "$CLAUDE_PROJECT_DIR/.claude/telegram-notifier.local.md"
  run bash "$SCRIPTS/check-credentials.sh" <<< '{"session_id":"s1"}'
  [ "$status" -eq 0 ]
  [[ "$output" == *"No config found"* ]]
}

@test "check-credentials: exits silently when disabled" {
  cat > "$HOME/.claude/telegram-notifier.local.md" <<'EOF'
---
enabled: false
---
EOF
  run bash "$SCRIPTS/check-credentials.sh" <<< '{"session_id":"s1"}'
  [ "$status" -eq 0 ]
  [ "$output" = "" ]
}

@test "check-credentials: reports ready when enabled with credentials" {
  cat > "$HOME/.claude/telegram-notifier.local.md" <<'EOF'
---
enabled: true
---
EOF
  run bash "$SCRIPTS/check-credentials.sh" <<< '{"session_id":"s1"}'
  [ "$status" -eq 0 ]
  [[ "$output" == *"Ready"* ]]
}

@test "check-credentials: debug mode never prints the bot token" {
  cat > "$HOME/.claude/telegram-notifier.local.md" <<'EOF'
---
enabled: true
---
EOF
  export TELEGRAM_NOTIFIER_DEBUG=1
  run --separate-stderr bash "$SCRIPTS/check-credentials.sh" <<< '{"session_id":"cc-dbg"}'
  [ "$status" -eq 0 ]
  [[ "$output" == *"Ready"* ]]
  [[ "$output$stderr" != *"$TELEGRAM_BOT_TOKEN"* ]]
}

@test "session-notification: debug mode never prints the bot token" {
  cat > "$HOME/.claude/telegram-notifier.local.md" <<'EOF'
---
enabled: true
session_threshold_minutes: 0
---
EOF
  local sf="/tmp/claude-telegram-notifier-session-sn-dbg"
  echo "$(($(date +%s) - 900))" > "$sf"
  export TELEGRAM_NOTIFIER_DEBUG=1
  run --separate-stderr bash "$SCRIPTS/session-notification.sh" <<< '{"session_id":"sn-dbg","cwd":"/tmp/test","transcript_path":"","last_assistant_message":""}'
  [ "$status" -eq 0 ]
  [ -f "$BATS_TEST_TMPDIR/curl_args" ]
  [[ "$output$stderr" != *"$TELEGRAM_BOT_TOKEN"* ]]
}

@test "check-credentials: bash -x never prints the bot token" {
  cat > "$HOME/.claude/telegram-notifier.local.md" <<'EOF'
---
enabled: true
---
EOF
  run --separate-stderr bash -x "$SCRIPTS/check-credentials.sh" <<< '{"session_id":"cc-x"}'
  [ "$status" -eq 0 ]
  [[ "$output" == *"Ready"* ]]
  [[ "$stderr" == *"+ "* ]]
  [[ "$output$stderr" != *"$TELEGRAM_BOT_TOKEN"* ]]
}

@test "session-notification: exported SHELLOPTS=xtrace never prints the bot token" {
  cat > "$HOME/.claude/telegram-notifier.local.md" <<'EOF'
---
enabled: true
session_threshold_minutes: 0
---
EOF
  local sf="/tmp/claude-telegram-notifier-session-sn-x"
  echo "$(($(date +%s) - 900))" > "$sf"
  # Debug mode shows send-telegram.sh's stderr; SHELLOPTS traces that child too
  export TELEGRAM_NOTIFIER_DEBUG=1
  run --separate-stderr env SHELLOPTS=xtrace bash "$SCRIPTS/session-notification.sh" <<< '{"session_id":"sn-x","cwd":"/tmp/test","transcript_path":"","last_assistant_message":""}'
  [ "$status" -eq 0 ]
  [ -f "$BATS_TEST_TMPDIR/curl_args" ]
  [[ "$output" == *"+ "* ]]
  [[ "$output$stderr" != *"$TELEGRAM_BOT_TOKEN"* ]]
}

@test "hooks.json: every command path is quoted" {
  run jq -r '.hooks[][].hooks[].command' "$PLUGIN_DIR/hooks/hooks.json"
  [ "$status" -eq 0 ]
  local line
  while IFS= read -r line; do
    [[ "$line" == '"${CLAUDE_PLUGIN_ROOT}/'*'"' ]]
  done <<< "$output"
}

@test "check-credentials: fails when credentials missing" {
  cat > "$HOME/.claude/telegram-notifier.local.md" <<'EOF'
---
enabled: true
---
EOF
  unset TELEGRAM_BOT_TOKEN
  unset TELEGRAM_CHAT_ID
  run bash "$SCRIPTS/check-credentials.sh" <<< '{"session_id":"s1"}'
  [ "$status" -eq 2 ]
  [[ "$output" == *"TELEGRAM_BOT_TOKEN"* ]]
  [[ "$output" == *"TELEGRAM_CHAT_ID"* ]]
}

@test "check-credentials: fails when only token missing" {
  cat > "$HOME/.claude/telegram-notifier.local.md" <<'EOF'
---
enabled: true
---
EOF
  unset TELEGRAM_BOT_TOKEN
  run bash "$SCRIPTS/check-credentials.sh" <<< '{"session_id":"s1"}'
  [ "$status" -eq 2 ]
  [[ "$output" == *"TELEGRAM_BOT_TOKEN"* ]]
}

# Claude Code shows only the first stderr line of a failing hook
@test "check-credentials: missing-credentials error is one line of valid JSON" {
  cat > "$HOME/.claude/telegram-notifier.local.md" <<'EOF'
---
enabled: true
---
EOF
  unset TELEGRAM_BOT_TOKEN
  unset TELEGRAM_CHAT_ID
  run --separate-stderr bash "$SCRIPTS/check-credentials.sh" <<< '{"session_id":"s1"}'
  [ "$status" -eq 2 ]
  [ "$output" = "" ]
  [ "${#stderr_lines[@]}" -eq 1 ]
  [ "$(jq -r .error <<< "$stderr")" = "Missing Telegram credentials: TELEGRAM_BOT_TOKEN,TELEGRAM_CHAT_ID" ]
  [[ "$(jq -r .systemMessage <<< "$stderr")" == *"(TELEGRAM_BOT_TOKEN,TELEGRAM_CHAT_ID)"* ]]
}

@test "check-credentials: missing-dependency error is one line of valid JSON" {
  cat > "$HOME/.claude/telegram-notifier.local.md" <<'EOF'
---
enabled: true
---
EOF
  run --separate-stderr env PATH="$(path_without curl)" bash "$SCRIPTS/check-credentials.sh" <<< '{"session_id":"s1"}'
  [ "$status" -eq 2 ]
  [ "$output" = "" ]
  [ "${#stderr_lines[@]}" -eq 1 ]
  [ "$(jq -r .error <<< "$stderr")" = "Missing dependencies: curl" ]
  [[ "$(jq -r .systemMessage <<< "$stderr")" == *$'\n\n- jq:'* ]]
}

@test "check-credentials: reports missing jq instead of exiting 127" {
  cat > "$HOME/.claude/telegram-notifier.local.md" <<'EOF'
---
enabled: true
---
EOF
  run --separate-stderr env PATH="$(path_without jq)" bash "$SCRIPTS/check-credentials.sh" <<< '{"session_id":"s1"}'
  [ "$status" -eq 2 ]
  [ "$output" = "" ]
  [ "${#stderr_lines[@]}" -eq 1 ]
  [ "$(jq -r .error <<< "$stderr")" = "Missing dependencies: jq" ]
  [[ "$(jq -r .systemMessage <<< "$stderr")" == *"https://jqlang.github.io/jq/download/"* ]]
}

@test "check-credentials: reports both jq and curl missing" {
  cat > "$HOME/.claude/telegram-notifier.local.md" <<'EOF'
---
enabled: true
---
EOF
  run --separate-stderr env PATH="$(path_without jq curl)" bash "$SCRIPTS/check-credentials.sh" <<< '{"session_id":"s1"}'
  [ "$status" -eq 2 ]
  [ "$(jq -r .error <<< "$stderr")" = "Missing dependencies: jq,curl" ]
}

@test "check-credentials: without jq, still reports unconfigured" {
  rm -f "$HOME/.claude/telegram-notifier.local.md"
  rm -f "$CLAUDE_PROJECT_DIR/.claude/telegram-notifier.local.md"
  run --separate-stderr env PATH="$(path_without jq)" bash "$SCRIPTS/check-credentials.sh" <<< '{"session_id":"s1"}'
  [ "$status" -eq 0 ]
  [ "$stderr" = "" ]
  [[ "$output" == *"No config found"* ]]
}

@test "check-credentials: without jq, leaves the unknown session file alone" {
  local sf="/tmp/claude-telegram-notifier-session-unknown"
  [ ! -e "$sf" ] || skip "$sf belongs to a real session"
  cat > "$HOME/.claude/telegram-notifier.local.md" <<'EOF'
---
enabled: true
---
EOF
  echo "12345" > "$sf"
  run env PATH="$(path_without jq)" bash "$SCRIPTS/check-credentials.sh" <<< '{"session_id":"s1"}'
  local kept=no
  [ -f "$sf" ] && kept=yes
  rm -f "$sf"
  [ "$status" -eq 2 ]
  [ "$kept" = yes ]
}

@test "check-credentials: cleans up stale session files" {
  cat > "$HOME/.claude/telegram-notifier.local.md" <<'EOF'
---
enabled: true
---
EOF
  # Create a session file — check-credentials removes the current session file
  local sf="/tmp/claude-telegram-notifier-session-s1"
  echo "12345" > "$sf"
  run bash "$SCRIPTS/check-credentials.sh" <<< '{"session_id":"s1"}'
  [ "$status" -eq 0 ]
  [ ! -f "$sf" ]
}

# =========================================================
# update-activity.sh
# =========================================================

@test "update-activity: creates session file with timestamp" {
  cat > "$HOME/.claude/telegram-notifier.local.md" <<'EOF'
---
enabled: true
---
EOF
  run bash "$SCRIPTS/update-activity.sh" <<< '{"session_id":"upd-1"}'
  [ "$status" -eq 0 ]
  local sf="/tmp/claude-telegram-notifier-session-upd-1"
  [ -f "$sf" ]
  # Session file should contain a numeric timestamp
  local ts
  ts=$(cat "$sf")
  [[ "$ts" =~ ^[0-9]+$ ]]
  rm -f "$sf"
}

@test "update-activity: exits silently when disabled" {
  cat > "$HOME/.claude/telegram-notifier.local.md" <<'EOF'
---
enabled: false
---
EOF
  run bash "$SCRIPTS/update-activity.sh" <<< '{"session_id":"upd-2"}'
  [ "$status" -eq 0 ]
  [ ! -f "/tmp/claude-telegram-notifier-session-upd-2" ]
}

@test "update-activity: exits silently when no credentials" {
  cat > "$HOME/.claude/telegram-notifier.local.md" <<'EOF'
---
enabled: true
---
EOF
  unset TELEGRAM_BOT_TOKEN
  run bash "$SCRIPTS/update-activity.sh" <<< '{"session_id":"upd-3"}'
  [ "$status" -eq 0 ]
  [ ! -f "/tmp/claude-telegram-notifier-session-upd-3" ]
}

@test "update-activity: bash -x never prints the bot token" {
  cat > "$HOME/.claude/telegram-notifier.local.md" <<'EOF'
---
enabled: true
---
EOF
  run --separate-stderr bash -x "$SCRIPTS/update-activity.sh" <<< '{"session_id":"upd-x"}'
  [ "$status" -eq 0 ]
  [[ "$stderr" == *"+ "* ]]
  [[ "$output$stderr" != *"$TELEGRAM_BOT_TOKEN"* ]]
  [ -f "/tmp/claude-telegram-notifier-session-upd-x" ]
  rm -f "/tmp/claude-telegram-notifier-session-upd-x"
}

# =========================================================
# send-telegram.sh
# =========================================================

@test "send-telegram: sends message via curl with correct payload" {
  run bash "$SCRIPTS/send-telegram.sh" "Hello World"
  [ "$status" -eq 0 ]
  [[ "$output" == *'"ok":true'* ]]
  # Check curl was called
  [ -f "$BATS_TEST_TMPDIR/curl_args" ]
  local args
  args=$(cat "$BATS_TEST_TMPDIR/curl_args")
  [[ "$args" == *"sendMessage"* ]]
}

@test "send-telegram: debug mode never prints the bot token" {
  export TELEGRAM_NOTIFIER_DEBUG=1
  run --separate-stderr bash "$SCRIPTS/send-telegram.sh" "Hello World"
  [ "$status" -eq 0 ]
  [[ "$stderr" == *"Payload:"* ]]
  [[ "$output$stderr" != *"$TELEGRAM_BOT_TOKEN"* ]]
}

@test "send-telegram: bash -x never prints the bot token" {
  run --separate-stderr bash -x "$SCRIPTS/send-telegram.sh" "Hello World"
  [ "$status" -eq 0 ]
  [ -f "$BATS_TEST_TMPDIR/curl_args" ]
  [[ "$stderr" == *"+ "* ]]
  [[ "$output$stderr" != *"$TELEGRAM_BOT_TOKEN"* ]]
}

@test "send-telegram: curl times out inside the Stop hook's 10 s" {
  run bash "$SCRIPTS/send-telegram.sh" "Hello World"
  [ "$status" -eq 0 ]
  local args
  args=$(cat "$BATS_TEST_TMPDIR/curl_args")
  [[ "$args" == *$'-m\n8'* ]]
}

@test "send-telegram: fails with no message" {
  run bash "$SCRIPTS/send-telegram.sh" ""
  [ "$status" -eq 1 ]
  [[ "$output" == *"No message"* ]]
}

@test "send-telegram: fails with no arguments" {
  run bash "$SCRIPTS/send-telegram.sh"
  [ "$status" -eq 1 ]
}

@test "send-telegram: fails when credentials missing" {
  unset TELEGRAM_BOT_TOKEN
  run bash "$SCRIPTS/send-telegram.sh" "test"
  [ "$status" -eq 1 ]
  [[ "$output" == *"Missing"* ]]
}

@test "send-telegram: reports error on API failure" {
  # Override curl stub to return error
  cat > "$BATS_TEST_TMPDIR/bin/curl" <<'CURL'
#!/bin/bash
echo '{"ok":false,"description":"Unauthorized"}'
CURL
  chmod +x "$BATS_TEST_TMPDIR/bin/curl"
  run bash "$SCRIPTS/send-telegram.sh" "test"
  [ "$status" -eq 1 ]
  [[ "$output" == *"Unauthorized"* ]]
}

# =========================================================
# session-notification.sh
# =========================================================

@test "session-notification: sends notification when threshold exceeded" {
  cat > "$HOME/.claude/telegram-notifier.local.md" <<'EOF'
---
enabled: true
session_threshold_minutes: 0
---
EOF
  # Create a session file with a timestamp from 15 minutes ago
  local past_ts
  past_ts=$(($(date +%s) - 900))
  local sf="/tmp/claude-telegram-notifier-session-sn-1"
  echo "$past_ts" > "$sf"

  run bash "$SCRIPTS/session-notification.sh" <<< '{"session_id":"sn-1","cwd":"/tmp/test","transcript_path":"","last_assistant_message":""}'
  [ "$status" -eq 0 ]
  # curl should have been called (notification sent)
  [ -f "$BATS_TEST_TMPDIR/curl_args" ]
  # Session file should be cleaned up
  [ ! -f "$sf" ]
}

@test "session-notification: skips when threshold not exceeded" {
  cat > "$HOME/.claude/telegram-notifier.local.md" <<'EOF'
---
enabled: true
session_threshold_minutes: 60
---
EOF
  # Session started just now
  local now
  now=$(date +%s)
  local sf="/tmp/claude-telegram-notifier-session-sn-2"
  echo "$now" > "$sf"

  run bash "$SCRIPTS/session-notification.sh" <<< '{"session_id":"sn-2","cwd":"/tmp","transcript_path":"","last_assistant_message":""}'
  [ "$status" -eq 0 ]
  # curl should NOT have been called
  [ ! -f "$BATS_TEST_TMPDIR/curl_args" ]
  # Session file should still be cleaned up
  [ ! -f "$sf" ]
}

@test "session-notification: skips when disabled" {
  cat > "$HOME/.claude/telegram-notifier.local.md" <<'EOF'
---
enabled: false
---
EOF
  local sf="/tmp/claude-telegram-notifier-session-sn-3"
  echo "1000000" > "$sf"

  run bash "$SCRIPTS/session-notification.sh" <<< '{"session_id":"sn-3","cwd":"/tmp","transcript_path":"","last_assistant_message":""}'
  [ "$status" -eq 0 ]
  [ ! -f "$BATS_TEST_TMPDIR/curl_args" ]
  # Session file should still be cleaned up even when disabled
  [ ! -f "$sf" ]
}

@test "session-notification: skips when no session file" {
  cat > "$HOME/.claude/telegram-notifier.local.md" <<'EOF'
---
enabled: true
session_threshold_minutes: 0
---
EOF
  rm -f "/tmp/claude-telegram-notifier-session-sn-4"
  run bash "$SCRIPTS/session-notification.sh" <<< '{"session_id":"sn-4","cwd":"/tmp","transcript_path":"","last_assistant_message":""}'
  [ "$status" -eq 0 ]
  [ ! -f "$BATS_TEST_TMPDIR/curl_args" ]
}

@test "session-notification: includes project name in message" {
  export CLAUDE_PROJECT_DIR="$BATS_TEST_TMPDIR/my-cool-project"
  mkdir -p "$CLAUDE_PROJECT_DIR/.claude"
  cat > "$HOME/.claude/telegram-notifier.local.md" <<'EOF'
---
enabled: true
session_threshold_minutes: 0
---
EOF
  local past_ts
  past_ts=$(($(date +%s) - 900))
  local sf="/tmp/claude-telegram-notifier-session-sn-5"
  echo "$past_ts" > "$sf"

  # Use a curl stub that captures the payload
  cat > "$BATS_TEST_TMPDIR/bin/curl" <<'CURL'
#!/bin/bash
for arg in "$@"; do echo "$arg"; done >> "$BATS_TEST_TMPDIR/curl_payload"
echo '{"ok":true,"result":{"message_id":1}}'
CURL
  chmod +x "$BATS_TEST_TMPDIR/bin/curl"

  run bash "$SCRIPTS/session-notification.sh" <<< '{"session_id":"sn-5","cwd":"/tmp","transcript_path":"","last_assistant_message":""}'
  [ "$status" -eq 0 ]
  [ -f "$BATS_TEST_TMPDIR/curl_payload" ]
  local payload
  payload=$(cat "$BATS_TEST_TMPDIR/curl_payload")
  [[ "$payload" == *"my-cool-project"* ]]
}

@test "session-notification: uses custom body from config" {
  cat > "$HOME/.claude/telegram-notifier.local.md" <<'EOF'
---
enabled: true
session_threshold_minutes: 0
---
Build finished, check results
EOF
  local past_ts
  past_ts=$(($(date +%s) - 900))
  local sf="/tmp/claude-telegram-notifier-session-sn-6"
  echo "$past_ts" > "$sf"

  cat > "$BATS_TEST_TMPDIR/bin/curl" <<'CURL'
#!/bin/bash
for arg in "$@"; do echo "$arg"; done >> "$BATS_TEST_TMPDIR/curl_payload"
echo '{"ok":true,"result":{"message_id":1}}'
CURL
  chmod +x "$BATS_TEST_TMPDIR/bin/curl"

  run bash "$SCRIPTS/session-notification.sh" <<< '{"session_id":"sn-6","cwd":"/tmp","transcript_path":"","last_assistant_message":""}'
  [ "$status" -eq 0 ]
  local payload
  payload=$(cat "$BATS_TEST_TMPDIR/curl_payload")
  [[ "$payload" == *"Build finished"* ]]
}

@test "session-notification: handles non-numeric threshold gracefully" {
  cat > "$HOME/.claude/telegram-notifier.local.md" <<'EOF'
---
enabled: true
session_threshold_minutes: abc
---
EOF
  local past_ts
  past_ts=$(($(date +%s) - 900))
  local sf="/tmp/claude-telegram-notifier-session-sn-7"
  echo "$past_ts" > "$sf"

  # Non-numeric threshold should fall back to 10
  run bash "$SCRIPTS/session-notification.sh" <<< '{"session_id":"sn-7","cwd":"/tmp","transcript_path":"","last_assistant_message":""}'
  [ "$status" -eq 0 ]
  # 15min elapsed > 10min default threshold → should send
  [ -f "$BATS_TEST_TMPDIR/curl_args" ]
}

# =========================================================
# summarize-transcript.sh
# =========================================================

@test "summarize-transcript: uses last_assistant_message when set" {
  export LAST_ASSISTANT_MESSAGE="## Summary\nFixed the bug in main.rs"
  run bash "$SCRIPTS/summarize-transcript.sh" "$FIXTURES/transcript.jsonl"
  [ "$status" -eq 0 ]
  [[ "$output" == *"Fixed the bug"* ]]
}

@test "summarize-transcript: falls back to tool extraction when no last message" {
  unset LAST_ASSISTANT_MESSAGE
  run bash "$SCRIPTS/summarize-transcript.sh" "$FIXTURES/transcript.jsonl"
  [ "$status" -eq 0 ]
  # Should mention edited/created files or commands from the transcript
  [[ "$output" == *"Edited"* ]] || [[ "$output" == *"Created"* ]] || [[ "$output" == *"Ran"* ]]
}

@test "summarize-transcript: returns empty for missing transcript" {
  run bash "$SCRIPTS/summarize-transcript.sh" "$BATS_TEST_TMPDIR/nonexistent.jsonl"
  [ "$status" -eq 0 ]
  [ "$output" = "" ]
}

@test "summarize-transcript: returns empty for empty path" {
  run bash "$SCRIPTS/summarize-transcript.sh" ""
  [ "$status" -eq 0 ]
  [ "$output" = "" ]
}

@test "summarize-transcript: returns empty for no arguments" {
  run bash "$SCRIPTS/summarize-transcript.sh"
  [ "$status" -eq 0 ]
  [ "$output" = "" ]
}

@test "summarize-transcript: truncates long last_assistant_message" {
  # Create a message longer than 1000 chars
  local long_msg
  long_msg=$(head -c 1500 /dev/zero | tr '\0' 'A')
  export LAST_ASSISTANT_MESSAGE="$long_msg"
  run bash "$SCRIPTS/summarize-transcript.sh" "$FIXTURES/transcript.jsonl"
  [ "$status" -eq 0 ]
  # Output should be truncated (with HTML escaping, but plain A chars don't change)
  [ ${#output} -le 1010 ]
}

@test "summarize-transcript: HTML-escapes last_assistant_message" {
  export LAST_ASSISTANT_MESSAGE="Fixed <main> & lib"
  run bash "$SCRIPTS/summarize-transcript.sh" "$FIXTURES/transcript.jsonl"
  [ "$status" -eq 0 ]
  [[ "$output" == *"&lt;main&gt;"* ]]
  [[ "$output" == *"&amp;"* ]]
}

@test "summarize-transcript: strips markdown formatting from last message" {
  export LAST_ASSISTANT_MESSAGE="**Bold** and \`code\` and ## Heading"
  run bash "$SCRIPTS/summarize-transcript.sh" "$FIXTURES/transcript.jsonl"
  [ "$status" -eq 0 ]
  [[ "$output" != *"**"* ]]
  [[ "$output" != *'`'* ]]
}
