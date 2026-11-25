#!/bin/bash
# Turn off tracing inherited from `bash -x` or an exported SHELLOPTS=xtrace before
# any line runs: the trace would print the bot token wherever it is expanded (to
# stdout too where BASH_XTRACEFD=1)
{ set +x; } >/dev/null 2>&1
set -euo pipefail

# Shared Telegram message sender
# Usage: send-telegram.sh [max_seconds] < message
# The message (HTML) comes on stdin and the payload goes to jq and curl on stdin:
# an argument tops out at 128 KiB, and a long cwd escaped for HTML passes that.
# A message longer than Telegram's 4096 characters is cut to fit, ending in "…"
# Returns: 0 on success, 1 on failure
# Output: JSON response on success, error message on failure
# Debug: Set TELEGRAM_NOTIFIER_DEBUG=1 to print the payload and the response
# (never `set -x`: the trace would print the bot token wherever it is expanded)

MESSAGE=$(cat)

if [[ -z "$MESSAGE" ]]; then
  echo "Error: No message provided" >&2
  exit 1
fi

if [[ -z "${TELEGRAM_BOT_TOKEN:-}" ]] || [[ -z "${TELEGRAM_CHAT_ID:-}" ]]; then
  echo "Error: Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID" >&2
  exit 1
fi

# Use jq for proper JSON escaping (handles quotes, backslashes, newlines, control chars)
if ! command -v jq &> /dev/null; then
  echo "Error: jq is required for safe JSON encoding" >&2
  exit 1
fi

# --rawfile, not -R: jq 1.7's -R splits a multibyte character that crosses a 4 KB
# boundary of its input into two U+FFFD
JSON_PAYLOAD=$(printf '%s' "$MESSAGE" | jq -n \
  --arg chat_id "$TELEGRAM_CHAT_ID" \
  --rawfile text /dev/stdin '
  # Telegram counts 4096 characters after HTML parsing; count UTF-16 code units (an
  # emoji counts 2)
  def w: if . > 65535 then 2 else 1 end; # the UTF-16 units of a code point
  def units: [explode[] | w] | add // 0;
  # An entity counts 1, a numeric one by its code point (2 past U+FFFF); one Telegram
  # may not decode (unknown, &#X41;, 0, a surrogate, past U+10FFFF) counts its own
  # characters
  def entity_units:
    (if test("^&#[0-9]+;$") then .[2:-1] | tonumber
     elif test("^&#x[0-9A-Fa-f]+;$") then
       reduce (.[3:-1] | ascii_downcase | explode[]) as $d (0; . * 16 + $d - (if $d > 96 then 87 else 48 end))
     else null end) as $v
    | if . == "&lt;" or . == "&gt;" or . == "&amp;" or . == "&quot;" then 1
      elif $v == null or $v == 0 or ($v >= 55296 and $v <= 57343) or $v > 1114111 then length
      else $v | w end;
  # The code points $cp as tokens, each with the index it ends at: {u, end} for a
  # character or an entity (u its UTF-16 units), {tag, end} for a tag (tag "/"
  # closes, a name opens, "" neither). One pass that builds no string: in jq 1.7
  # a global scan is quadratic in the length, a string index counts bytes, and
  # appending to a string in an object copies it. A tag ends at a ">" outside
  # quotes; an entity is "&", at most 31 of [A-Za-z0-9#] and ";"; an unterminated
  # one is plain characters
  def tokens($cp):
    def char($i): {u: ($cp[$i] | w), end: ($i + 1)};
    def text($c; $i):
      if $c == 60 then {m: "tag", b: $i, e: []}
      elif $c == 38 then {m: "entity", b: $i, e: []}
      elif $c == null then {e: []}
      else {m: "text", e: [char($i)]} end;
    foreach range(0; ($cp | length) + 1) as $i
      ({m: "text", e: []};
       $cp[$i] as $c # null past the end
       | if .m == "text" then text($c; $i)
         elif .m == "tag" then
           if $c == null then {e: [{from: .b, to: $i}]}
           elif .q then {m: "tag", b: .b, q: (if $c == .q then null else .q end), e: []}
           elif $c == 34 or $c == 39 then {m: "tag", b: .b, q: $c, e: []}
           elif $c == 62 then
             {m: "text",
              e: [{tag: (if $cp[.b + 1] == 47 then "/"
                         else ($cp[.b:$i + 1] | implode | capture("^<(?<n>[A-Za-z][A-Za-z0-9-]*)") | .n) // "" end),
                   end: ($i + 1)}]}
           else {m: "tag", b: .b, e: []} end
         elif $c != null and $i - .b < 32
              and ($c == 35 or ($c >= 48 and $c <= 57) or ($c >= 65 and $c <= 90) or ($c >= 97 and $c <= 122)) then
           {m: "entity", b: .b, e: []}
         elif $c == 59 then {m: "text", e: [{u: ($cp[.b:$i + 1] | implode | entity_units), end: ($i + 1)}]}
         else {from: .b, to: $i} as $f | text($c; $i) | {m, b, e: ([$f] + .e)}
         end;
       .e[] | if .from then range(.from; .to) as $k | char($k) else . end);
  # Cut where "…" still fits, close the tags open there, and keep counting: a
  # message that fits after all is sent whole
  def bound($max):
    if units <= $max then .
    else
      . as $whole
      | explode as $cp
      | first(foreach tokens($cp) as $t
          ({n: 0, tags: [], pos: 0, cut: null};
           if .cut then .n += ($t.u // 0)
           elif $t.tag then
             .pos = $t.end
             | .tags |= (if $t.tag == "/" then .[:-1] elif $t.tag == "" then . else . + [$t.tag] end)
           elif .n + $t.u > $max - 1 then
             .n += $t.u
             | .cut = ($cp[:.pos] | implode) + "…" + (.tags | reverse | map("</\(.)>") | join(""))
           else .n += $t.u | .pos = $t.end end;
           select(.n > $max) | .cut))
        // $whole
    end;
  {chat_id: $chat_id, text: ($text | bound(4096)), parse_mode: "HTML"}')

if [[ "${TELEGRAM_NOTIFIER_DEBUG:-}" == "1" ]]; then
  echo "Payload: $JSON_PAYLOAD" >&2
fi

# Send with timeout and capture response; 8 s keeps it inside the Stop hook's 10 s,
# and the hook passes a shorter time when the summary took some of it
MAX_TIME=8
if [[ "${1:-}" =~ ^[1-8]$ ]]; then
  MAX_TIME=$1
fi
# --retry 0 overrides a retry in ~/.curlrc, which would give each attempt the full -m
RESPONSE=$(printf '%s' "$JSON_PAYLOAD" | curl -s --retry 0 --connect-timeout 5 -m "$MAX_TIME" -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
  -H "Content-Type: application/json" \
  --data-binary @- 2>&1) || {
  echo "Error: curl failed" >&2
  exit 1
}

if [[ "${TELEGRAM_NOTIFIER_DEBUG:-}" == "1" ]]; then
  echo "Response: $RESPONSE" >&2
fi

# Validate API response
if echo "$RESPONSE" | jq -e '.ok == true' > /dev/null 2>&1; then
  echo "$RESPONSE"
  exit 0
else
  ERROR_DESC=$(echo "$RESPONSE" | jq -r '.description // "Unknown error"' 2>/dev/null || echo "Invalid response")
  echo "Error: Telegram API failed - $ERROR_DESC" >&2
  exit 1
fi
