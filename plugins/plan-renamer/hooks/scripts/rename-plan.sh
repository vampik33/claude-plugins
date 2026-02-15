#!/usr/bin/env bash
set -euo pipefail

# --- Helpers ---

debug() {
  if [ "${PLAN_RENAMER_DEBUG:-0}" = "1" ]; then
    echo "[plan-renamer] $*" >&2
  fi
}

# Output the PermissionRequest "allow" decision and exit.
# PermissionRequest hooks must return hookSpecificOutput with a decision,
# not systemMessage (which is for PostToolUse hooks).
allow_and_exit() {
  printf '{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"allow"}}}\n'
  exit 0
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
  if [ ! -f "$file" ]; then
    debug "  settings file not found: $file"
    return 0
  fi
  debug "  reading settings file: $file"

  local dir
  dir=$(grep -o '"plansDirectory"[[:space:]]*:[[:space:]]*"[^"]*"' "$file" 2>/dev/null \
    | head -1 | sed 's/.*"plansDirectory"[[:space:]]*:[[:space:]]*"//;s/"$//')
  if [ -z "$dir" ]; then
    debug "  no plansDirectory key found in: $file"
    return 0
  fi
  debug "  raw plansDirectory value: '$dir'"

  # Resolve relative paths against the provided base directory
  if [[ "$dir" != /* ]]; then
    debug "  resolving relative path against: $base_dir"
    dir="${base_dir}/$dir"
  fi
  debug "  resolved path: $dir"

  if [ -d "$dir" ]; then
    debug "  directory exists: $dir"
    echo "$dir"
  else
    debug "  directory does not exist: $dir"
  fi
}

# Locate the plans directory.
# Checks: project settings > user settings > project ./plans > user ~/.claude/plans
# Only returns directories that actually contain .md files.
find_plans_dir() {
  local dir settings_file base_dir

  debug "Searching for plans directory..."

  # 1. Project-level settings (resolve relative paths against project dir)
  debug "Step 1: Checking project-level settings"
  for settings_file in \
    "${CLAUDE_PROJECT_DIR:-.}/.claude/settings.local.json" \
    "${CLAUDE_PROJECT_DIR:-.}/.claude/settings.json"; do
    dir=$(read_plans_dir_from_settings "$settings_file" "${CLAUDE_PROJECT_DIR:-.}")
    if [ -n "$dir" ]; then
      if has_md_files "$dir"; then
        debug "  -> found plans dir with .md files: $dir"
        echo "$dir"
        return
      else
        debug "  directory has no .md files: $dir"
      fi
    fi
  done

  # 2. User-level settings (resolve relative paths against ~/.claude)
  debug "Step 2: Checking user-level settings"
  for settings_file in \
    "$HOME/.claude/settings.local.json" \
    "$HOME/.claude/settings.json"; do
    dir=$(read_plans_dir_from_settings "$settings_file" "$HOME/.claude")
    if [ -n "$dir" ]; then
      if has_md_files "$dir"; then
        debug "  -> found plans dir with .md files: $dir"
        echo "$dir"
        return
      else
        debug "  directory has no .md files: $dir"
      fi
    fi
  done

  # 3. Fallback: project plans dir, then user plans dir (only if they have files)
  debug "Step 3: Checking fallback directories"
  if has_md_files "${CLAUDE_PROJECT_DIR:-.}/plans"; then
    debug "  -> using project plans dir: ${CLAUDE_PROJECT_DIR:-.}/plans"
    echo "${CLAUDE_PROJECT_DIR:-.}/plans"
  elif has_md_files "$HOME/.claude/plans"; then
    debug "  -> using user plans dir: $HOME/.claude/plans"
    echo "$HOME/.claude/plans"
  else
    debug "  no fallback directory found with .md files"
    debug "  checked: ${CLAUDE_PROJECT_DIR:-.}/plans"
    debug "  checked: $HOME/.claude/plans"
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
    | sed 's/[^a-z0-9]/-/g; s/-\{2,\}/-/g; s/^-//; s/-$//'
}

# --- Main ---

# Consume hook input from stdin (PermissionRequest provides JSON context)
INPUT=$(cat)
debug "=== plan-renamer hook start ==="
debug "Hook input: $INPUT"
debug "CLAUDE_PROJECT_DIR=${CLAUDE_PROJECT_DIR:-<unset>}"
debug "CLAUDE_PLUGIN_ROOT=${CLAUDE_PLUGIN_ROOT:-<unset>}"
debug "HOME=$HOME"
debug "PWD=$PWD"

PLANS_DIR=$(find_plans_dir)
if [ -z "$PLANS_DIR" ]; then
  debug "No plans directory found, exiting"
  allow_and_exit
fi
debug "Plans directory: $PLANS_DIR"

# Find the most recently modified random-named plan file.
# Claude Code generates names like "scalable-moseying-papert.md" (3 lowercase words joined by hyphens).
CANDIDATE=""
CANDIDATE_MTIME=0

debug "Scanning for random-named plan files in: $PLANS_DIR"
for f in "$PLANS_DIR"/*.md; do
  [ -f "$f" ] || continue
  fname=$(basename "$f")

  if echo "$fname" | grep -qE '^[a-z]+-[a-z]+-[a-z]+\.md$'; then
    mtime=$(stat -c %Y "$f" 2>/dev/null || stat -f %m "$f" 2>/dev/null || echo 0)
    debug "  match: $fname (mtime=$mtime)"
    if [ "$mtime" -gt "$CANDIDATE_MTIME" ]; then
      CANDIDATE="$f"
      CANDIDATE_MTIME="$mtime"
    fi
  else
    debug "  skip (not random-named): $fname"
  fi
done

if [ -z "$CANDIDATE" ]; then
  debug "No random-named plan files found"
  allow_and_exit
fi

OLD_BASENAME=$(basename "$CANDIDATE")
debug "Candidate: $OLD_BASENAME"

# Extract title and slugify
TITLE=$(extract_plan_title "$CANDIDATE")
if [ -z "$TITLE" ]; then
  debug "Could not extract title from: $(head -1 "$CANDIDATE")"
  allow_and_exit
fi

debug "Extracted title: '$TITLE'"
SLUG=$(slugify "$TITLE")
debug "Slugified: '$SLUG'"
if [ -z "$SLUG" ]; then
  debug "Slug is empty after slugify, skipping"
  allow_and_exit
fi

NEW_BASENAME="${SLUG}.md"
debug "Proposed new name: $NEW_BASENAME"

if [ "$OLD_BASENAME" = "$NEW_BASENAME" ]; then
  debug "Name already matches, skipping"
  allow_and_exit
fi

# Handle collisions by appending -2, -3, etc.
NEW_PATH="$PLANS_DIR/$NEW_BASENAME"
if [ -f "$NEW_PATH" ]; then
  debug "Collision detected: $NEW_BASENAME already exists"
  COUNTER=2
  while [ -f "$PLANS_DIR/${SLUG}-${COUNTER}.md" ]; do
    debug "  also exists: ${SLUG}-${COUNTER}.md"
    COUNTER=$((COUNTER + 1))
  done
  NEW_BASENAME="${SLUG}-${COUNTER}.md"
  NEW_PATH="$PLANS_DIR/$NEW_BASENAME"
  debug "Resolved collision: $NEW_BASENAME"
fi

mv "$CANDIDATE" "$NEW_PATH"
debug "Renamed: $OLD_BASENAME -> $NEW_BASENAME"
debug "=== plan-renamer hook end ==="

allow_and_exit
