#!/bin/bash
# Shared YAML frontmatter parsing utilities for telegram plugin

# Extract YAML frontmatter from a file (content between first pair of ---)
# Usage: extract_frontmatter "/path/to/file"
# Returns: Frontmatter content (without --- delimiters)
extract_frontmatter() {
  local file="$1"
  sed -n '/^---$/,/^---$/{ /^---$/d; p; }' "$file" 2>/dev/null || echo ""
}

# Parse a field from YAML frontmatter
# Usage: parse_yaml_field "field_name" "default_value" "$frontmatter"
# Returns: Field value or default if not found
# Handles: comments, quotes, whitespace
parse_yaml_field() {
  local field="$1"
  local default="$2"
  local frontmatter="$3"

  # Extract line matching field, strip comment, extract value, remove quotes/whitespace
  local value
  value=$(echo "$frontmatter" \
    | grep "^${field}:" \
    | head -1 \
    | sed -e 's/#.*//' -e "s/${field}:[[:space:]]*//" \
    | tr -d ' "'"'" \
    || echo "")

  echo "${value:-$default}"
}

# Extract markdown body (content after second ---)
# Usage: extract_body "/path/to/file"
# Returns: Body content with collapsed whitespace
extract_body() {
  local file="$1"
  local in_body=0
  local dash_count=0
  local result=""

  while IFS= read -r line || [[ -n "$line" ]]; do
    if [[ "$line" == "---" ]]; then
      ((dash_count++))
      continue
    fi
    if [[ $dash_count -ge 2 ]]; then
      if [[ -z "$result" && -z "${line// /}" ]]; then
        continue
      fi
      if [[ -n "$result" ]]; then
        result="$result "
      fi
      result="$result$line"
    fi
  done < "$file"

  echo "$result" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//;s/[[:space:]]\{2,\}/ /g'
}

# ============================================================================
# Dual-scope config resolution (user-level + project-level)
# Similar to CLAUDE.md behavior: user as default, project overrides
# ============================================================================

# Get user-level config path
get_user_config_path() {
  echo "${HOME}/.claude/telegram.local.md"
}

# Get project-level config path
get_project_config_path() {
  echo "${CLAUDE_PROJECT_DIR:-.}/.claude/telegram.local.md"
}

# Resolve config value with dual-scope support
# Priority: project > user > default
# Usage: resolve_config_field "field_name" "default_value"
resolve_config_field() {
  local field="$1"
  local default="$2"

  local user_config
  local project_config
  user_config=$(get_user_config_path)
  project_config=$(get_project_config_path)

  # Check project config first (highest priority)
  if [[ -f "$project_config" ]]; then
    local project_fm
    project_fm=$(extract_frontmatter "$project_config")
    local project_value
    project_value=$(parse_yaml_field "$field" "" "$project_fm")
    if [[ -n "$project_value" ]]; then
      echo "$project_value"
      return
    fi
  fi

  # Check user config (fallback)
  if [[ -f "$user_config" ]]; then
    local user_fm
    user_fm=$(extract_frontmatter "$user_config")
    local user_value
    user_value=$(parse_yaml_field "$field" "" "$user_fm")
    if [[ -n "$user_value" ]]; then
      echo "$user_value"
      return
    fi
  fi

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
  local project_config
  local user_config
  project_config=$(get_project_config_path)
  user_config=$(get_user_config_path)

  # Project body takes full precedence
  if [[ -f "$project_config" ]]; then
    local body
    body=$(extract_body "$project_config" | head -c 500)
    if [[ -n "$body" ]]; then
      echo "$body"
      return
    fi
  fi

  # Fall back to user body
  if [[ -f "$user_config" ]]; then
    extract_body "$user_config" | head -c 500
  fi
}
