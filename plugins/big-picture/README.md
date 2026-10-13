# big-picture

When a piece of work in the session turns out big, a visual HTML summary of it (diagrams, file and call trees, in the style of HumanLayer's [show-me](https://github.com/humanlayer/skills/tree/main/plugins/show-me) skill) appears in an Orca browser tab beside the terminal (outside Orca, as text in a terminal pane), and keeps up while the work goes on.

```
summary  ● writing…  show  update          a check is running
summary  updated 09:05  hide  update       the page is current; its tab is open
summary  ✗ Jev answered HTTP 401  show  update
```

## Installation

```bash
claude plugin install big-picture@vampik-plugins
```

Set a TypeSafe key for Jev, in `~/.claude/settings.json`:

```json
{ "env": { "TYPESAFE_API_KEY": "…" } }
```

## Behaviour

- `/big-picture` shows or hides the summary's Orca browser tab; so does the `summary  show` line above the prompt (hotkey `s`). The line appears once there is something to show: a summary being written, written, or failing; while Jev only judges work that has no summary yet, it stays hidden. Before there is a summary, `/big-picture` opens a placeholder that fills in later, and the line shows while it is open so it can be hidden. The tab never opens by itself. A press while a show or hide is under way is dropped.
- `/big-picture update`, or `update` on the `summary` line (hotkey `u`), rewrites the summary now: no Jev question, even before the work was judged big (which it counts as from then on). A press while a check runs is run once after it; several presses meanwhile, once.
- A tab closed in Orca by hand turns the button back to `show` within about 10 seconds (the mod looks for its tab in `orca tab list` every 2 seconds while one is open; Orca takes about 8 seconds to answer when no browser tab is left).
- The page is `~/.claude/big-picture/<session-id>.html`. Each rewrite reloads the open tab.
- Outside Orca (`TERM_PROGRAM` is not `Orca`) there is no browser: Haiku writes the summary as text instead (headings, short paragraphs, and diagrams and trees drawn in text, no line of a diagram over 60 characters), and `/big-picture` or the `summary` line opens and closes it in a terminal pane. Nothing is written to disk.

## How It Works

Every tool call that goes through (subagents' too) is logged: files written or edited, commands run, agents started. A check runs every 10 tool calls and when a turn ends; a turn that changed no file is never checked. A progress check runs every 30 minutes, for long-running background shells (step 3).

1. **Is it big?** Until the session's work is judged big, Jev (TypeSafe's classifier, `POST api.typesafe.ai/v1/systemone`) gets one yes/no question over the turn's prompt and log. At p ≥ 0.5 the work is big and the first page is written.
2. **Does it need an update?** From then on Jev is asked whether the work since the last page changed the picture; at p ≥ 0.5 the page is rewritten. Work it turns down still counts toward the next question. During a turn, rewrites are at least 5 minutes apart (a check inside the gap asks nothing and keeps the work for later); a turn's end may always rewrite.
3. **Is there progress?** Every 30 minutes, once a summary exists, the background shells still running are found in the transcript (a Bash result that moved its command to the background, with no task notification for it since) and the last 2 KB of each output file is read. When that output moved since the last look, Jev is asked whether it changed the picture; at p ≥ 0.5 the page is rewritten. A no is not asked again on the same output; a failed ask or write is. A long *foreground* command's output cannot be read until it ends.
4. **Writing** is Haiku (`$.model.complete`, 16k tokens at most): show-me's guidance and the page's contract as a cached system prompt, the transcript as a digest (what was typed, said and run: the newest 60k characters), and the previous summary to update, and the commands still running with the end of their output. Mermaid comes from jsDelivr, pinned. The page runs no script of Haiku's: its scripts, `<meta>` and `<link>` tags are stripped, and a Content-Security-Policy lets only the mod's Mermaid loader and Mermaid's own files run. The text summary has its escape sequences and control characters stripped.

Each check costs a Jev call; only a yes costs a Haiku call. Needs function hooks (`CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`).

show-me's text is HumanLayer's, MIT: [`licenses/show-me.LICENSE`](licenses/show-me.LICENSE).
