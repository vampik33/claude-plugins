#!/usr/bin/env bats

# Tests for lib/html.sh — HTML escaping for Telegram messages

setup() {
  PLUGIN_DIR="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)"
  source "$PLUGIN_DIR/hooks/scripts/lib/html.sh"
}

@test "escape_html: escapes ampersand" {
  run escape_html "foo & bar"
  [ "$output" = "foo &amp; bar" ]
}

@test "escape_html: escapes less-than" {
  run escape_html "a < b"
  [ "$output" = "a &lt; b" ]
}

@test "escape_html: escapes greater-than" {
  run escape_html "a > b"
  [ "$output" = "a &gt; b" ]
}

@test "escape_html: escapes & before < and > to avoid double-escaping" {
  run escape_html "a & b < c > d"
  [ "$output" = "a &amp; b &lt; c &gt; d" ]
}

@test "escape_html: handles string with all special chars" {
  run escape_html "<script>alert('x&y')</script>"
  [ "$output" = "&lt;script&gt;alert('x&amp;y')&lt;/script&gt;" ]
}

@test "escape_html: handles empty input" {
  run escape_html ""
  [ "$output" = "" ]
}

@test "escape_html: handles no arguments" {
  run escape_html
  [ "$output" = "" ]
}

@test "escape_html: passes through plain text unchanged" {
  run escape_html "Hello World 123"
  [ "$output" = "Hello World 123" ]
}

@test "escape_html: handles multiple ampersands without double-escaping" {
  run escape_html "a&b&c"
  [ "$output" = "a&amp;b&amp;c" ]
}

@test "escape_html: does not escape quotes (Telegram HTML mode)" {
  run escape_html 'say "hello"'
  [ "$output" = 'say "hello"' ]
}
