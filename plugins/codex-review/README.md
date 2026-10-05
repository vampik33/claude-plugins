# codex-review

Codex reviews as background jobs, and findings you pick and send to Claude.

```
codex adversarial-review ⏳ 3m12s · reviewing · deployer → develop · /cx cancel
```

```
CODEX needs-attention · 3 findings · 7m02s · base develop
Snapshot apply path holds a race between commit and unlock.

[x] HIGH     apply() commits snapshot before lock is released
    src/apply/mod.rs:212-238 · confidence 0.82
[ ] LOW      Error message leaks absolute temp path
    src/snapshot/io.rs:97 · confidence 0.55

[ Send 1 to Claude: verify & fix ]  [ verify only ]  [ dismiss ]
```

## Installation

Requires the official codex plugin (`codex@openai-codex`, set up with `/codex:setup`).

```bash
claude plugin install codex-review@vampik-plugins
```

## Commands

- `/cx [focus]`, `/cx adv [focus]`: adversarial review of the checked-out branch
- `/cx review`: Codex's standard review
- `/cx last`: open the last findings again
- `/cx cancel`: stop running reviews

The base is the PR's base branch, else `develop` for the greenticai/greentic-biz orgs, else `main`. After a `git push` or `gh pr create`, `/cx adv` is proposed in the prompt box (Tab takes it).

## CodexReview tool

Claude gets `mcp__codex-review__CodexReview({ mode, base, focus, cwd })`. It runs a real Codex review and returns Codex's JSON (`verdict`, `summary`, `findings`, `next_steps`). When Codex fails it returns an error, never a review of Claude's own.

## How It Works

The codex plugin's companion (`codex-companion.mjs`, found through `installed_plugins.json`) runs detached under `nohup`, writing its `--json` output to `~/.cache/codex-review/<job>/`. A 10 s poll follows it. Output that does not match Codex's review schema is shown as raw text, never guessed. Codex never gets `--write`.

## Configuration

| Option | Default | |
|---|---|---|
| `suggestAfterPush` | `true` | propose `/cx adv` after a push |
| `preselect` | `medium+` | `medium+`, `all` or `none` ticked |

Needs function hooks (`CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`).
