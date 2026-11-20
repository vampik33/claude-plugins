#!/bin/bash
set -euo pipefail

# Check if Telegram credentials are set (opt-in based on config file)
# Runs on SessionStart to validate environment
# Only blocks if telegram-notifier.local.md exists with enabled: true

# Debug mode support
if [[ "${TELEGRAM_NOTIFIER_DEBUG:-}" == "1" ]]; then
  set -x
  exec 2>&1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Read hook input before sourcing (stdin must be captured first)
HOOK_INPUT=$(cat)
# shellcheck source=lib/config.sh
source "$SCRIPT_DIR/lib/config.sh"
# shellcheck source=lib/session.sh
source "$SCRIPT_DIR/lib/session.sh"

# Clean up stale session files from previous force-quit sessions
cleanup_stale_session_files

# Reading the session ID needs jq; without it, fall through to the dependency
# check below (and don't remove the shared "unknown" fallback session file)
if command -v jq &> /dev/null; then
  extract_session_id "$HOOK_INPUT"
  SESSION_FILE=$(get_session_file_path)
  rm -f "$SESSION_FILE" 2>/dev/null || true
fi

# Check if plugin is enabled (opt-in behavior with dual-scope support)
# User config: ~/.claude/telegram-notifier.local.md (global defaults)
# Project config: .claude/telegram-notifier.local.md (project overrides)
ENABLED_STATUS=$(is_plugin_enabled)

if [[ "$ENABLED_STATUS" == "unconfigured" ]]; then
  # No config at either level
  echo '{"systemMessage": "Telegram Notifier plugin: No config found. Create ~/.claude/telegram-notifier.local.md (global) or .claude/telegram-notifier.local.md (project) with enabled: true to enable notifications."}'
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
  # One line: Claude Code shows only the first line of a failing hook's stderr
  printf '{"error": "Missing dependencies: %s", "systemMessage": "Telegram Notifier plugin: Missing required dependencies (%s). Install them to use Telegram notifications:\\n\\n- jq: https://jqlang.github.io/jq/download/\\n- curl: Usually pre-installed on most systems"}\n' "$DEPS_LIST" "$DEPS_LIST" >&2
  exit 2
fi

# Check for credentials, with tracing off: debug mode's trace goes to the hook
# output and would print the bot token
{ set +x; } 2>/dev/null
MISSING_CREDS=()
[[ -z "${TELEGRAM_BOT_TOKEN:-}" ]] && MISSING_CREDS+=("TELEGRAM_BOT_TOKEN")
[[ -z "${TELEGRAM_CHAT_ID:-}" ]] && MISSING_CREDS+=("TELEGRAM_CHAT_ID")
if [[ "${TELEGRAM_NOTIFIER_DEBUG:-}" == "1" ]]; then
  set -x
fi

if [[ ${#MISSING_CREDS[@]} -gt 0 ]]; then
  CREDS_LIST=$(IFS=", "; echo "${MISSING_CREDS[*]}")
  # One line: Claude Code shows only the first line of a failing hook's stderr
  printf '{"error": "Missing Telegram credentials: %s", "systemMessage": "Telegram Notifier plugin: Missing required environment variables (%s). See README.md for setup instructions."}\n' "$CREDS_LIST" "$CREDS_LIST" >&2
  exit 2
fi

# Success message
echo '{"systemMessage": "Telegram Notifier plugin: Ready. Use /telegram to send messages."}'
exit 0
