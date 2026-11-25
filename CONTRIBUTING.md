# Contributing

Thanks for helping improve `vampik-plugins`. This guide covers the repository layout, testing, and the steps for adding or updating a plugin.

## Prerequisites

[Claude Code](https://code.claude.com), plus the tools the checks need, listed in [verification/README.md](verification/README.md).

## Repository layout

```text
claude-plugins/
├── .claude-plugin/
│   └── marketplace.json      # Marketplace manifest listing every plugin and its version
├── .claude/
│   ├── rules/                # Path-scoped instructions for Claude Code agents
│   └── skills/verify/        # The /verify skill: checks a change before commit
├── plugins/
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
├── CLAUDE.md                 # Instructions for Claude Code agents
├── CONTRIBUTING.md
├── REVIEW.md                 # What code review checks
├── LICENSE
└── README.md
```

## Trying a working copy

Load a plugin from your checkout without installing it:

```bash
claude --plugin-dir /path/to/claude-plugins/plugins/<plugin-name>
```

## Testing

```bash
verification/run.sh
```

Runs the Lean proofs, the property and differential tests, `claude plugin test` for every mod, and telegram-notifier's shellcheck and bats tests. To run one suite, and for what the proofs cover, see [verification/README.md](verification/README.md).

## Workflow

- `main` is protected: work on a branch and open a pull request.
- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/) as `type(plugin-name): description (vX.Y.Z)`, the suffix being the plugin's new version.
- Reviews check the points in [REVIEW.md](REVIEW.md).

## Adding a plugin

1. Create `plugins/<name>/` with `.claude-plugin/plugin.json`, a `README.md` and a `CHANGELOG.md` (format: see [Updating a plugin](#updating-a-plugin)). The README starts with `# <name>` and a short description, then `## Requirements` (when there are any; a mod lists function hooks) and `## Installation`; the plugin's own sections follow, and it ends with `## License`.
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

3. Add a row to the matching table in [README.md](README.md) (Mods, or Commands and skills).
4. For a mod, also add it to the `for mod in …` loop in `verification/run.sh`, and add `verification/props/<mod>.prop.test.ts` for the pure functions in its `core.ts`.

## Updating a plugin

Every change to a plugin:

1. Bumps the version ([Semantic Versioning](https://semver.org/)) in **both** `plugins/<name>/.claude-plugin/plugin.json` and the plugin's entry in `.claude-plugin/marketplace.json`. The two must match.
2. Adds a dated section to the plugin's `CHANGELOG.md` ([Keep a Changelog](https://keepachangelog.com/en/1.1.0/)), with changes under Added, Changed, Fixed or Removed.

## Plugin configuration

- Mods declare their options in `plugin.json` (`userConfig`).
- Shell-hook and command plugins read markdown files with YAML frontmatter: `~/.claude/<plugin>.local.md` (user) and `.claude/<plugin>.local.md` (project). A project value overrides the user value, which overrides the default.
