#!/usr/bin/env bats

# Tests for lib/last_error.sh — the record of the last failed Stop notification

setup() {
  PLUGIN_DIR="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)"
  export HOME="$BATS_TEST_TMPDIR/home"
  mkdir -p "$HOME/.claude"
  source "$PLUGIN_DIR/hooks/scripts/lib/last_error.sh"
}

@test "record_send_failure: writes the date and the reason, and no temporary file" {
  record_send_failure "curl failed"
  [[ "$(cat "$(last_error_path)")" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}\ [0-9]{2}:[0-9]{2}\ curl\ failed$ ]]
  [ -z "$(find "$HOME/.claude" -name 'telegram-notifier.last-error.*')" ]
}

@test "record_send_failure: replaces an earlier record" {
  record_send_failure "first"
  record_send_failure "second"
  [[ "$(cat "$(last_error_path)")" == *" second" ]]
  [ "$(wc -l < "$(last_error_path)" | tr -d ' ')" = "1" ]
}

@test "claim_send_failure: prints the record once and removes it" {
  record_send_failure "Telegram API failed - Unauthorized"
  run claim_send_failure
  [[ "$output" == *" Telegram API failed - Unauthorized" ]]
  [ ! -e "$(last_error_path)" ]
  run claim_send_failure
  [ -z "$output" ]
}

@test "claim_send_failure: prints the first line, at most 300 characters" {
  { printf 'x%.0s' {1..400}; printf '\nsecond line\n'; } > "$(last_error_path)"
  run claim_send_failure
  [ "${#output}" -eq 300 ]
  [[ "$output" != *second* ]]
}

@test "claim_send_failure: prints nothing without a record" {
  run claim_send_failure
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "clear_send_failure: removes the record, and is quiet without one" {
  record_send_failure "curl failed"
  clear_send_failure
  [ ! -e "$(last_error_path)" ]
  run clear_send_failure
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}
