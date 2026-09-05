# The version fact has one home, and a release stamps it everywhere from there.
#
# Before tools/cortex-version.mjs the version was authored by hand in eight places and verified in
# five. core/package.json was one of the three nobody checked, and it sat at 2.2.0 for six releases
# — the exact drift mcp/test/version.test.js was written to prevent, happening in the one site it
# did not cover.
#
# This file is the guard behind the generator, not instead of it: the first assertion fails a build
# whose sites disagree, and the rest exercise the writer against a scratch copy so it is never
# shipped having only ever been read.

. "$(dirname "${BASH_SOURCE[0]}")/_helpers.sh"   # $WORK or refuse — see the gate there

VER="$REPO_ROOT/tools/cortex-version.mjs"

# --- the guard on the live tree -----------------------------------------------------------------

out="$(node "$VER" 2>&1)"; rc=$?
assert_eq "0" "$rc" "every version site in this repo agrees (run: node tools/cortex-version.mjs --set \$(cat VERSION))"
[ "$rc" = "0" ] || printf '          %s\n' "$out"

# --- the writer, against a scratch copy ---------------------------------------------------------

scratch() {
  rm -rf "$WORK/repo"
  mkdir -p "$WORK/repo/.claude-plugin" "$WORK/repo/mcp" "$WORK/repo/core"
  printf '1.0.0\n' > "$WORK/repo/VERSION"
  # A nested dependency version sits BEFORE nothing but after the package's own, which is the order
  # npm writes. The site matcher must take the first "version" key and leave the dependency alone.
  printf '{\n  "name": "p",\n  "version": "1.0.0",\n  "dependencies": { "dep": { "version": "9.9.9" } }\n}\n' > "$WORK/repo/.claude-plugin/plugin.json"
  printf '{\n  "version": "1.0.0"\n}\n' > "$WORK/repo/.claude-plugin/marketplace.json"
  printf '{\n  "version": "1.0.0"\n}\n' > "$WORK/repo/mcp/package.json"
  printf '{\n  "version": "1.0.0"\n}\n' > "$WORK/repo/core/package.json"
  printf '# R\n\n**v1.0.0** installable\n' > "$WORK/repo/README.md"
  printf '# Changelog\n\n## [1.0.0] - old\n\n[1.0.0]: https://github.com/marinvch/Cortex/releases/tag/v1.0.0\n' > "$WORK/repo/CHANGELOG.md"
}

# Stamping a version whose changelog entry does not exist must fail. A release entry says what
# changed and why; a generator that invented one would be worse than a missing line.
scratch
out="$(CORTEX_VERSION_ROOT="$WORK/repo" node "$VER" --set 2.0.0 2>&1)"; rc=$?
assert_eq "1" "$rc" "--set refuses a version with no hand-written changelog entry"
assert_contains "$out" 'no "## [2.0.0]" entry' "and says which entry is missing"

# Now with the entry present, every site is stamped in one pass.
scratch
printf '# Changelog\n\n## [2.0.0] - new\n\n## [1.0.0] - old\n\n[1.0.0]: https://github.com/marinvch/Cortex/releases/tag/v1.0.0\n' > "$WORK/repo/CHANGELOG.md"
out="$(CORTEX_VERSION_ROOT="$WORK/repo" node "$VER" --set 2.0.0 2>&1)"; rc=$?
assert_eq "0" "$rc" "--set stamps a version whose changelog entry exists"

assert_eq "2.0.0" "$(cat "$WORK/repo/VERSION")" "VERSION stamped"
for f in .claude-plugin/plugin.json .claude-plugin/marketplace.json mcp/package.json core/package.json; do
  assert_contains "$(cat "$WORK/repo/$f")" '"version": "2.0.0"' "$f stamped"
done
assert_contains "$(cat "$WORK/repo/README.md")" '**v2.0.0**' "README badge stamped"

# The dependency version is not the package's own version. Clobbering it would corrupt a lockfile
# shape while looking like a successful release.
assert_contains "$(cat "$WORK/repo/.claude-plugin/plugin.json")" '"version": "9.9.9"' "a nested dependency version is left alone"

# The link reference is the site that gets missed: a missing one renders `[2.0.0]` as literal text
# and breaks nothing, so nobody notices. It is derivable, so it is generated.
assert_contains "$(cat "$WORK/repo/CHANGELOG.md")" '[2.0.0]: https://github.com/marinvch/Cortex/releases/tag/v2.0.0' "changelog link reference generated"
assert_contains "$(cat "$WORK/repo/CHANGELOG.md")" '[1.0.0]: https://github.com/marinvch/Cortex/releases/tag/v1.0.0' "and the older references are kept"

# A second run must be a no-op, not a second link reference.
CORTEX_VERSION_ROOT="$WORK/repo" node "$VER" --set 2.0.0 >/dev/null 2>&1
assert_eq "1" "$(grep -c '^\[2\.0\.0\]:' "$WORK/repo/CHANGELOG.md")" "stamping twice leaves exactly one link reference"

# And the check agrees with the writer — the two read the same SITES list, which is the point.
CORTEX_VERSION_ROOT="$WORK/repo" node "$VER" >/dev/null 2>&1
assert_eq "0" "$?" "--check passes on what --set just wrote"

# Drift in any single site is reported by path, so the fix is one lookup rather than a hunt.
printf '{\n  "version": "1.2.3"\n}\n' > "$WORK/repo/core/package.json"
out="$(CORTEX_VERSION_ROOT="$WORK/repo" node "$VER" 2>&1)"; rc=$?
assert_eq "1" "$rc" "--check fails when one site drifts"
assert_contains "$out" "core/package.json says 1.2.3" "and names the drifted site and its value"

# A malformed version is refused rather than smeared across seven files.
scratch
out="$(CORTEX_VERSION_ROOT="$WORK/repo" node "$VER" --set "not-a-version" 2>&1)"; rc=$?
assert_eq "1" "$(if [ "$rc" != "0" ]; then echo 1; else echo 0; fi)" "--set refuses a malformed version"
assert_eq "1.0.0" "$(cat "$WORK/repo/VERSION")" "and writes nothing when it does"
