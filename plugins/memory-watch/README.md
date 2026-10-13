# memory-watch

A side pane summarizing each auto-memory file the session writes: what was created or updated, the memory's name, type and description, and how many lines changed.

```
version-bumps
09:05 created · feedback · +8 −0
Always bump the plugin version after changes

MEMORY.md (index)
09:05 updated · +1 −0
```

## Installation

```bash
claude plugin install memory-watch@vampik-plugins
```

## Behaviour

- `/memory-watch` shows or hides the pane. It docks beside the transcript in the fullscreen layout (110+ columns), inline above the prompt otherwise.
- A `memory  show` line always sits above the prompt: `show` / `hide` toggles the pane (hotkey `m` once the band has the keys, ctrl+x tab or a click). While the pane is hidden, `● N new` counts the writes since it was last open.
- Newest first, the last 50 writes of the session. The pane never opens by itself.

## How It Works

A `tool.call` hook on `Write` and `Edit` looks at each call that went through (not denied, not failed, not held for review) whose path is `…/.claude/projects/<slug>/memory/<file>.md`. The summary comes from the file's frontmatter (`name`, `description`, `type`, at any indent, so `metadata.type` counts) and the tool result's patch. No model is called.

Not seen: writes by other sessions, by hand, or through Bash (`rm`, `mv`, `sed -i`), so deletions are not listed.

Needs function hooks (`CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`).
