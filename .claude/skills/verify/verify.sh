#!/usr/bin/env bash
# claude-plugins verify: the checks to run before committing a change.
#
#   .claude/skills/verify/verify.sh [auto|quick|full] [plugin...]   (default: auto)
#
#   quick  for each changed plugin: claude plugin validate; a mod also gets claude plugin test
#          and the verification/props files that import it (bun test); a shell-hook plugin
#          (tests/*.bats) gets shellcheck + bats
#   full   claude plugin validate for each changed plugin, then verification/run.sh (Lean proofs
#          and oracle, every property + differential test, every mod's tests, shellcheck + bats)
#   auto   full when a Lean-modelled file or anything under verification/ changed, else quick
#
# "Changed" = git diff against VERIFY_BASE (default: the merge base with origin/main, so a
# branch's commits count too; no merge base is a FAIL, not a fallback to HEAD), plus staged and
# untracked files. Plugin names given as arguments replace it. The checks run on the working
# tree, not on what is staged: a NOTE names the files with both staged and unstaged changes.
# One PASS/FAIL line per step; the first FAIL stops the run with the tail of that step's log.
# Exit 0 only when every step passed.
set -uo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
out="$repo/.claude/verify-logs"
export PATH="$HOME/.elan/bin:$HOME/.local/bin:$PATH" # as run.sh does
tier="${1:-auto}"

case "$tier" in auto | quick | full) shift || true ;; *)
  echo "usage: verify.sh [auto|quick|full] [plugin...]" >&2
  exit 2
  ;;
esac

cd "$repo" || exit 2
mkdir -p "$out"

fail() { # $1 = step, $2 = log, $3 = why
  echo "FAIL $1: $3"
  if [ -s "$2" ]; then
    echo "---- last 40 lines of $2"
    tail -n 40 "$2"
    if grep -qE '^\(fail\)|^not ok' "$2"; then
      echo "---- failed tests in $2"
      grep -E '^\(fail\)|^not ok' "$2" | head -n 30
    fi
  fi
  exit 1
}

step() { # $1 = name, rest = command; output goes to $out/<name>.log
  local name="$1" log="$out/$1.log" t0=$SECONDS
  shift
  if "$@" >"$log" 2>&1; then
    echo "PASS $name ($((SECONDS - t0))s)"
  else
    fail "$name" "$log" "exit $? from: $*"
  fi
}

need() {
  local t
  for t in "$@"; do
    command -v "$t" >/dev/null 2>&1 || fail deps /dev/null "$t not found on PATH"
  done
}

# The mods run.sh tests, read from its loop so a new mod is picked up here too.
mods=$(sed -n 's/^for mod in \(.*\); do$/\1/p' verification/run.sh)
[ -n "$mods" ] || fail setup /dev/null "cannot read the mod list from verification/run.sh"
is_mod() { case " $mods " in *" $1 "*) return 0 ;; esac; return 1; }

# Files with a Lean model: what diff.lean.test.ts imports, plus continuity's register.tsx,
# whose handover loop Continuity.lean mirrors by hand (verification/README.md, Limits).
lean_files=$(sed -n 's#.*from "\.\./\.\./\(plugins/[^"]*\)".*#\1#p' verification/props/diff.lean.test.ts | tr '\n' ' ')
[ -n "$lean_files" ] || fail setup /dev/null "cannot read the Lean-modelled files from diff.lean.test.ts"
lean_files="$lean_files plugins/continuity/hooks/register.tsx"

