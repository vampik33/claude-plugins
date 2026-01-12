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

  local value
  value=$(echo "$frontmatter" | grep "^${field}:" | head -1 | sed 's/#.*//' | sed "s/${field}:[[:space:]]*//" | tr -d ' "'"'" || echo "")

  if [[ -z "$value" ]]; then
    echo "$default"
  else
    echo "$value"
  fi
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
