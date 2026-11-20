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

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/html.sh
source "$SCRIPT_DIR/lib/html.sh"

TRANSCRIPT_PATH="${1:-}"

if [[ -z "$TRANSCRIPT_PATH" || ! -f "$TRANSCRIPT_PATH" ]]; then
  echo ""
  exit 0
fi

if ! command -v jq &> /dev/null; then
  echo ""
  exit 0
fi

# Tier 1: Use Claude's last assistant message directly (Stop hook field)
# The Stop hook provides last_assistant_message with Claude's final response text.
LAST_MSG="${LAST_ASSISTANT_MESSAGE:-}"

if [[ -n "$LAST_MSG" ]]; then
  # Strip markdown formatting for cleaner Telegram output:
  # - Remove bold/italic markers, heading prefixes
  # - Remove markdown table rows (separators and data rows with |)
  # - Remove backticks, insight blocks, horizontal rules
  # - Collapse multiple blank lines
  SESSION_SUMMARY=$(echo "$LAST_MSG" \
    | sed 's/`//g' \
    | awk '/^★/{skip=1} /^─+$/{skip=0; next} skip{next} 1' \
    | sed -E \
      -e 's/\*\*//g' \
      -e 's/^#{1,6} //' \
      -e '/^\|[-:| ]*\|$/d' \
      -e '/^\| /d' \
      -e '/^[[:space:]]*$/d' \
    | head -15)

  if [[ -n "$SESSION_SUMMARY" ]]; then
    # Truncate at last word boundary within 1000 chars
    if [[ ${#SESSION_SUMMARY} -gt 1000 ]]; then
      TRUNCATED="${SESSION_SUMMARY:0:1000}"
      SESSION_SUMMARY="${TRUNCATED% *}..."
    fi
    escape_html "$SESSION_SUMMARY"
    exit 0
  fi
fi

# Fall through to tool-based extraction if no summary section found

# Extract tool usage from transcript
# The transcript is JSONL with assistant messages containing tool_use content blocks;
# parse it once, keeping only each block's tool name, file_path and command
TOOL_USES=$(jq -c 'select(.type=="assistant") | .message.content[]? | select(.type=="tool_use") | {name, file_path: .input.file_path, command: .input.command}' "$TRANSCRIPT_PATH" 2>/dev/null || true)

# Print one field of each tool_use block of the named tool
# Usage: tool_field "Edit" "file_path"
tool_field() {
  jq -r --arg name "$1" --arg field "$2" 'select(.name==$name) | .[$field] // empty' <<< "$TOOL_USES" 2>/dev/null
}

# Escape each input line and join the lines with ", "
join_escaped() {
  while IFS= read -r line; do escape_html "$line"; done | tr '\n' ', ' | sed 's/,$//' | sed 's/,/, /g'
}

# Get edited files (Edit tool)
EDITED_FILES=$(tool_field Edit file_path | sort -u | \
  xargs -I {} basename {} 2>/dev/null | \
  sort -u | head -5 || echo "")

# Get created files (Write tool)
CREATED_FILES=$(tool_field Write file_path | sort -u | \
  xargs -I {} basename {} 2>/dev/null | \
  sort -u | head -5 || echo "")

# Get bash commands (extract meaningful ones, skip internal commands)
BASH_COMMANDS=$(tool_field Bash command | \
  grep -vE "^(find |ls |cat |head |tail |echo |pwd|cd )" 2>/dev/null | \
  head -5 | \
  sed 's/&&.*//' | \
  awk '{print $1, $2}' | \
  sort -u || echo "")

# Get read files count
READ_COUNT=$(tool_field Read file_path | \
  wc -l | tr -d ' ' || echo "0")

# Build summary parts
SUMMARY_PARTS=()

# Count edited files (grep -c . counts non-empty lines only)
EDIT_COUNT=$(grep -c . <<< "$EDITED_FILES" || true)
if [[ "$EDIT_COUNT" -gt 0 ]]; then
  if [[ "$EDIT_COUNT" -le 3 ]]; then
    EDIT_LIST=$(echo "$EDITED_FILES" | join_escaped)
    SUMMARY_PARTS+=("Edited: $EDIT_LIST")
  else
    SUMMARY_PARTS+=("Edited $EDIT_COUNT files")
  fi
fi

# Count created files (grep -c . counts non-empty lines only)
CREATE_COUNT=$(grep -c . <<< "$CREATED_FILES" || true)
if [[ "$CREATE_COUNT" -gt 0 ]]; then
  if [[ "$CREATE_COUNT" -le 2 ]]; then
    CREATE_LIST=$(echo "$CREATED_FILES" | join_escaped)
    SUMMARY_PARTS+=("Created: $CREATE_LIST")
  else
    SUMMARY_PARTS+=("Created $CREATE_COUNT files")
  fi
fi

# Add bash commands summary
if [[ -n "$BASH_COMMANDS" ]]; then
  # Extract first word of each command for summary
  CMD_SUMMARY=$(echo "$BASH_COMMANDS" | awk '{print $1}' | sort -u | head -3 | join_escaped)
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
