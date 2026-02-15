#!/usr/bin/env bash
set -euo pipefail

# Read hook input from stdin (PostToolUse provides JSON with tool_name, tool_input, tool_result)
INPUT=$(cat)

if [ "${PLAN_RENAMER_DEBUG:-0}" = "1" ]; then
  echo "[plan-renamer] Hook input: $INPUT" >&2
fi

# --- Locate plans directory ---

PLANS_DIR=""

# Check project settings for plansDirectory
for settings_file in \
  "${CLAUDE_PROJECT_DIR:-.}/.claude/settings.local.json" \
  "${CLAUDE_PROJECT_DIR:-.}/.claude/settings.json"; do
  if [ -f "$settings_file" ]; then
    dir=$(grep -o '"plansDirectory"[[:space:]]*:[[:space:]]*"[^"]*"' "$settings_file" 2>/dev/null \
      | head -1 | sed 's/.*"plansDirectory"[[:space:]]*:[[:space:]]*"//;s/"$//')
    if [ -n "$dir" ]; then
      # Resolve relative paths against project dir
      if [[ "$dir" != /* ]]; then
        dir="${CLAUDE_PROJECT_DIR:-.}/$dir"
      fi
      if [ -d "$dir" ]; then
        PLANS_DIR="$dir"
        break
      fi
    fi
  fi
done

# Default: project plans directory
if [ -z "$PLANS_DIR" ] && [ -d "${CLAUDE_PROJECT_DIR:-.}/plans" ]; then
  PLANS_DIR="${CLAUDE_PROJECT_DIR:-.}/plans"
fi

# Fallback: user-level plans directory
if [ -z "$PLANS_DIR" ] && [ -d "$HOME/.claude/plans" ]; then
  PLANS_DIR="$HOME/.claude/plans"
fi

if [ -z "$PLANS_DIR" ]; then
  if [ "${PLAN_RENAMER_DEBUG:-0}" = "1" ]; then
    echo "[plan-renamer] No plans directory found, exiting" >&2
  fi
  exit 0
fi

if [ "${PLAN_RENAMER_DEBUG:-0}" = "1" ]; then
  echo "[plan-renamer] Plans directory: $PLANS_DIR" >&2
fi

# --- Find most recently modified random-named plan file ---
# Claude Code generates names like "scalable-moseying-papert.md" (3 lowercase words joined by hyphens)

RANDOM_PATTERN='^[a-z]+-[a-z]+-[a-z]+\.md$'

CANDIDATE=""
CANDIDATE_MTIME=0

for f in "$PLANS_DIR"/*.md; do
  [ -f "$f" ] || continue
  basename=$(basename "$f")

  if echo "$basename" | grep -qE "$RANDOM_PATTERN"; then
    mtime=$(stat -c %Y "$f" 2>/dev/null || stat -f %m "$f" 2>/dev/null || echo 0)
    if [ "$mtime" -gt "$CANDIDATE_MTIME" ]; then
      CANDIDATE="$f"
      CANDIDATE_MTIME="$mtime"
    fi
  fi
done

if [ -z "$CANDIDATE" ]; then
  if [ "${PLAN_RENAMER_DEBUG:-0}" = "1" ]; then
    echo "[plan-renamer] No random-named plan files found" >&2
  fi
  exit 0
fi

OLD_BASENAME=$(basename "$CANDIDATE")

if [ "${PLAN_RENAMER_DEBUG:-0}" = "1" ]; then
  echo "[plan-renamer] Candidate: $OLD_BASENAME" >&2
fi

# --- Extract title from first line ---

FIRST_LINE=$(head -1 "$CANDIDATE")
TITLE=""

if echo "$FIRST_LINE" | grep -q '^# Plan: '; then
  TITLE=$(echo "$FIRST_LINE" | sed 's/^# Plan: //')
elif echo "$FIRST_LINE" | grep -q '^# '; then
  TITLE=$(echo "$FIRST_LINE" | sed 's/^# //')
fi

if [ -z "$TITLE" ]; then
  if [ "${PLAN_RENAMER_DEBUG:-0}" = "1" ]; then
    echo "[plan-renamer] Could not extract title from: $FIRST_LINE" >&2
  fi
  exit 0
fi

# --- Slugify title ---

SLUG=$(echo "$TITLE" \
  | tr '[:upper:]' '[:lower:]' \
  | sed 's/[^a-z0-9]/-/g' \
  | sed 's/-\{2,\}/-/g' \
  | sed 's/^-//;s/-$//' \
  | cut -c1-80)

if [ -z "$SLUG" ]; then
  exit 0
fi

NEW_BASENAME="${SLUG}.md"

# Skip if name unchanged
if [ "$OLD_BASENAME" = "$NEW_BASENAME" ]; then
  if [ "${PLAN_RENAMER_DEBUG:-0}" = "1" ]; then
    echo "[plan-renamer] Name already matches, skipping" >&2
  fi
  exit 0
fi

# --- Handle collisions ---

NEW_PATH="$PLANS_DIR/$NEW_BASENAME"
if [ -f "$NEW_PATH" ]; then
  COUNTER=2
  while [ -f "$PLANS_DIR/${SLUG}-${COUNTER}.md" ]; do
    COUNTER=$((COUNTER + 1))
  done
  NEW_BASENAME="${SLUG}-${COUNTER}.md"
  NEW_PATH="$PLANS_DIR/$NEW_BASENAME"
fi

# --- Rename ---

mv "$CANDIDATE" "$NEW_PATH"

if [ "${PLAN_RENAMER_DEBUG:-0}" = "1" ]; then
  echo "[plan-renamer] Renamed: $OLD_BASENAME -> $NEW_BASENAME" >&2
fi

# Output systemMessage so Claude knows the new path
printf '{"systemMessage":"Plan file renamed: %s → %s"}\n' "$OLD_BASENAME" "$NEW_BASENAME"
