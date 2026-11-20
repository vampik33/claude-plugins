#!/bin/bash
# Configuration resolution with dual-scope support (user-level + project-level)
# Similar to CLAUDE.md behavior: user as default, project overrides

LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=yaml.sh
source "$LIB_DIR/yaml.sh"

# Get user-level config path
get_user_config_path() {
  echo "${HOME}/.claude/telegram-notifier.local.md"
}

# Get project-level config path
get_project_config_path() {
  echo "${CLAUDE_PROJECT_DIR:-.}/.claude/telegram-notifier.local.md"
}

# Resolve config value with dual-scope support
# Priority: project > user > default
# Usage: resolve_config_field "field_name" "default_value"
resolve_config_field() {
  local field="$1"
  local default="$2"

  # Check project config first (highest priority), then user config (fallback)
  local config
  local value
  for config in "$(get_project_config_path)" "$(get_user_config_path)"; do
    [[ -f "$config" ]] || continue
    value=$(parse_yaml_field "$field" "" "$(extract_frontmatter "$config")")
    if [[ -n "$value" ]]; then
      echo "$value"
      return
    fi
  done

  # Return default
  echo "$default"
}

# Check if plugin is enabled
# Returns: "true", "false", or "unconfigured"
# Uses resolve_config_field pattern: project > user > default
is_plugin_enabled() {
  local user_config
  local project_config
  user_config=$(get_user_config_path)
  project_config=$(get_project_config_path)

  # No config at either level = unconfigured
  if [[ ! -f "$project_config" && ! -f "$user_config" ]]; then
    echo "unconfigured"
    return
  fi

  # Use resolve_config_field for proper fallback chain
  # If project has enabled -> use it
  # Else if user has enabled -> use it
  # Else default to "true" (config exists but no explicit enabled field)
  resolve_config_field "enabled" "true"
}

# Get notification body (project takes full precedence)
# Usage: get_notification_body
get_notification_body() {
  # Project body takes full precedence; fall back to user body
  local config
  local body
  for config in "$(get_project_config_path)" "$(get_user_config_path)"; do
    [[ -f "$config" ]] || continue
    body=$(extract_body "$config" | head -c 500)
    if [[ -n "$body" ]]; then
      echo "$body"
      return
    fi
  done
}
