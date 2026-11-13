# tool-lens

Adds a line under every tool call with a colored icon, how long the call ran and roughly how many tokens it used, plus a button that expands the diff of an edit, including edits made by a shell command (Python, sed).

```
  Thought for 3s, edited 1 file +1 -1, read 1 file, ran 1 shell command
  ▤ Read b.ts · 15ms · ~45 tok
  ✎ Edit b.ts · 9ms · ~124 tok · ▾ diff +1 −1
     1 -const x = {a:1}
     1 +const x = {a:1, c:3}
  $ Bash python3 -c "import pathlib as p; f=p.Path('a.rs'); f.w… · 350ms · ~53 tok · ▸ diff +1 −1
```

Only the drawing changes: the model never sees these lines.

## Installation

```bash
claude plugin install tool-lens@vampik-plugins
```

## How It Works

- **Icon**: one glyph per kind of tool (`✎` edits, `▤` reads, `⌕` search, `$` shell, `⇣` web, `◈` agents, `◆` MCP tools), yellow while running, green when done, red on an error or interruption.
- **Duration**: Claude Code's own run time from the `PostToolUse` hook (`duration_ms`), which leaves out a permission prompt and hooks. Where that hook does not run, the mod's own wall clock around the call.
- **Tokens**: an estimate, `~N tok`, of the arguments the model wrote plus the result it read back, at about 4 characters a token. Not the API's count.
- **Diff**: the `▸ diff +N −M` toggle opens the change inline. Edit and Write diffs come from the call's stored result, so they work on a resumed session too. A Bash call's diff comes from the list of changed files Claude Code records for some models (seen on Opus, not on Haiku); without it, a Bash call has no toggle. When Claude Code lists more changed files than it gives diffs for, the toggle reads `+12 more files`, the opened diff says so, and Claude Code's own diff stays under the call. Diffs over 400 lines are cut with a count of the rest.
- **Folded groups**: in the fullscreen terminal Claude Code folds runs of calls into one summary line. The mod keeps that line and adds one line per call under it; ctrl+o shows the full rows, each with its line.
- **Older calls**: calls made before the mod loaded, or earlier in a resumed session, get their figures from the session log under `~/.claude/projects` (or `$CLAUDE_CONFIG_DIR`). The duration is the time between the call and its result being written, so it includes any approval wait, and is marked `≈`. The mod reads the log's last 4 MB (a mod can read no more in one go), so the oldest calls of a very long session stay without figures. Finding the log needs `sh`, `find` and `tail`.

## Where the toggle works

The toggle is a button, so it needs a surface that takes clicks: the fullscreen terminal (`"tui": "fullscreen"`) and the desktop app. In the terminal without fullscreen there is no toggle, and Claude Code's own diff stays under each Edit and Write.

The `PostToolUse` hooks the durations come from do not run where an organization manages Claude Code (there only plugins the organization lists run classic hooks): durations there are the mod's wall clock, which includes any approval wait.

Needs function hooks (`CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`).
