# tools/cortex-sync-skills.sh — the mirror is gitignored, so drift is invisible without --check.
#
# AGENTS.md calls this load-bearing, and the reason is on the record: on 2026-08-17 a skill written
# by a parallel session existed ONLY in the mirror. `--check` reported it as "mirror-only, left
# untouched" — the script correctly refusing to guess — and any mirror rebuild that deleted it would
# have been unrecoverable, because a gitignored directory has no history to restore from.
#
# So the test that matters most here is the one asserting a mirror-only skill SURVIVES a full sync.
#
# Since the ledger landed, "mirror-only" is three situations, not one, and only the first may ever
# be removed: a directory this tool wrote that canonical has since deleted (its deletion is in git),
# the same but edited here afterwards, and one nothing recorded at all. The last is the 2026-08-17
# case above and the default every unknown falls back to.

. "$(dirname "${BASH_SOURCE[0]}")/_helpers.sh"   # $WORK or refuse — see the gate there

SYNC_SRC="$REPO_ROOT/tools/cortex-sync-skills.sh"

# The script resolves its root from its own location, so the fixture is a miniature checkout.
# _cortex-lib.sh comes too: the script sources it for resolve_in_root, and a fixture without it
# would test a tool that cannot start.
mkfixture() { # dir
  local r="$1"
  mkdir -p "$r/tools" "$r/skills" "$r/.claude/skills"
  cp "$SYNC_SRC" "$REPO_ROOT/tools/_cortex-lib.sh" "$r/tools/"
  mkdir -p "$r/skills/alpha" "$r/skills/beta"
  printf -- "---\nname: alpha\n---\nalpha body\n" > "$r/skills/alpha/SKILL.md"
  printf -- "---\nname: beta\n---\nbeta body\n"   > "$r/skills/beta/SKILL.md"
}
sync() { local d="$1"; shift; bash "$d/tools/cortex-sync-skills.sh" "$@" 2>&1; }
STATE_REL=".claude/skills/.cortex-sync-state"

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
assert_contains "$out" "not mirrored by this tool" "and classified as not ours, since nothing recorded it"

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
assert_exit 1 "and --check writes no ledger either — read-only means read-only" -- \
  test -e "$R/$STATE_REL"

# --- the root guard on the deletion ------------------------------------------
#
# `${DST:?}` proves the variable is non-empty and resolves nothing. If .claude/skills is a symlink
# out of the repo, every `rm -rf` in the sync loop lands outside the root. ADR 0010 is the rule;
# this is the tool that broke it.
#
# Probe the RESULT of `ln -s`, not its exit status: on Git Bash without winsymlinks it succeeds and
# silently copies, so there is no escape on disk to refuse. cortex-rm.test.sh skips at that point.
# Here it is worth one more try — .claude/skills is a Windows path for most of the people who have
# one, so skipping on Windows would skip the case on the platform it matters most. A junction needs
# no privilege, Git Bash reports it as -L, and `pwd -P` resolves through it, which is exactly the
# escape the guard must refuse.
link_dir() { # target linkpath -> 0 if a real link now exists at linkpath
  ln -s "$1" "$2" 2>/dev/null || true
  [ -L "$2" ] && return 0
  rm -rf "$2"                       # ln copied instead; clear the copy before trying the fallback
  command -v cmd.exe >/dev/null 2>&1 || return 1
  command -v cygpath >/dev/null 2>&1 || return 1
  MSYS_NO_PATHCONV=1 cmd.exe /c "mklink /J $(cygpath -w "$2") $(cygpath -w "$1")" >/dev/null 2>&1 || true
  [ -L "$2" ]
}

R="$WORK/sync-symlink"; mkfixture "$R"
rm -rf "$R/.claude/skills"
mkdir -p "$WORK/sync-outside/victim"
printf 'not ours to delete\n' > "$WORK/sync-outside/victim/SKILL.md"
# alpha shares a name with a canonical skill on purpose: that is the directory the sync loop would
# have replaced wholesale, so it is the one the escape destroys.
mkdir -p "$WORK/sync-outside/alpha"
printf 'not ours — a directory outside the repo that happens to be called alpha\n' \
  > "$WORK/sync-outside/alpha/SKILL.md"
