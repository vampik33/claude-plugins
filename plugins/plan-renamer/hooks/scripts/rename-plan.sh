#!/usr/bin/env bash
set -euo pipefail

# --- Helpers ---

debug() {
  if [ "${PLAN_RENAMER_DEBUG:-0}" = "1" ]; then
    echo "[plan-renamer] $*" >&2
  fi
}

# Check whether a directory exists and contains at least one .md file.
has_md_files() {
  local dir="$1"
  [ -d "$dir" ] || return 1
  for f in "$dir"/*.md; do
    [ -f "$f" ] && return 0
  done
  return 1
}

# Read plansDirectory from a JSON settings file.
# $1 = settings file path
# $2 = base directory for resolving relative paths
# Prints the resolved directory path if found and valid, or nothing.
read_plans_dir_from_settings() {
  local file="$1"
  local base_dir="$2"
  [ -f "$file" ] || return 0

  local dir
  dir=$(grep -o '"plansDirectory"[[:space:]]*:[[:space:]]*"[^"]*"' "$file" 2>/dev/null \
    | head -1 | sed 's/.*"plansDirectory"[[:space:]]*:[[:space:]]*"//;s/"$//')
  [ -n "$dir" ] || return 0

  # Resolve relative paths against the provided base directory
  if [[ "$dir" != /* ]]; then
    dir="${base_dir}/$dir"
  fi

  [ -d "$dir" ] && echo "$dir"
}

# Locate the plans directory.
# Checks: project settings > user settings > project ./plans > user ~/.claude/plans
# Only returns directories that actually contain .md files.
find_plans_dir() {
  local dir settings_file base_dir

  # 1. Project-level settings (resolve relative paths against project dir)
  for settings_file in \
    "${CLAUDE_PROJECT_DIR:-.}/.claude/settings.local.json" \
    "${CLAUDE_PROJECT_DIR:-.}/.claude/settings.json"; do
    dir=$(read_plans_dir_from_settings "$settings_file" "${CLAUDE_PROJECT_DIR:-.}")
    if [ -n "$dir" ] && has_md_files "$dir"; then
      echo "$dir"
      return
    fi
  done

  # 2. User-level settings (resolve relative paths against ~/.claude)
  for settings_file in \
    "$HOME/.claude/settings.local.json" \
    "$HOME/.claude/settings.json"; do
    dir=$(read_plans_dir_from_settings "$settings_file" "$HOME/.claude")
    if [ -n "$dir" ] && has_md_files "$dir"; then
      echo "$dir"
      return
    fi
  done

  # 3. Fallback: project plans dir, then user plans dir (only if they have files)
  if has_md_files "${CLAUDE_PROJECT_DIR:-.}/plans"; then
    echo "${CLAUDE_PROJECT_DIR:-.}/plans"
  elif has_md_files "$HOME/.claude/plans"; then
    echo "$HOME/.claude/plans"
  fi
}

# Extract title from the first heading line of a plan file.
# Supports "# Plan: <title>" and "# <title>" formats.
extract_plan_title() {
  local first_line
  first_line=$(head -1 "$1")
  sed -n 's/^# \(Plan: \)\{0,1\}//p' <<< "$first_line"
}

# Convert a title string to a URL-safe slug (lowercase, max 80 chars).
slugify() {
  echo "$1" \
    | tr '[:upper:]' '[:lower:]' \
    | sed 's/[^a-z0-9]/-/g; s/-\{2,\}/-/g; s/^-//; s/-$//' \
    | cut -c1-80
}

# --- Main ---

# Consume hook input from stdin (PostToolUse provides JSON context)
INPUT=$(cat)
debug "Hook input: $INPUT"

PLANS_DIR=$(find_plans_dir)
if [ -z "$PLANS_DIR" ]; then
  debug "No plans directory found, exiting"
  exit 0
fi
debug "Plans directory: $PLANS_DIR"

# Find the most recently modified random-named plan file.
# Claude Code generates names like "scalable-moseying-papert.md" (3 lowercase words joined by hyphens).
CANDIDATE=""
CANDIDATE_MTIME=0

for f in "$PLANS_DIR"/*.md; do
  [ -f "$f" ] || continue
  fname=$(basename "$f")

  if echo "$fname" | grep -qE '^[a-z]+-[a-z]+-[a-z]+\.md$'; then
    mtime=$(stat -c %Y "$f" 2>/dev/null || stat -f %m "$f" 2>/dev/null || echo 0)
    if [ "$mtime" -gt "$CANDIDATE_MTIME" ]; then
      CANDIDATE="$f"
      CANDIDATE_MTIME="$mtime"
    fi
  fi
done

if [ -z "$CANDIDATE" ]; then
  debug "No random-named plan files found"
  exit 0
fi

OLD_BASENAME=$(basename "$CANDIDATE")
debug "Candidate: $OLD_BASENAME"

# Extract title and slugify
TITLE=$(extract_plan_title "$CANDIDATE")
if [ -z "$TITLE" ]; then
  debug "Could not extract title from: $(head -1 "$CANDIDATE")"
  exit 0
fi

SLUG=$(slugify "$TITLE")
if [ -z "$SLUG" ]; then
  exit 0
fi

NEW_BASENAME="${SLUG}.md"

if [ "$OLD_BASENAME" = "$NEW_BASENAME" ]; then
  debug "Name already matches, skipping"
  exit 0
fi

# Handle collisions by appending -2, -3, etc.
NEW_PATH="$PLANS_DIR/$NEW_BASENAME"
if [ -f "$NEW_PATH" ]; then
  COUNTER=2
  while [ -f "$PLANS_DIR/${SLUG}-${COUNTER}.md" ]; do
    COUNTER=$((COUNTER + 1))
  done
  NEW_BASENAME="${SLUG}-${COUNTER}.md"
  NEW_PATH="$PLANS_DIR/$NEW_BASENAME"
fi

mv "$CANDIDATE" "$NEW_PATH"
debug "Renamed: $OLD_BASENAME -> $NEW_BASENAME"

printf '{"systemMessage":"Plan file renamed: %s → %s"}\n' "$OLD_BASENAME" "$NEW_BASENAME"
