# REVIEW.md

What a review of a claude-plugins change checks beyond the global review rules. Reviewers read this file
from the base branch (`git show origin/<base>:REVIEW.md`), so a change never judges itself by
rules it edits. Check every Focus line; check a Checklist item only when its trigger matches the
diff.

## Focus

- Anything from outside a mod (Codex output, handover notes, transcripts, model-written HTML, shell output) is data: it reaches the model, a page or Telegram only fenced or escaped, and never as instructions.
- A mod must still work where an organization manages Claude Code: `classic.*`, `session.compact` and `skill.prompt` hooks don't run there, and `cc-plugin-sec-default` can refuse `$.process.run`, `$.prompt.submit` and `$.tool.call`.
- Secrets (the Telegram token, API keys) never reach a trace, a log, a toast or an outside host: a script that reads a token turns tracing off first (`{ set +x; } 2>/dev/null`; a8136e0, 6d0cc75), and what goes to Telegram is counts and names, never command text or file content (5240041).
- Every host a mod or script reaches is in its `plugin.json` `network.hosts`; `claude plugin validate` can't see a URL held in an imported constant (1313bc8, 7272d5b, a8136e0, ac23e5c).
- State survives a hot reload and is reset by `/clear` (`.claude/rules/mods.md`).
- A decision taken after an `await` re-reads the state it depends on (a ledger, ticks, a pane) instead of trusting a read from before it, and overlapping calls (a slow look, a second press) are serialised or dropped (2b271a4, fb69e2f, bce7bf2; no diff-readable trigger).
- Handler and timer logic takes time from `$.clock.now()`, so tests' mocked clock applies; `Date.now()` is for render ticks only (0dca19b, 1e58ee9, cd6520c).
- A map keyed by user text uses `Map` or `Object.hasOwn`, so `constructor` and `__proto__` behave like any other name (6a09014).
- Shell escaping holds on bash 5.2+ (`&` in a `${x//…}` replacement means the match) and on `dash`/`busybox` (4012d06; `.claude/rules/mods.md`).
- Hooks stay inside their budgets: a Stop hook in its 10 s on 100 MB transcripts, a render hook without blocking work. `$.fs.read` rejects files over 4 MiB, so read a log's or transcript's tail (d315863); a shell hook streams one `jq` pass (39add80).
- A failing hook script prints one line on stderr (Claude Code shows only the first) and checks `jq` and `curl` before anything uses them (cc4ff3c, 51ab317).
- Band rows follow `.claude/rules/mods.md`: no `marginTop`, order only through `bandOrder` (3b58f49, 9259b17).
- Each mod installs alone: helpers are copied, not shared; a Lean-modelled function changes with its model (`diff.lean.test.ts`).
- A fix bumps the version in both manifests and adds a CHANGELOG entry (`CONTRIBUTING.md`, Updating a plugin).

## Checklist

Trigger: `paths:` globs match the diff's file names; `diff contains:` is a regex over its added and
removed lines; an item with both needs both. `\|` in this table is the regex `|`. New items need a
diff-readable trigger, a source, and either two occurrences or one miss by review
(`~/.claude/rules/review.md`). Retired IDs are not reused.

| ID | Trigger | Check | Source |
|---|---|---|---|
| CP-1 | paths: `plugins/*/hooks/**`; diff contains: `<[a-z-]+-(note\|review)\|handover-note\|neutrali\|sanitiz\|escapeHtml\|<script\|<\(?meta\|<link\|Content-Security-Policy\|securePage\|SUMMARY_CSP\|‹` | Outside text is wrapped in a fence that quoted text can't close. Near-variant tags (case, spaces, attributes), unclosed tags and the closing tag inside the payload are all neutralised. A page built by `securePage` drops model `<script>`, `<meta>` and `<link>` tags and carries a CSP. Test each variant. | 67754a5, f65f218, bccfc42 (fence variants), 59fc083, 25f43ad, c3c11b2, f87ca31, 2026-10-05..10-26 |
| CP-2 | paths: `plugins/*/hooks/**`, `plugins/*/.claude-plugin/**`; diff contains: `classic\.\|skill\.prompt\|session\.compact` | No behaviour depends on a hook that doesn't run under a managed org. Each has a replacement: `tool.call`/`command.run` for `skill.prompt`, `turn.complete` plus `$.prompt.submit` for `classic.Stop` (its refusal: CP-3), `session.start` for `classic.SessionStart`. Where none exists, the README says so. | c8d97c9, 3713ab1, 9b19693, 21aff2b, 43db507, cf108ec |
| CP-3 | paths: `plugins/*/hooks/**`; diff contains: `prompt\.submit\(\|process\.run\(\|\$\.tool\.call\(\|\.drop\b\|\.deny\b\|tryRun` | A refused engine call is handled. `$.prompt.submit` resolves `{ drop }`, `$.tool.call` resolves `{ deny }`, and `$.process.run` can reject. Each refusal frees the state it set and tells the user why (toast or log), never a bare "no pid". | 8d5c11d, 4cd6130, ac23e5c, 8249430, 2026-11-17..11-20 |
| CP-6 | paths: `plugins/*/hooks/**`; diff contains: `session\.(start\|end)\|"clear"\|/clear\|reload\|^[+-]let ` | What must outlive a hot reload lives in `$.state` and is restored, timers re-armed, in `session.start`. `/clear` (`session.end`, reason `"clear"`) resets session state but keeps work in flight, such as a pending KILL. Tests fire `session.start` again on the same state. | a0fea3d, 4bd0ac2, 2863707, 2cb9ca1, 4a886f2, d2aad14, 2026-10-14..10-20 |
| CP-7 | paths: `plugins/*/commands/**`, `plugins/*/skills/**`, `plugins/*/hooks/**`, `plugins/*/tests/**`; diff contains: `\$ARGUMENTS\|xargs\|awk -v\|--arg\|sh -c\|spawnSync\|printf '` | Each argument is its own word: `$ARGUMENTS` passed as one word is a bug, and file names never pass through `xargs`. Data that can grow goes by stdin, not argv (`awk -v`, `jq --arg`): one argument tops out at 128 KiB. | acfa62c (gtr), 84d8375 (watchdog), 39add80 (`xargs`), 2026-10-06..11-20 |
| CP-9 | paths: `plugins/*/hooks/**`; diff contains: `parseInt\|parseFloat\|Number\(\|\\d\|\[0-9\]` | Numbers parsed from text match whole and anchored: `1000%` is not `0%`, and a scan's fields are strict (`^\d+$`), so `""` or `-1` never becomes a number. | aa157e9, 87cd625, 2026-10-06..10-26 |
