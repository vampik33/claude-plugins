---
paths:
  - "plugins/telegram-notifier/hooks/**"
  - "plugins/telegram-notifier/tests/**"
---

# Shell hooks (telegram-notifier)

telegram-notifier is the only plugin with shell hooks.

- Start with `{ set +x; } >/dev/null 2>&1`, then `set -euo pipefail`: tracing inherited from `bash -x` or an exported `SHELLOPTS=xtrace` would trace every line before it, to stdout where `BASH_XTRACEFD=1` (`tests/hooks.bats` checks that the hooks trace nothing); never unset `BASH_XTRACEFD`: bash closes that descriptor
- Debug mode via `<PLUGIN>_DEBUG=1` environment variable
- A script that reads `TELEGRAM_BOT_TOKEN` runs `{ set +x; } >/dev/null 2>&1` before it, so neither debug mode nor an outside `bash -x` traces the token; `tests/hooks.bats` checks each such script with tracing on
- `summarize-transcript.sh` runs on transcripts over 100 MB, in the Stop hook's detached job (4 s limit; in the foreground, inside the hook's 10 s, in debug mode): stream the transcript through one `jq` pass that keeps only what the summary prints; never hold full tool inputs in a shell variable, and never pass file paths through `xargs` (quotes break it), take base names in `jq`
- Pass messages and payloads to `send-telegram.sh`, `jq` and `curl` on stdin, never as arguments: one argument tops out at 128 KiB, and a long cwd escaped for HTML passes that. Read raw text into `jq` with `--rawfile name /dev/stdin`, not `-R`: jq's `-R` (1.6 to 1.8.1) splits a multibyte character that crosses a 4 KB boundary of its input into two U+FFFD; to stream JSON lines, prefix each with an RS byte and use `jq --seq` (`summarize-transcript.sh`)
- Print data with `printf '%s\n'`, never `echo`: `echo` reads a value of `-n` or `-e` as an option
- Never export a value taken from the hook input (`CLAUDE_CWD`, `CLAUDE_SESSION_ID` in `lib/session.sh`): an environment variable past 128 KiB makes every later command fail with "Argument list too long"
- Extract shared logic into `hooks/scripts/lib/`: it belongs to telegram-notifier, not shared across plugins
- Read hook input via `HOOK_INPUT=$(cat)` before sourcing libraries
