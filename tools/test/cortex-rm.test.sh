# tools/cortex-rm.sh and the shared root guard.
#
# The guard is the shell counterpart of core/paths.js. ADR 0007 made mcp/lib/vault.js the only door
# onto a vault root; the bash half kept a bare $(pwd) and would archive a file it was never pointed
# at. These tests pin the refusal and the promises the tool already makes.

. "$(dirname "${BASH_SOURCE[0]}")/_helpers.sh"   # $WORK or refuse — see the gate there

LIB="$REPO_ROOT/tools/_cortex-lib.sh"
RM="$REPO_ROOT/tools/cortex-rm.sh"

# --- resolve_in_root ---------------------------------------------------------

# shellcheck source=/dev/null
. "$LIB"

ROOTDIR="$WORK/guard/vault"
mkdir -p "$ROOTDIR/notes" "$WORK/guard/outside"
: > "$ROOTDIR/notes/keep.md"
: > "$WORK/guard/outside/secret.md"

got="$(resolve_in_root "$ROOTDIR" "notes/keep.md" 2>/dev/null || echo REFUSED)"
assert_contains "$got" "notes/keep.md" "a legitimate nested path resolves"

assert_exit 1 "a ../ escape is refused" -- resolve_in_root "$ROOTDIR" "../outside/secret.md"
assert_exit 1 "an absolute path outside the root is refused" -- \
  resolve_in_root "$ROOTDIR" "$WORK/guard/outside/secret.md"

# A target that does not exist yet must still resolve — the guard runs before a create, not only
# before a read.
got="$(resolve_in_root "$ROOTDIR" "notes/not-yet.md" 2>/dev/null || echo REFUSED)"
assert_contains "$got" "not-yet.md" "a path that does not exist yet still resolves"

# The symlink case is the one a string-prefix check gets wrong, and it is why core/paths.js
# realpaths rather than comparing strings.
# Probe the RESULT, not `ln`'s exit status. On Git Bash without winsymlinks, `ln -s` succeeds and
# silently makes a copy — so the "link" is a real directory inside the root and accepting it is
# correct, because there is no escape on disk to refuse. Testing the exit code alone would assert a
# refusal the filesystem gives no reason for. Same shape as the 0600 probe in server-setup.test.sh.
ln -s "$WORK/guard/outside" "$ROOTDIR/link" 2>/dev/null || true
if [ -L "$ROOTDIR/link" ]; then
  assert_exit 1 "a symlink pointing out of the root is refused" -- \
    resolve_in_root "$ROOTDIR" "link/secret.md"
else
  echo "  skip  symlink case (this host does not create real symlinks; ln -s copied instead)"
fi

# --- cortex-rm.sh ------------------------------------------------------------

# A vault with the tools it expects to find next to itself.
mkvault() { # dir
  local v="$1"
  mkdir -p "$v/tools" "$v/notes"
  cp "$REPO_ROOT/tools/_cortex-lib.sh" "$REPO_ROOT/tools/cortex-rm.sh" "$v/tools/"
  printf '# Target\n\nbody\n' > "$v/notes/target.md"
  printf '# Other\n\nbody\n' > "$v/notes/other.md"
}

# The refusal — the finding this pass exists for.
V="$WORK/rm-escape"
mkvault "$V"
mkdir -p "$WORK/rm-escape-outside"
printf '# outside\n' > "$WORK/rm-escape-outside/secret.md"
out="$( cd "$V" && bash tools/cortex-rm.sh ../rm-escape-outside/secret.md 2>&1 || true )"
assert_exit 0 "a file outside the vault is NOT moved" -- test -f "$WORK/rm-escape-outside/secret.md"
assert_contains "$out" "outside" "and the refusal says why"

# The promises it already makes, none of which were covered.
V="$WORK/rm-ok"
mkvault "$V"
printf '# Linker\n\nSee [[target|the target]] and [[other]].\n' > "$V/notes/linker.md"
mkdir -p "$V/archives"
printf 'archived mention of [[target]]\n' > "$V/archives/old.md"

( cd "$V" && bash tools/cortex-rm.sh notes/target.md >/dev/null 2>&1 )

assert_exit 1 "the note is gone from its original path" -- test -f "$V/notes/target.md"
archived="$(ls "$V/archives/removed/" 2>/dev/null | head -1)"
assert_contains "$archived" "target." "it was MOVED to archives/removed, not deleted"

linker="$(cat "$V/notes/linker.md")"
assert_contains "$linker" "the target" "an aliased [[target|alias]] becomes its alias"
assert_not_contains "$linker" "[[target" "and no dead link to it remains"

# The sed is aimed at one slug. A greedy pattern would quietly damage every note in the vault, so
# the unrelated link must survive IN THE SAME FILE — two links in two files would not catch it.
assert_contains "$linker" "[[other]]" "an unrelated link in the same file is untouched"

# archives/ is excluded from the de-link pass on purpose: it is the record of what was removed.
assert_contains "$(cat "$V/archives/old.md")" "[[target]]" "archives/ is not rewritten"
