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
  # emoji counts 2): a tag counts 0, an entity 1 (a numeric one 2)
  def units: [explode[] | if . > 65535 then 2 else 1 end] | add // 0;
  # A text part as entities and characters. Only its first $max * 10 characters
  # (an entity has at most 10): the cut comes before them, and scan takes time
  # quadratic in the length
  def text_tokens($max):
    .[:$max * 10] | scan("&(?:lt|gt|amp|quot|#[0-9]{1,7}|#x[0-9A-Fa-f]{1,6});|[\\s\\S]");
  def tokens($max):
    split("<") as $p
    | ($p[0] | text_tokens($max)),
      ($p[1:][] | (explode | index(62)) as $i # ">"; a string index counts bytes in jq 1.7
       | if $i then ("<" + .[:$i + 1]), (.[$i + 1:] | text_tokens($max))
         else "<" + . | text_tokens($max) end);
  # Cut where "…" still fits, close the tags open there, and keep counting: a
  # message that fits after all is sent whole
  def bound($max):
    . as $whole
    | if units <= $max then .
      else
        label $done
        | foreach (tokens($max), null) as $t
            ({out: "", n: 0, tags: [], cut: null};
             if $t == null then .end = true
             elif ($t | test("^<.*>$")) then
               if .cut then . else
                 .out += $t
                 | if ($t | startswith("</")) then .tags |= .[:-1]
                   else .tags += [$t | capture("^<(?<n>[A-Za-z][A-Za-z0-9-]*)") | .n] end
               end
             else
               ($t | if startswith("&#") then 2 elif startswith("&") and length > 1 then 1 else units end) as $u
               | if .cut == null and .n + $u > $max - 1 then
                   .cut = .out + "…" + ([.tags | reverse[] | "</\(.)>"] | join(""))
                 else . end
               | if .cut == null then .out += $t else . end
               | .n += $u
             end;
             if .end then $whole, break $done
             elif .n > $max then .cut, break $done
             else empty end)
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