# Fingerprint the whole outside tree, not "did alpha survive". Verified against the pre-fix script:
# it deleted $WORK/sync-outside/alpha and then `cp -r`'d canonical into the hole, so the FILE still
# existed afterwards with someone else's contents. An existence check passes for that. This is the
# symptom-versus-property trap docs/changing-cortex.md names, and the escape walks straight into it.
outside_print() { find "$WORK/sync-outside" | LC_ALL=C sort; find "$WORK/sync-outside" -type f -exec cat {} + ; }

if link_dir "$WORK/sync-outside" "$R/.claude/skills"; then
  before_outside="$(outside_print | cksum)"
  out="$(sync "$R" || true)"
  assert_contains "$out" "outside the repo root" "a mirror symlinked out of the repo is refused"
  assert_eq "$before_outside" "$(outside_print | cksum)" \
    "and the tree outside the root is byte-identical — not deleted, not overwritten"
  assert_contains "$(cat "$WORK/sync-outside/alpha/SKILL.md")" "not ours" \
    "the directory sharing a canonical skill's name still holds its own content"
else
  echo "  skip  symlinked-mirror case (this host creates neither a symlink nor a junction)"
fi

# --- the ledger: what this tool wrote, and what it did not --------------------

R="$WORK/sync-ledger"; mkfixture "$R"
sync "$R" >/dev/null
assert_exit 0 "a sync writes its ledger inside the gitignored mirror" -- test -f "$R/$STATE_REL"
assert_contains "$(cat "$R/$STATE_REL")" "alpha" "and records what it mirrored"

# The ledger must never reach git. Assert against the real repo's ignore rules, not the fixture's —
# the fixture has no .gitignore and would pass for the wrong reason.
assert_exit 0 "and that path is gitignored in this repo" -- \
  git -C "$REPO_ROOT" check-ignore -q "$STATE_REL"

# (a) canonical deletes a skill this tool mirrored. Recoverable: the deletion is in git.
rm -rf "$R/skills/beta"
out="$(sync "$R" --check || true)"
assert_contains "$out" "mirrored by this tool" "a skill we mirrored, then deleted upstream, is identified as ours"
assert_contains "$out" "beta" "and named"
assert_exit 0 "and is STILL not removed by a plain sync — removal stays opt-in" -- \
  test -f "$R/.claude/skills/beta/SKILL.md"
sync "$R" >/dev/null
assert_exit 0 "nor by the sync that follows" -- test -f "$R/.claude/skills/beta/SKILL.md"

# ...and the classification survives the sync that carried the record forward.
out="$(sync "$R" --check || true)"
assert_contains "$out" "mirrored by this tool" "the record is carried forward, not dropped when canonical loses the skill"

# The opt-in flag removes exactly that category.
sync "$R" --prune-mirrored >/dev/null
assert_exit 1 "--prune-mirrored removes a directory this tool wrote that canonical deleted" -- \
  test -d "$R/.claude/skills/beta"
assert_exit 0 "and leaves the skills canonical still has" -- test -f "$R/.claude/skills/alpha/SKILL.md"
assert_not_contains "$(cat "$R/$STATE_REL")" "beta" "and drops the pruned entry from the ledger"

# (b) a directory this tool never wrote. The 2026-08-17 case: it exists nowhere else.
R="$WORK/sync-notours"; mkfixture "$R"
sync "$R" >/dev/null
mkdir -p "$R/.claude/skills/local-only"
printf 'written by a parallel session; exists nowhere else\n' > "$R/.claude/skills/local-only/SKILL.md"
out="$(sync "$R" --check || true)"
assert_contains "$out" "not mirrored by this tool" "a directory the tool never wrote is classified as not ours"
sync "$R" --prune-mirrored >/dev/null
assert_exit 0 "and --prune-mirrored REFUSES it — the flag only ever removes what the ledger claims" -- \
  test -f "$R/.claude/skills/local-only/SKILL.md"
assert_contains "$(cat "$R/.claude/skills/local-only/SKILL.md")" "exists nowhere else" \
  "byte-identical, not rewritten"

