# Changelog

All notable changes to the effort-pilot plugin will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.1.0] - 2026-11-13

### Added
- Each prompt you submit asks Jev (TypeSafe) which effort level it needs (low, medium, high, xhigh or max), over the prompt, your last 3 prompts and the end of the last answer; tool output and file contents are never sent
- Every main-loop request of the turn goes out at Jev's level on Opus 5.5, Sonnet 5.5, Haiku 5.5 and Fable 5.1+ with an API key or subscription, where an effort change keeps the prompt cache; on other models, under Bedrock, Google Cloud, Foundry or a gateway, and with experimental betas off, Jev only advises. Subagents keep their own level
- A line under each answer: the model, the effort it ran at, and Jev's call (`Jev: medium → xhigh 84%`, `Jev kept high`, advice, or why Jev gave none)
- The band's last line, under every other mod's: the current model and effort and Jev's last call, in the terminal and the desktop app
- Jev's level is applied only when Jev is at least 50% sure; below that the previous turn's level stays (the session's own before Jev has set one), and the line says `Jev unsure: …, kept <level>`
- Jev not answering within 4 s, an HTTP error or a missing `TYPESAFE_API_KEY` leaves the session's own level
