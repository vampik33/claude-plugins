#!/usr/bin/env bats
# verify.sh's change discovery, in a throwaway repo with claude, bun, lake, shellcheck and bats
# stubbed: each stub logs its argv to $calls and exits 0.

setup() {
  tmp="$(mktemp -d)"
  export HOME="$tmp/home" GIT_CONFIG_NOSYSTEM=1
  export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@example.com GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@example.com
  unset VERIFY_BASE
  calls="$tmp/calls"
  mkdir -p "$HOME" "$tmp/bin"
  for t in claude bun lake shellcheck bats; do
    printf '#!/bin/sh\necho "%s $*" >>"%s"\n' "$t" "$calls" >"$tmp/bin/$t"
    chmod +x "$tmp/bin/$t"
  done
  export PATH="$tmp/bin:$PATH"

  repo="$tmp/repo"
  verify="$repo/.claude/skills/verify/verify.sh"
  mkdir -p "$repo/.claude/skills/verify" "$repo/verification/props" "$repo/plugins/palette/hooks" "$repo/plugins/other/hooks"
  cp "$BATS_TEST_DIRNAME/../verify.sh" "$verify"
  printf '#!/bin/sh\nfor mod in palette other; do\n  :\ndone\n' >"$repo/verification/run.sh"
  chmod +x "$repo/verification/run.sh"
  echo 'import { f } from "../../plugins/palette/hooks/core.ts";' >"$repo/verification/props/diff.lean.test.ts"
  echo 'export const f = 1;' >"$repo/plugins/palette/hooks/core.ts"
  echo 'export const g = 1;' >"$repo/plugins/palette/hooks/util.ts"
  echo 'export const h = 1;' >"$repo/plugins/other/hooks/core.ts"
  echo '.claude/' >"$repo/.gitignore"
  git -C "$repo" init -q -b main
  git -C "$repo" add .
  git -C "$repo" commit -qm base
  git init -q --bare "$tmp/origin.git"
  git -C "$repo" remote add origin "$tmp/origin.git"
  git -C "$repo" push -q origin main
}

teardown() {
  chmod -R u+rwX "$tmp"
  rm -rf "$tmp"
}

@test "an invalid VERIFY_BASE fails setup" {
  VERIFY_BASE=nonexistent run "$verify"
  [ "$status" -ne 0 ]
  [[ "$output" == *"FAIL setup"* ]]
  [[ "$output" != *"nothing to check"* ]]
}

@test "without origin/main or VERIFY_BASE setup fails instead of diffing against HEAD" {
  echo 'export const f = 2;' >"$repo/plugins/palette/hooks/core.ts"
  git -C "$repo" commit -qam change
  git -C "$repo" update-ref -d refs/remotes/origin/main
  run "$verify"
  [ "$status" -ne 0 ]
  [[ "$output" == *"FAIL setup"* ]]
  [[ "$output" != *"nothing to check"* ]]
}

@test "a valid VERIFY_BASE is used" {
  echo 'export const g = 2;' >"$repo/plugins/palette/hooks/util.ts"
  git -C "$repo" commit -qam change
  VERIFY_BASE=HEAD~1 run "$verify"
  [ "$status" -eq 0 ]
  [[ "$output" == *"plugins: palette"* ]]
}

@test "a committed branch change to a Lean-modelled file picks full" {
  git -C "$repo" switch -qc topic
  echo 'export const f = 2;' >"$repo/plugins/palette/hooks/core.ts"
  git -C "$repo" commit -qam change
  run "$verify"
  [ "$status" -eq 0 ]
  [[ "$output" == *"plugins: palette"* ]]
  [[ "$output" == *"tier: full"* ]]
  grep -qx 'claude plugin validate plugins/palette' "$calls"
}

@test "a clean branch has nothing to check" {
  run "$verify"
  [ "$status" -eq 0 ]
  [[ "$output" == *"nothing to check"* ]]
}

@test "a staged change whose working copy matches the base is found, with a NOTE" {
  echo 'export const f = 2;' >"$repo/plugins/palette/hooks/core.ts"
  git -C "$repo" add plugins/palette/hooks/core.ts
  git -C "$repo" show HEAD:plugins/palette/hooks/core.ts >"$repo/plugins/palette/hooks/core.ts"
  [ -n "$(git -C "$repo" diff --cached --name-only)" ]
  [ -z "$(git -C "$repo" diff --name-only HEAD)" ]
  run "$verify"
  [ "$status" -eq 0 ]
  [[ "$output" == *"plugins: palette"* ]]
  [[ "$output" != *"nothing to check"* ]]
  [[ "$output" == *"NOTE"*"plugins/palette/hooks/core.ts"*"working tree"* ]]
}

@test "a staged new file deleted from the working tree is found" {
  echo 'export const n = 1;' >"$repo/plugins/palette/hooks/new.ts"
  git -C "$repo" add plugins/palette/hooks/new.ts
  rm "$repo/plugins/palette/hooks/new.ts"
  run "$verify"
  [ "$status" -eq 0 ]
  [[ "$output" == *"plugins: palette"* ]]
  [[ "$output" == *"NOTE"*"plugins/palette/hooks/new.ts"* ]]
}

@test "a fully staged change gets no staged/unstaged NOTE" {
  echo 'export const g = 2;' >"$repo/plugins/palette/hooks/util.ts"
  git -C "$repo" add plugins/palette/hooks/util.ts
  run "$verify"
  [ "$status" -eq 0 ]
  [[ "$output" == *"plugins: palette"* ]]
  [[ "$output" != *"working tree"* ]]
}

@test "a mod's props files, except diff.lean.test.ts, get bun test" {
  echo 'import { f } from "../../plugins/palette/hooks/core.ts";' >"$repo/verification/props/palette.prop.test.ts"
  run "$verify" quick palette
  [ "$status" -eq 0 ]
  grep -qx 'bun test ./props/palette.prop.test.ts' "$calls"
}

@test "a mod no props file imports gets a NOTE and passes" {
  run "$verify" quick other
  [ "$status" -eq 0 ]
  [[ "$output" == *"NOTE no verification/props file imports plugins/other"* ]]
}

@test "a grep error listing the props files fails instead of skipping them" {
  [ "$(id -u)" -ne 0 ] || skip "root reads a mode-000 file"
  echo 'import { f } from "../../plugins/palette/hooks/core.ts";' >"$repo/verification/props/palette.prop.test.ts"
  chmod 000 "$repo/verification/props/palette.prop.test.ts"
  run "$verify" quick palette
  [ "$status" -ne 0 ]
  [[ "$output" == *"FAIL props-palette"* ]]
  [[ "$output" != *"NOTE no verification/props file"* ]]
}
