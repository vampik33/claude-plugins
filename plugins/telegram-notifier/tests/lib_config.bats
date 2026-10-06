#!/usr/bin/env bats

# Tests for lib/config.sh — config resolution, enabled status, notification body

setup() {
  PLUGIN_DIR="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)"

  # Isolate config from real system
  export HOME="$BATS_TEST_TMPDIR/home"
  export CLAUDE_PROJECT_DIR="$BATS_TEST_TMPDIR/project"
  mkdir -p "$HOME/.claude"
  mkdir -p "$CLAUDE_PROJECT_DIR/.claude"

  source "$PLUGIN_DIR/hooks/scripts/lib/config.sh"
}

# --- resolve_config_field ---

@test "resolve_config_field: returns default when no configs exist" {
  rm -rf "$HOME/.claude/telegram-notifier.local.md"
  rm -rf "$CLAUDE_PROJECT_DIR/.claude/telegram-notifier.local.md"
  run resolve_config_field "enabled" "default_val"
  [ "$output" = "default_val" ]
}

@test "resolve_config_field: reads from user config" {
  cat > "$HOME/.claude/telegram-notifier.local.md" <<'EOF'
---
session_threshold_minutes: 15
---
EOF
  rm -f "$CLAUDE_PROJECT_DIR/.claude/telegram-notifier.local.md"
  run resolve_config_field "session_threshold_minutes" "10"
  [ "$output" = "15" ]
}

@test "resolve_config_field: project config overrides user config" {
  cat > "$HOME/.claude/telegram-notifier.local.md" <<'EOF'
---
session_threshold_minutes: 15
---
EOF
  cat > "$CLAUDE_PROJECT_DIR/.claude/telegram-notifier.local.md" <<'EOF'
---
session_threshold_minutes: 5
---
EOF
  run resolve_config_field "session_threshold_minutes" "10"
  [ "$output" = "5" ]
}

@test "resolve_config_field: falls back to user when field missing in project" {
  cat > "$HOME/.claude/telegram-notifier.local.md" <<'EOF'
---
session_threshold_minutes: 20
---
EOF
  cat > "$CLAUDE_PROJECT_DIR/.claude/telegram-notifier.local.md" <<'EOF'
---
enabled: true
---
EOF
  run resolve_config_field "session_threshold_minutes" "10"
  [ "$output" = "20" ]
}

# --- is_plugin_enabled ---

@test "is_plugin_enabled: returns unconfigured when no config files" {
  rm -f "$HOME/.claude/telegram-notifier.local.md"
  rm -f "$CLAUDE_PROJECT_DIR/.claude/telegram-notifier.local.md"
  run is_plugin_enabled
  [ "$output" = "unconfigured" ]
}

@test "is_plugin_enabled: returns true when user config exists with enabled: true" {
  cat > "$HOME/.claude/telegram-notifier.local.md" <<'EOF'
---
enabled: true
---
EOF
  rm -f "$CLAUDE_PROJECT_DIR/.claude/telegram-notifier.local.md"
  run is_plugin_enabled
  [ "$output" = "true" ]
}

@test "is_plugin_enabled: returns false when explicitly disabled" {
  cat > "$HOME/.claude/telegram-notifier.local.md" <<'EOF'
---
enabled: false
---
EOF
  rm -f "$CLAUDE_PROJECT_DIR/.claude/telegram-notifier.local.md"
  run is_plugin_enabled
  [ "$output" = "false" ]
}

@test "is_plugin_enabled: defaults to true when config exists but no enabled field" {
  cat > "$HOME/.claude/telegram-notifier.local.md" <<'EOF'
---
session_threshold_minutes: 10
---
EOF
  rm -f "$CLAUDE_PROJECT_DIR/.claude/telegram-notifier.local.md"
  run is_plugin_enabled
  [ "$output" = "true" ]
}

@test "is_plugin_enabled: project disabled overrides user enabled" {
  cat > "$HOME/.claude/telegram-notifier.local.md" <<'EOF'
---
enabled: true
---
EOF
  cat > "$CLAUDE_PROJECT_DIR/.claude/telegram-notifier.local.md" <<'EOF'
---
enabled: false
---
EOF
  run is_plugin_enabled
  [ "$output" = "false" ]
}

# --- get_notification_body ---

@test "get_notification_body: returns empty when no configs" {
  rm -f "$HOME/.claude/telegram-notifier.local.md"
  rm -f "$CLAUDE_PROJECT_DIR/.claude/telegram-notifier.local.md"
  run get_notification_body
  [ "$output" = "" ]
}

@test "get_notification_body: returns user body" {
  cat > "$HOME/.claude/telegram-notifier.local.md" <<'EOF'
---
enabled: true
---
Task completed in global
EOF
  rm -f "$CLAUDE_PROJECT_DIR/.claude/telegram-notifier.local.md"
  run get_notification_body
  [ "$output" = "Task completed in global" ]
}

@test "get_notification_body: project body overrides user body" {
  cat > "$HOME/.claude/telegram-notifier.local.md" <<'EOF'
---
enabled: true
---
Global message
EOF
  cat > "$CLAUDE_PROJECT_DIR/.claude/telegram-notifier.local.md" <<'EOF'
---
enabled: true
---
Project-specific message
EOF
  run get_notification_body
  [ "$output" = "Project-specific message" ]
}

@test "get_notification_body: falls back to user body when project has no body" {
  cat > "$HOME/.claude/telegram-notifier.local.md" <<'EOF'
---
enabled: true
---
Fallback message
EOF
  cat > "$CLAUDE_PROJECT_DIR/.claude/telegram-notifier.local.md" <<'EOF'
---
session_threshold_minutes: 5
---
EOF
  run get_notification_body
  [ "$output" = "Fallback message" ]
}

@test "get_notification_body: truncates body to 500 chars" {
  local long_body
  long_body=$(head -c 600 /dev/zero | tr '\0' 'A')
  cat > "$CLAUDE_PROJECT_DIR/.claude/telegram-notifier.local.md" <<EOF
---
enabled: true
---
$long_body
EOF
  rm -f "$HOME/.claude/telegram-notifier.local.md"
  run get_notification_body
  [ ${#output} -le 500 ]
}
