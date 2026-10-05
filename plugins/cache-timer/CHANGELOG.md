# Changelog

All notable changes to the cache-timer plugin will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.1.0] - 2026-10-05

### Added
- Real-time prompt-cache countdown above the prompt, green → yellow → red as the cache runs out, `● cache cold` once expired
- TTL from Claude Code's own rules (env, `promptCacheTtl`, subscription), corrected from request timing
- One toast when the timer turns red