plugins=()
needs_full=""
if [ $# -gt 0 ]; then
  for p in "$@"; do
    [ -d "plugins/$p" ] || fail args /dev/null "no plugin plugins/$p"
    plugins+=("$p")
  done
  echo "plugins: ${plugins[*]} (from the arguments)"
else
  if [ -n "${VERIFY_BASE:-}" ]; then
    base=$(git rev-parse --verify --quiet "$VERIFY_BASE^{commit}") ||
      fail setup /dev/null "VERIFY_BASE=$VERIFY_BASE is not a commit"
  else
    base=$(git merge-base HEAD origin/main) ||
      fail setup /dev/null "no merge base with origin/main: git fetch origin main, or set VERIFY_BASE"
  fi
  worktree=$(git diff --name-only "$base" --) || fail setup /dev/null "git diff against $base failed"
  staged=$(git diff --cached --name-only "$base" --) || fail setup /dev/null "git diff --cached against $base failed"
  untracked=$(git ls-files --others --exclude-standard) || fail setup /dev/null "git ls-files failed"
  changed=$(printf '%s\n' "$worktree" "$staged" "$untracked" | sort -u)
  # Every check runs on the working tree, so for these files it is not what will be committed.
  index=$(git diff --cached --name-only --) || fail setup /dev/null "git diff --cached failed"
  unstaged=$(git diff --name-only --) || fail setup /dev/null "git diff failed"
  partial=$(comm -12 <(sort <<<"$index") <(sort <<<"$unstaged") | tr '\n' ' ')
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    case "$f" in
      verification/*) needs_full="$needs_full $f" ;;
      plugins/*/*)
        p="${f#plugins/}"
        p="${p%%/*}"
        if [ -d "plugins/$p" ]; then
          case " ${plugins[*]} " in *" $p "*) ;; *) plugins+=("$p") ;; esac
        fi
        ;;
    esac
    case " $lean_files " in *" $f "*) needs_full="$needs_full $f" ;; esac
  done <<<"$changed"
  marketplace=""
  grep -qx '.claude-plugin/marketplace.json' <<<"$changed" && marketplace=1
  echo "changed since ${base:0:12}: $(grep -c . <<<"$changed") files; plugins: ${plugins[*]:-none}"
  [ -n "${partial// /}" ] && echo "NOTE staged and unstaged changes in: ${partial}- the checks run on the working tree, not on what will be committed"
fi

if [ "$tier" = auto ]; then
  if [ -n "$needs_full" ]; then tier=full; else tier=quick; fi
  echo "tier: $tier"
fi
if [ "$tier" = quick ] && [ -n "$needs_full" ]; then
  echo "NOTE quick skips the Lean proofs and diff.lean.test.ts, which cover:$needs_full -> run full"
fi

if [ ${#plugins[@]} -eq 0 ] && [ -z "${marketplace:-}" ] && [ "$tier" = quick ]; then
  echo "verify: nothing to check (no plugin, marketplace or verification change)"
  exit 0
fi

need claude
for p in "${plugins[@]}"; do
  step "validate-$p" claude plugin validate "plugins/$p"
done
[ -n "${marketplace:-}" ] && step validate-marketplace claude plugin validate .

quick() {
  local p f list rc props
  for p in "${plugins[@]}"; do
    if is_mod "$p"; then
      need bun
      step "test-$p" claude plugin test "plugins/$p"
      rc=0
      list=$(cd verification || exit 2; grep -lF "/plugins/$p/" props/*.test.ts) || rc=$?
      [ "$rc" -le 1 ] || fail "props-$p" /dev/null "exit $rc listing the verification/props files that import plugins/$p"
      props=()
      while IFS= read -r f; do
        [ -n "$f" ] && [ "$f" != props/diff.lean.test.ts ] && props+=("$f")
      done <<<"$list"
      if [ ${#props[@]} -gt 0 ]; then
        [ -d verification/node_modules ] || step bun-install bash -c 'cd verification && bun install --frozen-lockfile'
        # shellcheck disable=SC2016 # $@ expands in the inner shell
        step "props-$p" bash -c 'cd verification && exec bun test "$@"' props "${props[@]/#/./}"
      else
        echo "NOTE no verification/props file imports plugins/$p"
      fi
    elif compgen -G "plugins/$p/tests/*.bats" >/dev/null; then
      need shellcheck bats
      # shellcheck disable=SC2016 # $1 expands in the inner shell
      step "shellcheck-$p" bash -c 'shopt -s globstar nullglob; shellcheck -x -P SCRIPTDIR "$1"/hooks/**/*.sh' sh "plugins/$p"
      step "bats-$p" bats "plugins/$p/tests"
    fi
  done
}

full() {
  need lake bun shellcheck bats
  step run.sh verification/run.sh
}

$tier
echo "verify: $tier passed"