# (c) we wrote it, canonical deleted it, but someone has edited it since. The digest is what tells
# these apart; without it, local work inside a directory we happened to mirror would be thrown away.
R="$WORK/sync-drift"; mkfixture "$R"
sync "$R" >/dev/null
rm -rf "$R/skills/beta"
printf -- "---\nname: beta\n---\nEDITED BY HAND after we mirrored it\n" > "$R/.claude/skills/beta/SKILL.md"
out="$(sync "$R" --check || true)"
assert_contains "$out" "mirrored then edited here" "a mirrored directory edited since is reported as drifted"
sync "$R" --prune-mirrored >/dev/null
assert_exit 0 "and --prune-mirrored refuses anything drifted" -- test -f "$R/.claude/skills/beta/SKILL.md"
assert_contains "$(cat "$R/.claude/skills/beta/SKILL.md")" "EDITED BY HAND" "the local edit survives"

# --- the ledger fails closed -------------------------------------------------
#
# The failure to design against is the peer harness's: a ledger claiming a file it never wrote, and
# an uninstall deleting the user's work. So every way of not knowing resolves to "not mine".

R="$WORK/sync-nostate"; mkfixture "$R"
sync "$R" >/dev/null
rm -rf "$R/skills/beta"
rm -f "$R/$STATE_REL"
out="$(sync "$R" --check || true)"
assert_contains "$out" "not mirrored by this tool" "an ABSENT ledger makes every mirror-only directory not-ours"
assert_contains "$out" "no sync ledger yet" "and the report says the ledger is missing"
sync "$R" --prune-mirrored >/dev/null
assert_exit 0 "so --prune-mirrored removes nothing" -- test -f "$R/.claude/skills/beta/SKILL.md"

R="$WORK/sync-corruptstate"; mkfixture "$R"
sync "$R" >/dev/null
rm -rf "$R/skills/beta"
printf 'garbage not written by this tool\nbeta\n' > "$R/$STATE_REL"
out="$(sync "$R" --check || true)"
assert_contains "$out" "not mirrored by this tool" "a CORRUPT ledger makes every mirror-only directory not-ours"
sync "$R" --prune-mirrored >/dev/null
assert_exit 0 "so --prune-mirrored removes nothing" -- test -f "$R/.claude/skills/beta/SKILL.md"

# A ledger line naming a traversal is not a claim of ownership, it is a bug or an attack. Dropping
# the line leaves the directory unknown, which is the safe answer either way.
R="$WORK/sync-badname"; mkfixture "$R"
sync "$R" >/dev/null
rm -rf "$R/skills/beta"
{ head -n 1 "$R/$STATE_REL"; printf '0\t../../beta\n'; } > "$R/$STATE_REL.new"
mv "$R/$STATE_REL.new" "$R/$STATE_REL"
out="$(sync "$R" --check || true)"
assert_contains "$out" "not mirrored by this tool" "a ledger name that is not one path component is ignored"
sync "$R" --prune-mirrored >/dev/null
assert_exit 0 "and nothing is pruned on its say-so" -- test -f "$R/.claude/skills/beta/SKILL.md"

# --- --check stays read-only -------------------------------------------------

R="$WORK/sync-checkprune"; mkfixture "$R"
sync "$R" >/dev/null

assert_exit 1 "--check refuses to be combined with --prune-mirrored — a read-only flag cannot delete" -- \
  bash "$R/tools/cortex-sync-skills.sh" --check --prune-mirrored

# A removable orphan present and a genuinely missing skill: --check must report both and touch
# neither. This is the case where the new category could have tempted the read-only path to act.
rm -rf "$R/skills/beta"
mkdir -p "$R/skills/gamma"
printf -- "---\nname: gamma\n---\ngamma body\n" > "$R/skills/gamma/SKILL.md"
before="$(find "$R/.claude/skills" -type f -exec cat {} + | cksum)"
out="$(sync "$R" --check || true)"
assert_eq "$before" "$(find "$R/.claude/skills" -type f -exec cat {} + | cksum)" \
  "--check leaves the mirror byte-identical even with a removable orphan present"
assert_contains "$out" "OUT OF SYNC" "and still reports drift"
assert_exit 1 "--check still exits 1 when out of sync" -- \
  bash "$R/tools/cortex-sync-skills.sh" --check
sync "$R" >/dev/null
assert_exit 0 "and 0 once canonical is mirrored again — an untouched orphan is not drift" -- \
  bash "$R/tools/cortex-sync-skills.sh" --check
