# Git Commands Reference

How to obtain diffs for explanation. Used by both the `/explain` command and standalone skill invocation.

## Diff Commands

| Scope | Command |
|-------|---------|
| All changes | `git diff HEAD` (also check untracked files below) |
| Staged only | `git diff --cached` |
| Unstaged only | `git diff` |
| Last N commits | if `git rev-list --count HEAD` > N: `git diff HEAD~N..HEAD`; otherwise: `git diff $(git rev-list --max-parents=0 HEAD)..HEAD` |

**Shallow clones:** In shallow repositories, `git rev-list --count HEAD` returns only the fetched history depth, not the true count. If results look wrong, run `git rev-parse --is-shallow-repository` to check. For shallow repos, fall back to `git log --oneline | wc -l` or note the limitation to the user.
| Specific files | append `-- <paths>` to any command above |

Run `--stat` first for a quick summary, then the full diff for analysis.

**Flag combinations**: If both `--staged` and `--unstaged` are passed together, treat as default (all changes) — they cover the full working tree.

## Untracked Files

`git diff` does not show untracked (new) files at all — they only appear in `git status`. When the mode includes untracked files (default mode, or no flags):

1. Check `git status --short` for lines starting with `??`
2. **≤10 files** — Read them with the Read tool and include their contents in the explanation
3. **11+ files** — List them and ask the user which to include. If the user wants all included, summarize by directory rather than reading each file individually — reading many files into context is wasteful and may hit limits
4. Mention these are new, untracked files not yet staged for commit

## Binary Files

`git diff` shows only "Binary files differ" for binary files (images, fonts, compiled assets, archives). When you encounter these:

- Note the file changed but don't try to read contents
- Infer purpose from filename, extension, and directory context (e.g., `assets/logo.png` updated alongside CSS changes likely means a design refresh)
- If many binary files changed, group them: "5 image assets updated in `src/assets/`"
