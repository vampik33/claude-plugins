#!/bin/bash
set -euo pipefail

# Summarize a Claude Code transcript for notifications
# Usage: summarize-transcript.sh <transcript_path>
# Returns: Brief summary of actions taken
#
# Design limits (to keep notifications concise):
# - Extraction: Limit to 5 unique items per category (head -5)
# - Display: Edit files show up to 3 names, otherwise count
# - Display: Created files show up to 2 names, otherwise count
# - Display: Bash commands show up to 3 command types

TRANSCRIPT_PATH="${1:-}"

if [[ -z "$TRANSCRIPT_PATH" || ! -f "$TRANSCRIPT_PATH" ]]; then
  echo ""
  exit 0
fi

if ! command -v jq &> /dev/null; then
  echo ""
  exit 0
fi

# Try to extract Claude's session summary (most recent one)
# The transcript contains type="summary" entries with natural language descriptions
SESSION_SUMMARY=$(jq -r 'select(.type=="summary") | .summary' "$TRANSCRIPT_PATH" 2>/dev/null | tail -1)

if [[ -n "$SESSION_SUMMARY" ]]; then
  echo "$SESSION_SUMMARY"
  exit 0
fi

# Fall through to tool-based extraction if no summary found

# Extract tool usage from transcript
# The transcript is JSONL with assistant messages containing tool_use content blocks

# Get edited files (Edit tool)
EDITED_FILES=$(jq -r 'select(.type=="assistant") | .message.content[]? | select(.type=="tool_use" and .name=="Edit") | .input.file_path // empty' "$TRANSCRIPT_PATH" 2>/dev/null | \
  xargs -I {} basename {} 2>/dev/null | \
  sort -u | head -5 || echo "")

# Get created files (Write tool)
CREATED_FILES=$(jq -r 'select(.type=="assistant") | .message.content[]? | select(.type=="tool_use" and .name=="Write") | .input.file_path // empty' "$TRANSCRIPT_PATH" 2>/dev/null | \
  grep -v '^$' | \
  xargs -I {} basename {} 2>/dev/null | \
  sort -u | head -5 || echo "")

# Get bash commands (extract meaningful ones, skip internal commands)
BASH_COMMANDS=$(jq -r 'select(.type=="assistant") | .message.content[]? | select(.type=="tool_use" and .name=="Bash") | .input.command // empty' "$TRANSCRIPT_PATH" 2>/dev/null | \
  grep -vE "^(find |ls |cat |head |tail |echo |pwd|cd )" 2>/dev/null | \
  head -5 | \
  sed 's/&&.*//' | \
  awk '{print $1, $2}' | \
  sort -u || echo "")

# Get read files count
READ_COUNT=$(jq -r 'select(.type=="assistant") | .message.content[]? | select(.type=="tool_use" and .name=="Read") | .input.file_path // empty' "$TRANSCRIPT_PATH" 2>/dev/null | \
  wc -l | tr -d ' ' || echo "0")

# Build summary parts
SUMMARY_PARTS=()

# Count edited files (grep -c . counts non-empty lines only)
if [[ -n "$EDITED_FILES" ]]; then
  EDIT_COUNT=$(echo "$EDITED_FILES" | grep -c . || echo 0)
else
  EDIT_COUNT=0
fi
if [[ "$EDIT_COUNT" -gt 0 ]]; then
  if [[ "$EDIT_COUNT" -le 3 ]]; then
    EDIT_LIST=$(echo "$EDITED_FILES" | tr '\n' ', ' | sed 's/,$//' | sed 's/,/, /g')
    SUMMARY_PARTS+=("Edited: $EDIT_LIST")
  else
    SUMMARY_PARTS+=("Edited $EDIT_COUNT files")
  fi
fi

# Count created files (grep -c . counts non-empty lines only)
if [[ -n "$CREATED_FILES" ]]; then
  CREATE_COUNT=$(echo "$CREATED_FILES" | grep -c . || echo 0)
else
  CREATE_COUNT=0
fi
if [[ "$CREATE_COUNT" -gt 0 ]]; then
  if [[ "$CREATE_COUNT" -le 2 ]]; then
    CREATE_LIST=$(echo "$CREATED_FILES" | tr '\n' ', ' | sed 's/,$//' | sed 's/,/, /g')
    SUMMARY_PARTS+=("Created: $CREATE_LIST")
  else
    SUMMARY_PARTS+=("Created $CREATE_COUNT files")
  fi
fi

# Add bash commands summary (grep -c . counts non-empty lines only)
if [[ -n "$BASH_COMMANDS" ]]; then
  CMD_COUNT=$(echo "$BASH_COMMANDS" | grep -c . || echo 0)
else
  CMD_COUNT=0
fi
if [[ "$CMD_COUNT" -gt 0 ]]; then
  # Extract first word of each command for summary
  CMD_SUMMARY=$(echo "$BASH_COMMANDS" | awk '{print $1}' | sort -u | head -3 | tr '\n' ', ' | sed 's/,$//' | sed 's/,/, /g')
  if [[ -n "$CMD_SUMMARY" ]]; then
    SUMMARY_PARTS+=("Ran: $CMD_SUMMARY")
  fi
fi

# If nothing significant, mention exploration
if [[ ${#SUMMARY_PARTS[@]} -eq 0 ]]; then
  if [[ "$READ_COUNT" -gt 3 ]]; then
    SUMMARY_PARTS+=("Explored $READ_COUNT files")
  fi
fi

# Join parts with bullet points
if [[ ${#SUMMARY_PARTS[@]} -gt 0 ]]; then
  printf '%s\n' "${SUMMARY_PARTS[@]}" | sed 's/^/• /'
fi
