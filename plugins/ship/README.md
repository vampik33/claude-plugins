# ship

For this marketplace repo: what is not shipped yet, and one command to ship it.

```
ship · main ↑2 · ●3 uncommitted · fleet 0.4.2 → 0.5.0 · restart needed   [ ship ]
```

The line above the prompt shows when there is something to say:

- `↑2`: commits not pushed yet
- `●3 uncommitted`: changed files (shown, never shipped)
- `fleet 0.4.2 → 0.5.0`: a mod installed from this marketplace at another version than the repo's `marketplace.json`
- `restart needed`: a mod was updated after this session loaded its plugins

`/ship` (or the `ship` button) does the steps that follow a commit:

1. `git push`, when commits are ahead of the upstream
2. `claude plugin marketplace update <marketplace>`, when a mod is behind
3. `claude plugin update <mod>@<marketplace>` for each mod behind, and no other

It stops at the first failure and says why, warns when the branch is not `main` (the marketplace reads `main`, so no mod is updated), names uncommitted files it left out, and says which mods need a restart. Committing and version bumps stay with Claude.

## Installation

Meant for this repo alone, so installed at the local scope from inside it:

```bash
claude plugin install ship@vampik-plugins --scope local
```

## How It Works

- At the session's start and each main turn's end: `git status --porcelain=v1 --branch`, the repo's `.claude-plugin/marketplace.json` and `~/.claude/plugins/installed_plugins.json`.
- The versions installed when the session (re)loads its plugins are the baseline for `restart needed`.
- Commands run with `GIT_TERMINAL_PROMPT=0`, so a push that needs a password fails instead of waiting.
