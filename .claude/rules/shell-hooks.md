---
paths:
  - "plugins/telegram-notifier/**"
---

# Shell hooks (telegram-notifier)

telegram-notifier is the only plugin with shell hooks.

- Start with `set -euo pipefail`
- Debug mode via `<PLUGIN>_DEBUG=1` environment variable
- A script that reads `TELEGRAM_BOT_TOKEN` runs `{ set +x; } 2>/dev/null` before it, so neither debug mode nor an outside `bash -x` traces the token; `tests/hooks.bats` checks each such script with tracing on
- `summarize-transcript.sh` runs in the Stop hook (10 s budget) on transcripts over 100 MB: stream the transcript through one `jq` pass that keeps only what the summary prints; never hold full tool inputs in a shell variable, and never pass file paths through `xargs` (quotes break it), take base names in `jq`
- Extract shared logic into `hooks/scripts/lib/` (`config.sh`, `html.sh`, `session.sh`, `yaml.sh`): these belong to telegram-notifier, not shared across plugins
- Read hook input via `HOOK_INPUT=$(cat)` before sourcing libraries
