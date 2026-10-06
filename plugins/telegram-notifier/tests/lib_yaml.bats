#!/usr/bin/env bats

# Tests for lib/yaml.sh — frontmatter extraction, field parsing, body extraction

setup() {
  PLUGIN_DIR="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)"
  source "$PLUGIN_DIR/hooks/scripts/lib/yaml.sh"
}

# --- extract_frontmatter ---

@test "extract_frontmatter: returns fields between --- delimiters" {
  local f="$BATS_TEST_TMPDIR/fm.md"
  cat > "$f" <<'EOF'
---
enabled: true
threshold: 10
---
body here
EOF
  run extract_frontmatter "$f"
  [ "$status" -eq 0 ]
  [[ "$output" == *"enabled: true"* ]]
  [[ "$output" == *"threshold: 10"* ]]
}

@test "extract_frontmatter: returns empty for file with no frontmatter" {
  local f="$BATS_TEST_TMPDIR/nofm.md"
  echo "just body" > "$f"
  run extract_frontmatter "$f"
  [ "$status" -eq 0 ]
  [ "$output" = "" ]
}

@test "extract_frontmatter: returns empty for empty file" {
  local f="$BATS_TEST_TMPDIR/empty.md"
  : > "$f"
  run extract_frontmatter "$f"
  [ "$status" -eq 0 ]
  [ "$output" = "" ]
}

@test "extract_frontmatter: returns empty for nonexistent file" {
  run extract_frontmatter "$BATS_TEST_TMPDIR/no-such-file.md"
  [ "$status" -eq 0 ]
  [ "$output" = "" ]
}

@test "extract_frontmatter: does not include body after closing ---" {
  local f="$BATS_TEST_TMPDIR/fm_body.md"
  cat > "$f" <<'EOF'
---
key: val
---
This is body text
EOF
  run extract_frontmatter "$f"
  [ "$status" -eq 0 ]
  [[ "$output" != *"body text"* ]]
}

# --- parse_yaml_field ---

@test "parse_yaml_field: extracts simple value" {
  run parse_yaml_field "enabled" "default" "enabled: true"
  [ "$output" = "true" ]
}

@test "parse_yaml_field: returns default for missing field" {
  run parse_yaml_field "missing" "fallback" "enabled: true"
  [ "$output" = "fallback" ]
}

@test "parse_yaml_field: strips double quotes from value" {
  run parse_yaml_field "name" "" 'name: "hello"'
  [ "$output" = "hello" ]
}

@test "parse_yaml_field: strips single quotes from value" {
  run parse_yaml_field "name" "" "name: 'hello'"
  [ "$output" = "hello" ]
}

@test "parse_yaml_field: strips inline comment (space + #)" {
  run parse_yaml_field "threshold" "0" "threshold: 10 # minutes"
  [ "$output" = "10" ]
}

@test "parse_yaml_field: handles value with no space after colon" {
  run parse_yaml_field "enabled" "no" "enabled:true"
  [ "$output" = "true" ]
}

@test "parse_yaml_field: takes first match when field appears twice" {
  local fm
  fm=$(printf 'key: first\nkey: second')
  run parse_yaml_field "key" "" "$fm"
  [ "$output" = "first" ]
}

@test "parse_yaml_field: returns default for empty frontmatter" {
  run parse_yaml_field "key" "def" ""
  [ "$output" = "def" ]
}

@test "parse_yaml_field: handles value containing colon" {
  run parse_yaml_field "url" "" "url: https://example.com:8080/path"
  # Colons after the first are kept (spaces/quotes stripped)
  [[ "$output" == *"https://example.com:8080/path"* ]]
}

@test "parse_yaml_field: skips comment-only lines starting with #" {
  local fm
  fm=$(printf '# this is a comment\nenabled: true')
  run parse_yaml_field "enabled" "" "$fm"
  [ "$output" = "true" ]
}

@test "parse_yaml_field: handles numeric value" {
  run parse_yaml_field "session_threshold_minutes" "10" "session_threshold_minutes: 5"
  [ "$output" = "5" ]
}

# --- extract_body ---

@test "extract_body: returns content after second ---" {
  local f="$BATS_TEST_TMPDIR/body.md"
  cat > "$f" <<'EOF'
---
key: val
---
Hello world
EOF
  run extract_body "$f"
  [ "$status" -eq 0 ]
  [ "$output" = "Hello world" ]
}

@test "extract_body: collapses multiple lines into single line" {
  local f="$BATS_TEST_TMPDIR/multi.md"
  cat > "$f" <<'EOF'
---
key: val
---
Line one
Line two
Line three
EOF
  run extract_body "$f"
  [ "$status" -eq 0 ]
  [ "$output" = "Line one Line two Line three" ]
}

@test "extract_body: skips leading blank lines after ---" {
  local f="$BATS_TEST_TMPDIR/blanks.md"
  cat > "$f" <<'EOF'
---
key: val
---


Content here
EOF
  run extract_body "$f"
  [ "$status" -eq 0 ]
  [ "$output" = "Content here" ]
}

@test "extract_body: returns empty for file with no frontmatter" {
  local f="$BATS_TEST_TMPDIR/nobody.md"
  echo "just text" > "$f"
  run extract_body "$f"
  [ "$status" -eq 0 ]
  [ "$output" = "" ]
}

@test "extract_body: returns empty when only frontmatter present" {
  local f="$BATS_TEST_TMPDIR/fmonly.md"
  cat > "$f" <<'EOF'
---
key: val
---
EOF
  run extract_body "$f"
  [ "$status" -eq 0 ]
  [ "$output" = "" ]
}

@test "extract_body: collapses extra whitespace" {
  local f="$BATS_TEST_TMPDIR/spaces.md"
  cat > "$f" <<'EOF'
---
k: v
---
word1   word2     word3
EOF
  run extract_body "$f"
  [ "$status" -eq 0 ]
  [ "$output" = "word1 word2 word3" ]
}

@test "extract_body: handles CRLF in body content" {
  local f="$BATS_TEST_TMPDIR/crlf_body.md"
  printf '%s\n' "---" "k: v" "---" "Hello" "World" > "$f"
  # Inject \r before \n on the body lines to simulate CRLF
  sed -i '4,5s/$/'$'\r''/' "$f"
  run extract_body "$f"
  [ "$status" -eq 0 ]
  # \r is preserved by read -r; the important thing is it doesn't crash
  [[ "$output" == *"Hello"* ]]
  [[ "$output" == *"World"* ]]
}
