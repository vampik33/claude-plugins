#!/bin/bash
set -euo pipefail

# Summarize a Claude Code transcript for notifications
# Usage: summarize-transcript.sh <transcript_path>
# Returns: Brief summary of actions taken: counts and names only (file base names,
# the program name of commands), never Claude's answer text or file contents
#
# Extraction limits are described above the jq pass; display: up to 3 edited and
# 2 created file names, otherwise the count ("6+" at the cap), up to 3 program names

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

# Distinct file names kept per category; a count at the cap shows as "6+"
CAP=6

# Extract tool usage from transcript
# The transcript is JSONL with assistant messages containing tool_use content blocks.
# One streaming jq pass keeps only what the summary shows, never whole commands:
# - "E:"/"W:" the distinct base names of Edit/Write paths, taken in jq so quotes
#   and backslashes in a name stay literal; at most $CAP per category, each cut to
#   64 characters
# - "B:" the program names of the first 5 Bash commands that have one, from a
#   command's first line only (never heredoc or continuation lines), the word ending
#   at a space or one of ; | & < > (a number before < or > is a file descriptor, so
#   2>f names nothing): leading NAME=value words are skipped when their value is
#   plain, '…' or "…" (a value with $, `, (, ), an unquoted \ or a shell operator
#   ; | & < > is not skipped, so the command word keeps the "=" and is dropped: no
#   word inside a value is ever taken as the program), the word must be a plain name or path
#   before a path is cut to its base name (so K=$X/name never yields "name"), internal
#   commands (find, ls, cat, …) are dropped, and the word is kept only when shaped
#   like a program name. What bounds the output is the first-line rule and the
#   32-character cap; the shape check only keeps the list readable.
# - "R:" the number of Read paths
# Lines without "tool_use" are skipped before parsing (most of a long transcript):
# sed passes the others on, each after an RS byte, so jq --seq parses each line as
# its own JSON text and a line that isn't valid JSON is skipped rather than ending
# the pass. Not jq -R: it splits a multibyte character that crosses a 4 KB boundary
# of its input into two U+FFFD (jq 1.6 to 1.8.1)
RS=$'\x1e'
TOOLS=$(LC_ALL=C sed -n "/tool_use/s/^/$RS/p" "$TRANSCRIPT_PATH" | jq -nr --seq --argjson cap "$CAP" '
  def lines: if . == "" then [""] else split("\n") end;
  def base: if test("^/+$") then "/" else sub("/+$"; "") | sub(".*/"; "") end;
  def paths: .input.file_path // empty | tostring | lines[];
  def names: [paths | base | select(. != "") | .[:64]];
  def keep($f): if .[$f] or length < $cap then .[$f] = 1 else . end;
  def program: (split("\n")[0] // "")
    | capture("^[ \t]*(?:[A-Za-z_][A-Za-z0-9_]*=(?:[^ \t\"\u0027\\\\$`();|&<>]|\"(?:[^\"\\\\$`]|\\\\.)*\"|\u0027[^\u0027]*\u0027)*[ \t]+)*(?<w>[^ \t;|&<>]*)(?<fd>[<>]?)")
    | select(.fd == "" or (.w | test("^[0-9]+$") | not)).w # 2>f: a number before < or > is a file descriptor
    | select(test("^[A-Za-z0-9._/+-]+$")) # before the cut: K=$X/name must not become name
    | sub(".*/"; "")
    | select(test("^[A-Za-z0-9][A-Za-z0-9._+-]{0,31}$"))
    | select(IN("find", "ls", "cat", "head", "tail", "echo", "pwd", "cd") | not);
  # Each line as JSON; input raises an error for one that is not, and the next
  # input starts at the next RS (end of input: "break" in jq 1.7+, "No more inputs" before)
  def eof: . == "break" or . == "No more inputs";
  def rows: def r: (try input catch (if eof then error else empty end)), r;
    try r catch (if eof then empty else error end);
  reduce (rows
      | select(type == "object" and .type == "assistant")
      | .message.content[]? | select(type == "object" and .type == "tool_use")) as $t
    ({e: {}, w: {}, b: [], r: 0};
     . as $s | try (
       if $t.name == "Edit" then reduce ($t | names[]) as $f (.; .e |= keep($f))
       elif $t.name == "Write" then reduce ($t | names[]) as $f (.; .w |= keep($f))
       elif $t.name == "Read" then .r += ([$t | paths] | length)
       elif $t.name == "Bash" and (.b | length) < 5 then
         .b += [$t.input.command // empty | tostring | program]
       else . end
     ) catch $s)
  | (.e | keys_unsorted[] | "E:" + .), (.w | keys_unsorted[] | "W:" + .),
    (.b[] | "B:" + .), "R:\(.r)"
' 2>/dev/null || true)

# Print the entries of one kind, without their tag
# Usage: tool_entries E
tool_entries() {
  sed -n "s/^$1://p" <<< "$TOOLS"
}

# Escape each input line and join the lines with ", "
join_escaped() {
  while IFS= read -r line; do escape_html "$line"; done | tr '\n' ', ' | sed 's/,$//' | sed 's/,/, /g'
}

# Get read files count
READ_COUNT=$(tool_entries R)

# Build summary parts
SUMMARY_PARTS=()

# Add one file category: its names up to max_names, else its count ("CAP+" at the cap)
# Usage: add_files <verb> <max_names> <tag>
add_files() {
  local files count
  files=$(tool_entries "$3" | sort -u)
  count=$(grep -c . <<< "$files" || true)
  if [[ "$count" -eq 0 ]]; then
    return 0
  elif [[ "$count" -le "$2" ]]; then
    SUMMARY_PARTS+=("$1: $(join_escaped <<< "$files")")
  elif [[ "$count" -lt "$CAP" ]]; then
    SUMMARY_PARTS+=("$1 $count files")
  else
    SUMMARY_PARTS+=("$1 $CAP+ files")
  fi
}

add_files Edited 3 E
add_files Created 2 W

# Add bash commands summary (jq already kept only program names of meaningful commands)
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
