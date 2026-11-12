# big-picture

When a piece of work in the session turns out big, a visual HTML summary of it (diagrams, file and call trees, in the style of HumanLayer's [show-me](https://github.com/humanlayer/skills/tree/main/plugins/show-me) skill) is written to a page you open in your browser, and keeps up while the work goes on.

The page, top to bottom:

```
Title
In short          2-3 plain sentences: what was done and why
At a glance       number tiles + bar chart of the most edited files (counted by the mod)
1. <piece>        diagrams, tables, text sketches of what was done
   In simple words   a big emoji picture + 2-4 plain sentences, no jargon
2. …
Still open / next a table, each row with its status
```

```
summary  ● writing…  show  update          a check is running
summary  updated 09:05  show  update       the page is current
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

- `/big-picture` opens the summary in the default browser (`xdg-open`, else `open` on macOS); so does `show` on the `summary` line above the prompt (hotkey `s`). The line appears once there is something to show: a summary being written, written, or failing; while Jev only judges work that has no summary yet, it stays hidden. Before there is a summary, `/big-picture` opens a placeholder that fills in later. The page never opens by itself, and is closed in the browser. When no browser opens it, the mod says so with the page's path.
- `/big-picture update`, or `update` on the `summary` line (hotkey `u`), rewrites the summary now: no Jev question, even before the work was judged big (which it counts as from then on). A press while a check runs is run once after it; several presses meanwhile, once.
- The page is `~/.claude/big-picture/<session-id>.html`. An open page reloads itself every 60 seconds, so a rewrite shows within a minute.

## How It Works

Every tool call that goes through (subagents' too) is logged: files written or edited, commands run, agents started. A check runs every 10 tool calls and when a turn ends; a turn that changed no file is never checked. A progress check runs every 30 minutes, for long-running background shells (step 3).

1. **Is it big?** Until the session's work is judged big, Jev (TypeSafe's classifier, `POST api.typesafe.ai/v1/systemone`) gets one yes/no question over the turn's prompt and log. At p ≥ 0.5 the work is big and the first page is written.
2. **Does it need an update?** From then on Jev is asked whether the work since the last page changed the picture; at p ≥ 0.5 the page is rewritten. Work it turns down still counts toward the next question. During a turn, rewrites are at least 5 minutes apart (a check inside the gap asks nothing and keeps the work for later); a turn's end may always rewrite.
3. **Is there progress?** Every 30 minutes, once a summary exists, the background shells still running are found in the transcript (a Bash call whose record names the background task it became, with no task notification for it since) and the last 2 KB of each one's `tasks/<id>.output` file is read. When that output moved since the last look, Jev is asked, over the commands alone, whether their progress is worth a rewrite; at p ≥ 0.5 Haiku rewrites the page with the output. The output never goes to Jev (TypeSafe), only to Haiku. A no is not asked again on the same output; a failed ask or write is. A long *foreground* command's output cannot be read until it ends.
4. **Writing** is Haiku (`$.model.complete`, 32k tokens and 5 minutes at most): show-me's guidance and the page's contract as a cached system prompt, the transcript as a digest (what was typed, said and run: the newest 60k characters), the session's numbers counted from the whole transcript (main conversation only), the previous summary to update (its `<style>` dropped), and the commands still running with the end of their output. The page gets the mod's own stylesheet, so Haiku writes no CSS. Mermaid comes from jsDelivr, pinned; a diagram that fails to parse shows its source text. The page runs no script of Haiku's: its scripts, `<meta>` and `<link>` tags are stripped, and a Content-Security-Policy lets only the mod's Mermaid loader and Mermaid's own files run. The page's only `<meta>` refresh is the mod's own.

Each check costs a Jev call; only a yes costs a Haiku call. Needs function hooks (`CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`).

show-me's text is HumanLayer's, MIT: [`licenses/show-me.LICENSE`](licenses/show-me.LICENSE).
