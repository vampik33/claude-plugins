# palette

A side pane listing this session's agents, skills and commands. Click one to put it in the prompt box, ready to finish and send.

```
Click to put it in the prompt ↻

▾ project (2)
@reviewer           Reviews diffs for …
/deploy             Deploy the current branch

▾ user (55)
@rust-engineer      Expert Rust developer …
/think              Meta-cognitive reasoning …

▸ plugin:hookify (5)
```

## Installation

```bash
claude plugin install palette@vampik-plugins
```

## Behaviour

- `/palette` shows or hides the pane. It docks beside the transcript in the fullscreen layout (110+ columns), inline above the prompt otherwise.
- A command or skill goes to the start of the prompt as `/<name> ` (a slash command only runs from there), replacing a leading command and keeping the rest of your draft.
- An agent goes in at the cursor as `@agent-<name> `.
- Nothing is sent: you finish the prompt and press Enter.
- Click a group header to fold it; `↻` re-reads the lists (after `/reload-plugins`, say).

Groups: `project` (`.claude/` in the working directory), `user`, one per plugin, and `mcp`. Built-in commands and agents are left out.

## How It Works

Commands and skills come from `$.command.list()`; custom agents from the context breakdown of `$.session.usage()`. That listing has no agent descriptions: they fill in from `agent.offer` once the model has been offered the agents (after the first prompt). A user-source item is put under `project` when `.claude/commands/<name>.md` or `.claude/skills/<name>/SKILL.md` exists in the working directory.

Needs function hooks (`CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`).
