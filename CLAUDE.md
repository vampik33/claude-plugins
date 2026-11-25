# CLAUDE.md

Claude Code plugin marketplace `vampik-plugins`. Users read [README.md](README.md); the contributor workflow below is shared with humans:

@CONTRIBUTING.md

## Agent rules

- Path-scoped rules load when you touch matching files: `.claude/rules/mods.md` (mod TypeScript, `verification/`) and `.claude/rules/shell-hooks.md` (telegram-notifier).
- Before every commit that touches `plugins/`, `verification/` or `.claude-plugin/`, run the `verify` skill.

## Running checks

- One target: `claude plugin test plugins/<mod>`; `(cd verification && bun test props/<mod>)`; `bats plugins/telegram-notifier/tests`.
- `run.sh` stops at the first failing suite (`set -e`); fix it and rerun before reading later suites as passing.
- Without Lean (`lake`) installed, `run.sh` stops at the Lean step and `diff.lean.test.ts` fails with "no oracle"; run the other suites one target at a time.
- Without `bats`/`shellcheck` installed: `npm i --prefix <scratch-dir> bats shellcheck`, then run both from `<scratch-dir>/node_modules/.bin`.

## Gotchas

- claudemd-gen, explain-changes, gtr and plan-renamer are command+skill only (plan-renamer's ExitPlanMode hook was removed in v1.2.0).
- gtr's CHANGELOG.md starts at 1.0.1: changes before it were not recorded.
- **Daily-review issues and PRs** (`Daily review <date>` issue, branch `daily-review/<date>-main`) are made remotely without a checkout: before merging, rebase onto `main`, add a test, and apply the "Updating a plugin" steps. The repo doesn't delete merged branches.
