# REVIEW.md

What a review of a claude-plugins change checks beyond the global review rules. Reviewers read this file
from the base branch (`git show origin/<base>:REVIEW.md`), so a change never judges itself by
rules it edits. Check every Focus line; check a Checklist item only when its trigger matches the
diff.

## Focus

- Anything from outside a mod (Codex output, handover notes, transcripts, model-written HTML, shell output) is data: it reaches the model, a page or Telegram only fenced or escaped, and never as instructions.
- A mod must still work where an organization manages Claude Code: `classic.*`, `session.compact` and `skill.prompt` hooks don't run there, and `cc-plugin-sec-default` can refuse `$.process.run`, `$.prompt.submit` and `$.tool.call`.
- Secrets (the Telegram token, API keys) never reach a trace, a log, a toast or an outside host; every host a mod or script reaches is in its `plugin.json` `network.hosts`.
- State survives a hot reload and is reset by `/clear` (`plugins/CLAUDE.md`, Mod gotchas).
- A decision taken after an `await` re-reads the state it depends on (a ledger, ticks, a pane) instead of trusting a read from before it, and overlapping calls (a slow look, a second press) are serialised or dropped (2b271a4, fb69e2f, bce7bf2; no diff-readable trigger).
- Hooks stay inside their budgets: a Stop hook in its 10 s on 100 MB transcripts, a render hook without blocking work.
- Each mod installs alone: helpers are copied, not shared; a Lean-modelled function changes with its model (`diff.lean.test.ts`).
- A fix bumps the version in both manifests and adds a CHANGELOG entry (`CLAUDE.md`, Updating a Plugin).

## Checklist

Trigger: `paths:` globs match the diff's file names; `diff contains:` is a regex over its added and
removed lines; an item with both needs both. `\|` in this table is the regex `|`. New items need a
diff-readable trigger, a source, and either two occurrences or one miss by review
(`~/.claude/rules/review.md`).

