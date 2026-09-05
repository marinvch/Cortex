# tools/cortex-sync-skills.sh — the mirror is gitignored, so drift is invisible without --check.
#
# AGENTS.md calls this load-bearing, and the reason is on the record: on 2026-08-17 a skill written
# by a parallel session existed ONLY in the mirror. `--check` reported it as "mirror-only, left
# untouched" — the script correctly refusing to guess — and any mirror rebuild that deleted it would
# have been unrecoverable, because a gitignored directory has no history to restore from.
#
# So the test that matters most here is the one asserting a mirror-only skill SURVIVES a full sync.

. "$(dirname "${BASH_SOURCE[0]}")/_helpers.sh"   # $WORK or refuse — see the gate there

SYNC_SRC="$REPO_ROOT/tools/cortex-sync-skills.sh"

# The script resolves its root from its own location, so the fixture is a miniature checkout.
mkfixture() { # dir
  local r="$1"
  mkdir -p "$r/tools" "$r/skills" "$r/.claude/skills"
  cp "$SYNC_SRC" "$r/tools/"
  mkdir -p "$r/skills/alpha" "$r/skills/beta"
  printf -- "---\nname: alpha\n---\nalpha body\n" > "$r/skills/alpha/SKILL.md"
  printf -- "---\nname: beta\n---\nbeta body\n"   > "$r/skills/beta/SKILL.md"
}
sync() { bash "$1/tools/cortex-sync-skills.sh" "${2:-}" 2>&1; }

# --- in sync ---

R="$WORK/sync-clean"; mkfixture "$R"
cp -r "$R/skills/alpha" "$R/skills/beta" "$R/.claude/skills/"
out="$(sync "$R" --check)"
assert_contains "$out" "in sync" "a clean mirror reports in sync"
assert_exit 0 "and --check exits 0" -- bash "$R/tools/cortex-sync-skills.sh" --check

# --- a missing skill ---

R="$WORK/sync-missing"; mkfixture "$R"
cp -r "$R/skills/alpha" "$R/.claude/skills/"          # beta never mirrored
out="$(sync "$R" --check || true)"
assert_contains "$out" "missing from mirror" "a missing skill is reported"
assert_contains "$out" "beta" "and named"
assert_exit 1 "--check exits non-zero on drift, so CI could use it" -- \
  bash "$R/tools/cortex-sync-skills.sh" --check
assert_exit 1 "and --check did NOT create it — reporting is not fixing" -- test -d "$R/.claude/skills/beta"

# --- a stale skill ---

R="$WORK/sync-stale"; mkfixture "$R"
cp -r "$R/skills/alpha" "$R/skills/beta" "$R/.claude/skills/"
printf -- "---\nname: beta\n---\nSTALE\n" > "$R/.claude/skills/beta/SKILL.md"
out="$(sync "$R" --check || true)"
assert_contains "$out" "differs from canonical" "a stale skill is reported"

sync "$R" >/dev/null
assert_contains "$(cat "$R/.claude/skills/beta/SKILL.md")" "beta body" "and a sync refreshes it"

# A file deleted from canonical must not linger in the mirror — the sync replaces wholesale.
printf 'orphan\n' > "$R/.claude/skills/beta/EXTRA.md"
sync "$R" >/dev/null
assert_exit 1 "a file gone from canonical does not linger in the mirror" -- test -f "$R/.claude/skills/beta/EXTRA.md"

# --- mirror-only: reported, NEVER removed ---

R="$WORK/sync-mirroronly"; mkfixture "$R"
cp -r "$R/skills/alpha" "$R/skills/beta" "$R/.claude/skills/"
mkdir -p "$R/.claude/skills/local-only"
printf -- "---\nname: local-only\n---\nwritten by another session; exists nowhere else\n" \
  > "$R/.claude/skills/local-only/SKILL.md"

out="$(sync "$R" --check)"
assert_contains "$out" "mirror-only" "a mirror-only skill is reported"
assert_contains "$out" "local-only" "and named, so nobody 'cleans it up'"

# The one that matters: a full sync must not delete it. The mirror is gitignored, so a deletion here
# is unrecoverable — there is no history to restore from.
sync "$R" >/dev/null
assert_exit 0 "a full sync LEAVES a mirror-only skill alone" -- test -f "$R/.claude/skills/local-only/SKILL.md"
assert_contains "$(cat "$R/.claude/skills/local-only/SKILL.md")" "exists nowhere else" \
  "and leaves its contents byte-identical"

# --check must never modify the mirror at all.
R="$WORK/sync-readonly"; mkfixture "$R"
cp -r "$R/skills/alpha" "$R/.claude/skills/"
before="$(find "$R/.claude/skills" -type f -exec cat {} + | cksum)"
sync "$R" --check >/dev/null 2>&1 || true
assert_eq "$before" "$(find "$R/.claude/skills" -type f -exec cat {} + | cksum)" \
  "--check leaves the mirror byte-identical"
