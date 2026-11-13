# effort-pilot

Jev, TypeSafe's classifier, picks the effort level for each prompt, and the mod sends the turn's requests at that level. You see the model and effort under every answer and on the band's last line.

```
opus-5-5 · effort xhigh · Jev: medium → xhigh 84%
```

## Installation

```bash
claude plugin install effort-pilot@vampik-plugins
```

## Setup

Set a TypeSafe key for Jev, in `~/.claude/settings.json`:

```json
{ "env": { "TYPESAFE_API_KEY": "…" } }
```

Without one the mod shows a toast once and leaves the session's own level. Needs function hooks (`CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`).

## How it works

1. **On each prompt**, as its turn starts (`turn.start`, so a prompt typed while a turn runs is judged when its own turn starts, not in the middle of the running one), Jev gets one `score` question over five levels, low to max, and the mod takes the most likely one. If Jev is less than 50% sure, its level is shown but not applied: the level the previous turn ran at stays (the session's own before Jev has set one). A turn with no prompt, such as a continuation, also keeps the previous turn's level, without asking Jev. Jev reads the prompt, your last 3 prompts and the end of the last answer, all cut to a few KB. Tool output and file contents are never sent: TypeSafe is a third party. The prompt waits for Jev at most 4 s (it usually answers in about 0.3 s); past that, or on an HTTP error, the session's level stands.
2. **On each main-loop request** (`turn.step`) the mod sends Jev's level in place of the session's. Your `/effort` setting is not changed: the level applies request by request. Subagents keep their own level.
3. **Only where an effort change keeps the prompt cache**: Opus 5.5, Sonnet 5.5, Haiku 5.5 and Fable 5.1 and later, with an API key or a Claude subscription. Elsewhere a change re-sends the whole conversation uncached ([prompt caching docs](https://code.claude.com/docs/en/prompt-caching#changing-effort-level)), so Jev only advises: the line says `Jev advises xhigh (not applied …)`. The mod applies Jev's level only when Claude Code holds a first-party credential (none under Bedrock, Google Cloud, Foundry or a gateway) and `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS` is off. It cannot see an organization's HIPAA configuration, where an effort change also re-caches; don't use the mod there.

## What you see

- **Under each answer**: the model, the effort the turn ran at, and Jev's call: `Jev: medium → xhigh 84%` (changed), `Jev kept high 80%` (same as the session), `Jev unsure: xhigh 33%, kept medium` (under 50%: the previous turn's level stays), `Jev advises …` (not applied on this model), or `Jev: HTTP 500, session level`.
- **The band's last line**, under every other mod's row (it moves its own row to the end): the current model and effort, and Jev's last call. Before the first request it shows `effort –`.

Both are plain text, the same in the terminal and the desktop app.

Each prompt costs one Jev call (a few hundred input tokens).
