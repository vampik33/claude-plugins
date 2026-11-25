#!/bin/bash
set -euo pipefail

# Summarize a Claude Code transcript for notifications
# Usage: summarize-transcript.sh <transcript_path>
# Returns: Brief summary of actions taken: counts and names only (file base names,
# the first word of commands), never Claude's answer text or file contents
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

# Extract tool usage from transcript
# The transcript is JSONL with assistant messages containing tool_use content blocks.
# One streaming jq pass keeps only what the summary shows, never whole commands:
# - "E:"/"W:" the distinct base names of Edit/Write paths, taken in jq so quotes
#   and backslashes in a name stay literal
# - "B:" the first word of the first 5 Bash command lines that aren't internal
#   commands (find, ls, cat, …), cut at "&&" and split on blanks as awk does
# - "R:" the number of Read paths
# A line that isn't valid JSON is skipped rather than ending the pass.
TOOLS=$(jq -Rnr '
  def lines: if . == "" then [""] else split("\n") end;
  def base: if test("^/+$") then "/" else sub("/+$"; "") | sub(".*/"; "") end;
  def paths: .input.file_path // empty | tostring | lines[];
  def names: [paths | base | select(. != "")];
  reduce (inputs | try fromjson catch empty
      | select(type == "object" and .type == "assistant")
      | .message.content[]? | select(type == "object" and .type == "tool_use")) as $t
    ({e: {}, w: {}, b: [], r: 0};
     . as $s | try (
       if $t.name == "Edit" then reduce ($t | names[]) as $f (.; .e[$f] = 1)
       elif $t.name == "Write" then reduce ($t | names[]) as $f (.; .w[$f] = 1)
       elif $t.name == "Read" then .r += ([$t | paths] | length)
       elif $t.name == "Bash" and (.b | length) < 5 then
         .b += [limit(5 - (.b | length);
           $t.input.command // empty | tostring | lines[]
           | select(test("^(find |ls |cat |head |tail |echo |pwd|cd )") | not)
           | sub("&&.*"; "") | capture("^[ \t]*(?<w>[^ \t]*)").w)]
       else . end
     ) catch $s)
  | (.e | keys_unsorted[] | "E:" + .), (.w | keys_unsorted[] | "W:" + .),
    (.b[] | "B:" + .), "R:\(.r)"
' < "$TRANSCRIPT_PATH" 2>/dev/null || true)

# Print the entries of one kind, without their tag
# Usage: tool_entries E
tool_entries() {
  sed -n "s/^$1://p" <<< "$TOOLS"
}

# Escape each input line and join the lines with ", "
join_escaped() {
  while IFS= read -r line; do escape_html "$line"; done | tr '\n' ', ' | sed 's/,$//' | sed 's/,/, /g'
}

# Get edited files (Edit tool)
EDITED_FILES=$(tool_entries E | sort -u | head -5 || echo "")

# Get created files (Write tool)
CREATED_FILES=$(tool_entries W | sort -u | head -5 || echo "")

# Get read files count
READ_COUNT=$(tool_entries R)

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

# Add bash commands summary (jq already kept only first words of meaningful commands)
CMD_SUMMARY=$(tool_entries B | sort -u | head -3 | join_escaped)
if [[ -n "$CMD_SUMMARY" ]]; then
  SUMMARY_PARTS+=("Ran: $CMD_SUMMARY")
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
