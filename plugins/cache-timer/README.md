# cache-timer

A real-time countdown to the prompt cache's expiry, above the prompt.

```
⏱ 42:17        green while more than 25% of the cache lifetime is left
⏱ 9:58         yellow from 25%
⏱ 4:31         red from 10%, with one toast: send a message to keep it warm
● cache cold   once it has expired
```

It ticks every second on its own (a `Client` surface module), during a turn too.

## Installation

```bash
claude plugin install cache-timer@vampik-plugins
```

## How It Works

- `turn.step` records each main-loop request's cache read/write; the countdown starts from that request's start.
- The lifetime follows Claude Code's order: `FORCE_PROMPT_CACHING_5M`, `CLAUDE_CODE_PROMPT_CACHE_TTL`, `promptCacheTtl` in settings, `ENABLE_PROMPT_CACHING_1H`, then 1h on a subscription and 5m otherwise. A cache hit after more than 5 minutes proves 1h; a miss proves 5m.

## Configuration

`/config` rows (or `pluginConfigs.cache-timer.options` in settings):

| Option | Default | |
|---|---|---|
| `ttl` | `auto` | `auto`, `5m` or `1h` |
| `yellowAt` | `0.25` | share of the lifetime left when it turns yellow |
| `redAt` | `0.1` | share left when it turns red |
| `toast` | `true` | one toast when it turns red |

Needs function hooks (`CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`).
