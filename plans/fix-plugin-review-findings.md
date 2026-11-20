# Fix the plugin-conventions / sec-default review findings

Source: the 2026-11-20 review of every plugin in this repo against Claude Code 2.1.329's plugin-authoring reference and `claude-code.d.ts` (types file below = `$SKILL/types/claude-code.d.ts`).

Each changed plugin gets a patch bump in `plugin.json` **and** `.claude-plugin/marketplace.json`, a CHANGELOG `Fixed`/`Changed` entry dated 2026-11-20, and a test for the new behaviour. One commit per plugin: `fix(<plugin>): … (vX.Y.Z)`.

## Changes

### 1. codex-review 0.3.12 → 0.3.13
- **Serve `CodexReview` at `tool.run`, not `tool.call`** (`hooks/register.tsx:504`). Types 3714-3716: `tool.call` runs *ahead of the permission check*, so no deny/ask rule can stop the model starting a review that ships the diff to OpenAI. `tool.run` fires only for an allowed call, input is the same `ToolCallInput`, answer shape `{ result, isError? }` is the same. Add the guard the `tool.run` doc recommends: `.catch(($, e, next) => next.called ? next(e) : { result: "codex-review failed", isError: true })` (a failed guard otherwise lets the call through to "no hook answered").
  - Behaviour change: users not in bypass/auto mode now get a permission prompt for `mcp__codex-review__CodexReview` (or allow it in settings). README: say so.
