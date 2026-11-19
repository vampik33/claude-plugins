# Claude Plugins

`vampik-plugins`: a Claude Code plugin marketplace for development workflows.

## Installation

Add the marketplace, then install plugins by name:

```
/plugin marketplace add vampik33/claude-plugins
/plugin install <plugin-name>@vampik-plugins
```

Or browse with the `/plugin` menu. From a shell: `claude plugin install <plugin-name>@vampik-plugins`.

To try a working copy without installing it:

```bash
claude --plugin-dir /path/to/claude-plugins/plugins/<plugin-name>
```

## Available Plugins

### Mods

TypeScript function-hook plugins that change Claude Code's interface or behaviour. They need function hooks enabled (`CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`).

| Plugin | Description |
|--------|-------------|
| **[big-picture](plugins/big-picture/)** | When Jev judges the work big, writes a visual HTML summary and keeps it updated; `/big-picture` opens it in the browser |
| **[chat-view](plugins/chat-view/)** | Your prompts as chat bubbles with their send time, reply start times, and start → end times on each turn |
| **[codex-review](plugins/codex-review/)** | Codex reviews as background jobs with findings to pick and send to Claude, and a `CodexReview` tool |
| **[continuity](plugins/continuity/)** | Context gauge, session length, prompt-cache countdown and hit rate; handover, compaction and continue past a threshold; resume after a usage limit |
| **[effort-pilot](plugins/effort-pilot/)** | Jev picks the effort level for each prompt; each answer ends with its model and effort |
| **[fix-findings](plugins/fix-findings/)** | Prove review findings against the code, fix only the valid ones; `converge` loops test, fix and review for up to three rounds |
| **[fleet](plugins/fleet/)** | A side pane with the session's subagents, background shells and worktrees, with alerts when they finish or fail |
| **[memory-watch](plugins/memory-watch/)** | A side pane summarizing each auto-memory file the session creates or updates |
| **[palette](plugins/palette/)** | A side pane listing the session's agents, skills and commands; click one to put it in the prompt box |
| **[ship](plugins/ship/)** | For this repo: unpushed commits and installed mods behind the repo, and `/ship` to push and update them |
| **[tool-lens](plugins/tool-lens/)** | An icon, duration and token estimate under every tool call, and a button that expands its diff |
| **[watchdog](plugins/watchdog/)** | Stops a Bash command with no output, CPU or I/O for 10 minutes and tells the model |

### Commands and skills

| Plugin | Description |
|--------|-------------|
| **[claudemd-gen](plugins/claudemd-gen/)** | Interactive CLAUDE.md generator and auditor |
| **[explain-changes](plugins/explain-changes/)** | Explains code changes in detail: what was done and why |
| **[gtr](plugins/gtr/)** | Git worktree management using git-worktree-runner |
| **[plan-renamer](plugins/plan-renamer/)** | Renames randomly-named plan files to titles taken from their content |
| **[telegram-notifier](plugins/telegram-notifier/)** | Telegram messages from a session, by command or automatically after inactivity (shell hooks) |

Each plugin's README has its setup and options.

## Team Setup

Add to your project's `.claude/settings.json` so team members are prompted to add the marketplace when they trust the project:

```json
{
  "extraKnownMarketplaces": {
    "vampik-plugins": {
      "source": { "source": "github", "repo": "vampik33/claude-plugins" }
    }
  }
}
```

## Repository Structure

```
claude-plugins/
├── .claude-plugin/
│   └── marketplace.json      # Marketplace manifest listing every plugin and its version
├── plugins/
│   ├── CLAUDE.md             # Conventions and gotchas for mods and shell hooks
│   ├── <mod>/                # e.g. fleet
│   │   ├── .claude-plugin/plugin.json
│   │   ├── hooks/            # hooks.json + TypeScript module (register.tsx, core.ts)
│   │   ├── tests/            # run by `claude plugin test`
│   │   ├── types/            # the mod's own types
│   │   ├── CHANGELOG.md
│   │   └── README.md
│   └── <plugin>/             # e.g. gtr
│       ├── .claude-plugin/plugin.json
│       ├── commands/         # Slash commands
│       ├── skills/           # Skills
│       ├── CHANGELOG.md
│       └── README.md
├── verification/             # Lean proofs, property and differential tests, run.sh
├── plans/                    # Implementation plans from Claude sessions
├── CLAUDE.md
├── LICENSE
└── README.md
```

## Testing

```bash
verification/run.sh
```

Runs the Lean proofs, the property and differential tests, `claude plugin test` for every mod, and telegram-notifier's shellcheck and bats tests. See [verification/README.md](verification/README.md).

## Adding a Plugin

1. Create `plugins/<name>/` with `.claude-plugin/plugin.json`, a `README.md` and a `CHANGELOG.md` ([Keep a Changelog](https://keepachangelog.com/en/1.1.0/)).
2. Add an entry to `.claude-plugin/marketplace.json` with the same version as `plugin.json`:
   ```json
   {
     "name": "my-plugin",
     "description": "What the plugin does",
     "version": "0.1.0",
     "author": { "name": "vampik33" },
     "source": "./plugins/my-plugin",
     "category": "Workflow",
     "keywords": ["relevant", "keywords"],
     "homepage": "https://github.com/vampik33/claude-plugins"
   }
   ```
3. Add it to the table above. A new mod also goes into `verification/run.sh` (see `plugins/CLAUDE.md`).

## License

Apache License 2.0 (explain-changes: MIT)
