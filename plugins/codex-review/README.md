# codex-review

Codex reviews as background jobs, and findings you pick and send to Claude.

```
codex · needs-attention · 3 findings (1 high) · 12m ago   [ open ]  [ review ]
```

```
codex adversarial-review ⏳ 3m12s · reviewing · deployer · base main   [ cancel ]
```

```
CODEX needs-attention · 3 findings · 7m02s · base main
Snapshot apply path holds a race between commit and unlock.

[x] HIGH     apply() commits snapshot before lock is released
    src/apply/mod.rs:212-238 · confidence 0.82
[ ] LOW      Error message leaks absolute temp path
    src/snapshot/io.rs:97 · confidence 0.55

[ Send 1 to Claude: verify & fix ]  [ verify only ]  [ dismiss ]
```

## Requirements

- Function hooks enabled (`CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`)
- The official codex plugin (`codex@openai-codex`, set up with `/codex:setup`)

## Installation

```bash
claude plugin install codex-review@vampik-plugins
```

## Commands

- `/cx [focus]`, `/cx adv [focus]`: adversarial review
- `/cx review`: Codex's standard review
- `/cx last`: open the last findings again
- `/cx cancel`: stop running reviews

Each start asks what to review:

| Choice | Codex reviews |
|---|---|
| Against base branch | the branch's commits since it left its base: the PR's base branch, else `main` |
| Session commits | the commits since this session started (the repository's HEAD at session start) |
| Current changes | the uncommitted changes: staged, unstaged and untracked |

A choice with nothing in it (no commits ahead, a clean tree) starts no review and says so. After a `git push` or `gh pr create`, `/cx adv` is proposed in the prompt box (Tab takes it).

## The line

Always drawn on its own line in the band above the prompt, just above continuity's context gauge (and effort-pilot's line under that), whatever order the mods run in: the running review with `cancel`, else the session's last finished review (`no review yet` before one) with `open` and `review`. `review` runs what `/cx adv` runs, dialog included. In the terminal, while the band is focused (ctrl+x tab), `x` presses `review`/`cancel` and `o` presses `open`; in the desktop app the buttons sit at the row's far end, without hotkeys. Reviews Claude ran through the tool count as the last result too.

## CodexReview tool

Claude gets `mcp__codex-review__CodexReview({ mode, base, focus, cwd })`. It runs a real Codex review and returns Codex's JSON (`verdict`, `summary`, `findings`, `next_steps`). When Codex fails it returns an error, never a review of Claude's own. The call goes through Claude Code's permission check like any MCP tool, so outside bypass or auto mode it asks first; allow it with `"permissions": { "allow": ["mcp__codex-review__CodexReview"] }`, and a deny rule keeps Claude from starting reviews (each one sends the diff to OpenAI through Codex).

## How It Works

The codex plugin's companion (`codex-companion.mjs`, found through `installed_plugins.json`) runs detached under `nohup`, writing its `--json` output to `~/.cache/codex-review/<job>/`. A 10 s poll follows it. Output that does not match Codex's review schema is shown as raw text, never guessed. Codex never gets `--write`. When Codex cannot start (for example, Claude Code's permission check refuses the detached launch), the job says `Codex did not start: <why>`.

## Configuration

| Option | Default | |
|---|---|---|
| `suggestAfterPush` | `true` | propose `/cx adv` after a push |
| `preselect` | `medium+` | `medium+`, `all` or `none` ticked |

## License

Apache-2.0. See [LICENSE](https://github.com/vampik33/claude-plugins/blob/main/LICENSE).