- **`send()` checks `.drop`** (`:673-676`): toast the reason when the prompt is refused.
- **Reset `sessionHead` on `/clear`** (`plugins/CLAUDE.md`: `/clear` fires `session.end` `reason: 'clear'`, no `session.start`): new `session.end` hook sets `sessionHead` to the current HEAD. Jobs stay, so `/cx last` still opens the last review.
- Tests: a `tool.check` hook answering `{ deny }` ⇒ no job started (a mod's own `$.tool.call` turns asks into allows, so a deny hook is how the test stands in for a rule); `.drop` toast; `/clear` moves the head and keeps jobs.

### 2. fleet 0.6.0 → 0.6.1
- **`stopShell` handles `{ deny }`** (`hooks/register.tsx:294-298`): a refused `$.tool.call` *resolves* `{ deny }` (types 3667), it does not reject. Toast `fleet: could not stop <id>: <reason>` for deny / `isError` / rejection.
- **Declare `"network": { "hosts": ["api.telegram.org"] }`** in `plugin.json` (`$.http.fetch` at `register.tsx:72-88`).
- Test: TaskStop denied ⇒ toast with the reason.

### 3. telegram-notifier 1.9.5 → 1.9.6
- **Token never under xtrace**: drop `set -x` from `send-telegram.sh` entirely (its debug mode already echoes payload and response), which is sturdier than ordering it around every token use. Check `check-credentials.sh` / `session-notification.sh` (they `exec 2>&1` into hook output) expand no token while tracing.
- **Quote `${CLAUDE_PLUGIN_ROOT}`** in the three `hooks.json` commands (validator warning ×3).
- **curl finishes inside the Stop hook's 10 s**: `curl --connect-timeout 5 -m 8` so the script, not the hook timeout, reports a slow send.
- **`/telegram` passes the message through a single-quoted heredoc** (`commands/telegram.md:15`), not `${ARGUMENTS:-…}` in a double-quoted string (shell-injection path, and `$ARGUMENTS` inside `${…}` is not substituted).
- **Skill `name: telegram-messaging`** (matches its folder).
- **Declare `"network": { "hosts": ["api.telegram.org"] }`**.
- README: the automatic notifications are classic hooks, which don't run where an organization allows only managed hooks; `/telegram` still works.
- Tests (bats): with `TELEGRAM_NOTIFIER_DEBUG=1` and a stubbed curl, stderr of each script never contains the token; hooks.json commands are quoted.

### 4. continuity 0.4.3 → 0.4.4
- **Check `.drop`** on both `$.prompt.submit` calls (`hooks/register.tsx:232`, `:253`), as fix-findings `sendBack` does: on a drop, toast the reason and return "compacted; the continue prompt was refused: <reason>" instead of "continuing". Wrap the `$.clock.after` callback (`:249-256`) in try/catch.
- **Read `promptCacheTtl` with `$.settings.read({ key: "promptCacheTtl" })`** (types 4361+) instead of hand-parsing three files (`:94-112`), so managed policy and `--settings` count. `decideTtl`'s input is unchanged (Lean model untouched).
- **No `~` directory when `HOME` is unset** (`:190`): throw, so the existing "Handover failed: …" path reports it.
- Tests: dropped continue prompt ⇒ toast + honest message; dropped resume prompt ⇒ toast; setting read from `$.settings` (incl. policy layer); missing HOME ⇒ failure, nothing written.

### 5. effort-pilot 0.3.1 → 0.3.2
- **Declare `"network": { "hosts": ["api.typesafe.ai"] }`** (validator can't see it: `JEV_URL` is an imported constant).
- **Respect `maxEffortLevel`**: types 18418 documents no clamp on a `turn.step` rewrite, so clamp the level Jev asks for to the `maxEffortLevel` setting before sending. Read the cap once per turn at `turn.start` (beside the existing `configuredLevel` settings read), not per step; pure `clampEffort` in `core.ts` + prop test. Numbers pass through (public builds refuse them anyway).
- Tests: cap `high` + Jev `max` ⇒ step sent at `high`; no cap ⇒ unchanged.

### 6. big-picture 0.5.3 → 0.5.4
- **Declare `"network": { "hosts": ["api.typesafe.ai", "cdn.jsdelivr.net"] }`**.
- **No predictable `/tmp/.claude/big-picture/<id>.html` when `HOME` is unset** (`hooks/register.tsx:76`): throw, so writing the page fails through the existing error path instead of a world-writable dir.
- Test: missing HOME ⇒ no page written.

### 7. watchdog 0.4.0 → 0.4.1
- **No "stopped" claim with nothing to kill** (`hooks/register.tsx:57-77`, `core.ts:383`): when `killTargets(r)` is empty and TaskStop didn't stop it, toast "could not stop: no pid yet" and skip the bare `kill`.
- **`.catch(($, e, next) => next(e))`** on the observing `tool.call{Bash}` and `session.append` hooks (`:209`, `:257`; reference.md: a failed gate hook is skipped).
- Not changed: the `kill` fallback when TaskStop is refused. Killing stuck runs is watchdog's job and its foreground path already kills directly; TaskStop is only the tidy route.
- Tests: stuck run without pid ⇒ no kill, "could not stop" toast.

### 8. fix-findings 0.2.2 → 0.2.3
- Add `"types": "./types/index.d.ts"` to `plugin.json` (it declares `PluginState`).
- `.catch(($, e, next) => next(e))` on the `prompt.submit` hook (`hooks/register.ts:35`).
- Replace stale "Stop hook" wording (hook is `turn.complete` since 0.2.2): `plugin.json` description, `.claude-plugin/marketplace.json` description, `README.md:32`, `skills/fix-findings/SKILL.md:79,104`.

### 9. palette 0.5.1 → 0.5.2
- `$.session.root()` gets `.catch` like its neighbours (`hooks/register.tsx:63`), falling back to `$.session.cwd()`.
- Test: root rejects ⇒ `/palette` still opens.

### 10. gtr 1.0.1 → 1.0.2
- `commands/new.md:21`, `run.md:21` (and any other `"$ARGUMENTS"` in a step): tell the model to pass the branch and each flag as separate arguments, not `"$ARGUMENTS"` as one word.

### 11. plugins/CLAUDE.md
- One gotcha line: a tool added with `$.tool.register` is served at `tool.run` so permission rules apply (`tool.call` runs ahead of them), and a mod's `$.tool.call` resolves `{ deny }` rather than rejecting.

### 12. Marketplace
- Drop `metadata.homepage` from `.claude-plugin/marketplace.json` (validator: unknown field, ignored). Commit `chore(marketplace): …`.

## Dropped while implementing
- **watchdog (item 7), whole item**: `isStuck` and `needsKill` (`core.ts:361-371`) require `r.pid !== undefined`, so `stop()` never runs without a pid. The `.catch` on its observing hooks changes nothing: reference.md:126 says a failed hook "is skipped and the chain continues without it", which is what `.catch(($, e, next) => next(e))` does for a hook that only observes. No version bump.
- **fix-findings `.catch` on `prompt.submit`**: same reason; the rest of item 8 shipped.

## Not changed, and why
- **Icons** (all 17, ICON_MISSING): needs artwork; only matters for directory submission, and the first submitted icon sticks. Your call.
- **TS5097 on `.ts` imports**: the validator ignores the mods' `tsconfig.json` (`allowImportingTsExtensions`); tsc and the engine are fine.
- **`skill:` key in 13 command files**: undocumented in this build, effect unknown; removing it could change behaviour I can't observe.
- **chat-view turn keyed by `durationMs`**: refuted, `TurnDuration` props carry only `durationMs` (types 12968), so it is the only join key.
- **big-picture module variables**: deliberate, commented, rebuilt from `$.state` in `restore()`.
- **ship / codex-review `network.hosts`**: they reach the network only through child programs (`git push`, the codex CLI), whose hosts depend on the user's remotes and login; the types file lists process children as unread.
- **codex-review PID reuse**: only signals jobs still marked running, after `kill -0`.

## Verification
- Per plugin: `claude plugin validate plugins/<p>` (read whole output; the fixed warnings gone), `claude plugin test plugins/<p>`, tsc against the 2.1.329 types; bats for telegram-notifier.
- New tests fail on the old code once (stash-free: run them against `git show HEAD:<file>` copies in the scratchpad) before trusting their pass.
- Then `verification/run.sh` in full, exit code read from a file.
- Not reachable here: a live sec-default / managed-policy session. Manual check after install: `claude --plugin-dir plugins/codex-review` in default mode, ask for a Codex review ⇒ a permission prompt appears; deny ⇒ no `~/.cache/codex-review/<id>` dir.

## Rollback
Each plugin is one commit; `git revert <sha>` and re-bump, or users `claude plugin update` to the previous tag.