| ID | Trigger | Check | Source |
|---|---|---|---|
| CP-1 | paths: `plugins/*/hooks/**`; diff contains: `fence\|<codex-review\|handover-note\|neutrali\|sanitiz\|escapeHtml\|<script\|Content-Security-Policy` | Outside text is wrapped in a fence that quoted text can't close. Near-variant tags (case, spaces, attributes), unclosed tags and the closing tag inside the payload are all neutralised. A generated page drops model `<script>`, `<meta>` and `<link>` tags and carries a CSP. Test each variant. | 3c0346a, 5240041, 67754a5, f65f218, bccfc42, 59fc083, 25f43ad, c3c11b2, f87ca31, 2026-10-05..10-26 |
| CP-2 | paths: `plugins/*/hooks/**`, `plugins/*/.claude-plugin/**`; diff contains: `classic\.\|skill\.prompt\|session\.compact` | No behaviour depends on a hook that doesn't run under a managed org. Each has a replacement: `tool.call`/`command.run` for `skill.prompt`, `turn.complete` plus `$.prompt.submit` for `classic.Stop`, `session.start` for `classic.SessionStart`. Where none exists, the README says so. | c8d97c9, 3713ab1, 9b19693, 21aff2b, 43db507, cf108ec, 0266ef5, 2026-11-19/20 |
| CP-3 | paths: `plugins/*/hooks/**`; diff contains: `prompt\.submit\(\|process\.run\(\|\$\.tool\.call\(\|tool\.register\|\.drop\b\|\.deny\b\|tryRun` | A refused engine call is handled. `$.prompt.submit` resolves `{ drop }`, `$.tool.call` resolves `{ deny }`, and `$.process.run` can reject. Each refusal frees the state it set and tells the user why (toast or log), never a bare "no pid". A tool added with `$.tool.register` answers at `tool.run`, so permission rules hold. | 8d5c11d, c8d97c9, 4cd6130, ac23e5c, 8249430, 2026-11-17..11-20 |
| CP-4 | paths: `plugins/**`; diff contains: `TOKEN\|API_KEY\|api_key\|set [-+]x\|xtrace\|sendMessage\|api\.telegram` | A script that reads a token turns tracing off first (`{ set +x; } 2>/dev/null`), and `tests/hooks.bats` runs it with tracing on. No command text, shell output or file content goes to Telegram or another outside host, only counts and names. | a8136e0, 6d0cc75, 5240041, 2026-10-05..11-20 |
| CP-5 | paths: `plugins/*/hooks/**`, `plugins/*/commands/**`, `plugins/*/skills/**`, `plugins/*/.claude-plugin/**`; diff contains: `https\?://\|fetch\(\|curl \|network` | Every host the mod or its scripts reach is listed in `plugin.json` `network.hosts`; `claude plugin validate` doesn't check this. | 1313bc8, 7272d5b, a8136e0, ac23e5c, 2026-11-20 |
| CP-6 | paths: `plugins/*/hooks/**`; diff contains: `session\.end\|'clear'\|reload\|^[+-]let ` | What must outlive a hot reload lives in `$.state` and is restored, timers re-armed, in `session.start`. `/clear` (`session.end`, reason `clear`) resets session state but keeps work in flight, such as a pending KILL. Tests fire `session.start` again on the same state. | a0fea3d, 4bd0ac2, 2863707, 2cb9ca1, 4a886f2, d2aad14, 2026-10-14..10-20 |
| CP-7 | paths: `plugins/**`; diff contains: `\$ARGUMENTS\|xargs\|awk -v\|sh -c\|spawnSync\|printf '\|\$\{[A-Za-z_]*//` | Each argument is its own word (`$ARGUMENTS` unquoted as one is a bug). Data that can grow goes by stdin, not argv: one argument tops out at 128 KiB. File names never pass through `xargs`. Escaping holds on bash 5.2+ and on `dash`/`busybox` (rerun in docker as `plugins/CLAUDE.md` says). | acfa62c, 5d00fab, 84d8375, 39add80, 4012d06, 2026-10-06..11-20 |
| CP-8 | paths: `plugins/*/hooks/**`; diff contains: `Date\.now\|new Date\(` | Mod code takes time from `$.clock.now()`, never `Date.now()`, so tests' mocked clock applies and reload arithmetic holds. | 0dca19b, 1e58ee9, cd6520c, 2026-10-14 |
| CP-9 | paths: `plugins/*/hooks/**`; diff contains: `parseInt\|parseFloat\|Number\(\|NaN\|\\d\|\[0-9\]\|hasOwn\| in obj` | Numbers parsed from text match whole and anchored: `1000%` is not 0%, and a scan's fields are strict. NaN gets its own branch. A map keyed by user text uses `Map` or `Object.hasOwn`, so `constructor` and `__proto__` behave like any other name. | aa157e9, 87cd625, bccfc42, 6a09014, 2026-10-06..10-26 |
| CP-10 | paths: `plugins/*/hooks/**`; diff contains: `marginTop\|AbovePrompt\|bandOrder` | Band rows follow `plugins/CLAUDE.md`: `<Box flexDirection="column">{below}{row}</Box>`, keyed `band:<mod>`, no `marginTop`. Reordering goes only through the shared idempotent `bandOrder`, and tests assert on the mod's own drawn part. | 74f9ffe, 468ecda, 3b58f49, 9259b17, 2026-10-06..11-13 |
| CP-11 | paths: `plugins/*/hooks/**`; diff contains: `\$\.fs\.read\|jq -s\|slurp\|readFileSync\|tail -c\|TRANSCRIPT_PATH\|transcript_path` | Large inputs: `$.fs.read` rejects files over 4 MiB, so read a log's or transcript's tail. A shell hook streams one `jq` pass that keeps only what it prints, and never holds full tool inputs in a variable. Test with a transcript past the size. | d315863, 39add80, 2026-11-13..11-20 |
| CP-12 | paths: `plugins/telegram-notifier/**`; diff contains: `>&2\|command -v\|exit [0-9]\|jq ` | A failing hook prints one line of JSON on stderr: Claude Code shows only the first line. Dependencies (`jq`, `curl`) are checked before anything uses them. | cc4ff3c, 51ab317, 2026-11-19 |
