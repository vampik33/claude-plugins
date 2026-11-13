# Changelog

All notable changes to the effort-pilot plugin will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.2.0] - 2026-11-13

### Changed
- Jev's criteria follow [Which Claude model should you build with?](https://claude.dev/blog/which-claude-model-should-you-build-with/) and Claude Code's effort guide: everyday engineering, debugging and feature work is `medium` (was `xhigh` for a feature), `high` is for work where verification matters or `medium` fell short, `xhigh` only after `high` fell short on the same problem, and `max` for a hard problem worked through unattended. Jev is told that past `high` one more level costs about as much as a bigger model
- The default Jev is told before the first request falls back to the model's own default (`medium` on Opus 5.5, Sonnet 5.5, Haiku 5.5 and Fable 5.2, `xhigh` on Opus 4.7, `high` on the others) instead of `unknown`; a top-level `effortLevel` in your user settings counts only on Opus 5, Fable 5.1 and earlier; `max` in a settings key and `CLAUDE_CODE_EFFORT_LEVEL=auto`/`unset` name no level. After a held turn Jev is told this default, not the held level

### Fixed
- The mod no longer overrides a level Claude Code ranks above the session's: every request while `CLAUDE_CODE_EFFORT_LEVEL` names a level, a turn whose prompt says `ultrathink`, and the rest of a turn in which a skill with an `effort` in its frontmatter runs. Jev only advises there, and the line says why (`not applied: ultrathink`)

## [0.1.2] - 2026-11-13

### Changed
- When Jev is less than 50% sure, the turn runs at the session's own level (your configured default) instead of the level the previous turn ran at, and the line says `Jev unsure: …, session level <level>`. A turn with no prompt still keeps the previous turn's level
- Jev is told the session's default level (`defaultEffort`, was `currentEffort`) and that it stands when Jev is unsure; on a session's first prompt it comes from `CLAUDE_CODE_EFFORT_LEVEL`, `modelSettings.<model>.effortLevel` or `effortLevel` instead of `unknown`

## [0.1.1] - 2026-11-13

### Fixed
- The band's last three rows are always codex, ctx, then the model and effort; before, only this row moved and the others kept the order Claude Code runs the mods in, which changes between sessions

## [0.1.0] - 2026-11-13

### Added
- Each prompt you submit asks Jev (TypeSafe) which effort level it needs (low, medium, high, xhigh or max), over the prompt, your last 3 prompts and the end of the last answer; tool output and file contents are never sent
- Every main-loop request of the turn goes out at Jev's level on Opus 5.5, Sonnet 5.5, Haiku 5.5 and Fable 5.1+ with an API key or subscription, where an effort change keeps the prompt cache; on other models, under Bedrock, Google Cloud, Foundry or a gateway, and with experimental betas off, Jev only advises. Subagents keep their own level
- A line under each answer: the model, the effort it ran at, and Jev's call (`Jev: medium → xhigh 84%`, `Jev kept high`, advice, or why Jev gave none)
- The band's last line, under every other mod's: the current model and effort and Jev's last call, in the terminal and the desktop app
- Jev's level is applied only when Jev is at least 50% sure; below that the previous turn's level stays (the session's own before Jev has set one), and the line says `Jev unsure: …, kept <level>`
- Jev not answering within 4 s, an HTTP error or a missing `TYPESAFE_API_KEY` leaves the session's own level
