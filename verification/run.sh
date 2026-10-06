#!/usr/bin/env bash
# Every check: Lean proofs and oracle, property + differential tests, the mods'
# own tests, and telegram-notifier's shellcheck + bats.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(dirname "$here")"
export PATH="$HOME/.elan/bin:$HOME/.local/bin:$PATH"

echo "== lean: proofs + oracle"
build="$(cd "$here/lean" && lake build 2>&1)" || { echo "$build"; exit 1; }
if grep -rqw sorry "$here/lean/Plugins" "$here/lean/Oracle.lean" || grep -q "declaration uses 'sorry'" <<<"$build"; then
  echo "a proof uses sorry"
  exit 1
fi
echo "ok"

echo "== property + differential tests"
(cd "$here" && bun install --frozen-lockfile >/dev/null && bun test props)

for mod in codex-review continuity fleet prompt-clock; do
  echo "== claude plugin test $mod"
  claude plugin test "$root/plugins/$mod"
done

echo "== telegram-notifier: shellcheck + bats"
tg="$root/plugins/telegram-notifier"
shellcheck -x -P SCRIPTDIR "$tg"/hooks/scripts/*.sh "$tg"/hooks/scripts/lib/*.sh
bats "$tg/tests"
