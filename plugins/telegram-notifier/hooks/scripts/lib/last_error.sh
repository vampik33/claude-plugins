#!/bin/bash
# The reason the last Stop notification failed: recorded by the detached send job,
# which has no output to show it in, and reported once at the next SessionStart

# Path of the record
last_error_path() {
  printf '%s\n' "${HOME}/.claude/telegram-notifier.last-error"
}

# Record a failure, as "<date> <reason>": written aside, then moved into place, so a
# reader never sees it half written
# Usage: record_send_failure "reason"
record_send_failure() {
  local f
  f=$(last_error_path)
  { printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M')" "$1" > "$f.$$" && mv -f "$f.$$" "$f"; } 2>/dev/null ||
    rm -f "$f.$$" 2>/dev/null || true
}

# Clear the record after a send that works. Last writer wins: a failure an
# overlapping job has just recorded is cleared too
clear_send_failure() {
  rm -f "$(last_error_path)" 2>/dev/null || true
}

# Print the recorded failure (one line, at most 300 characters) and remove it. The
# record is claimed with one mv, so two session starts never both report it, and a
# failure recorded after the claim stays for the next one
claim_send_failure() {
  local f claimed line=""
  f=$(last_error_path)
  [[ -e "$f" ]] || return 0
  claimed="$f.claimed.$$"
  mv "$f" "$claimed" 2>/dev/null || return 0
  IFS= read -r line < "$claimed" || true
  rm -f "$claimed" 2>/dev/null || true
  printf '%s' "${line:0:300}"
}
