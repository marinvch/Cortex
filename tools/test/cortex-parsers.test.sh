# tools/cortex-parsers.mjs, the parser add-on's installer, and what cortex-index.mjs does without it.
#
# Nothing here reaches the network: every install that is attempted is refused by the destination
# check first, which is the point of running it on a work profile. The successful install, the
# integrity check and the tar guards run against a loopback registry in
# index/test/parsers-install.test.mjs. Every run names its own HOME.

. "$(dirname "${BASH_SOURCE[0]}")/_helpers.sh"   # $WORK or refuse — see the gate there

CP="$REPO_ROOT/tools/cortex-parsers.mjs"
export HOME="$WORK/home"
export USERPROFILE="$HOME"
mkdir -p "$HOME"
unset CORTEX_PROFILE CORTEX_DESTINATIONS

out="$(node "$CP" status 2>&1)"
assert_contains "$out" "not installed" "status with nothing installed says so"
assert_contains "$out" "the index works without it" "and that the index does not need it"
assert_exit 0 "status exits 0" -- node "$CP" status --json

err="$(env CORTEX_PROFILE=work node "$CP" install 2>&1 >/dev/null)"
assert_exit 2 "work with no approved list refuses the download" -- env CORTEX_PROFILE=work node "$CP" install
assert_contains "$err" "refusing to reach registry.npmjs.org" "the refusal names the registry"
assert_contains "$err" "allowed-destinations" "and where approving it goes"
assert_eq "" "$(ls -A "$HOME")" "a refused install writes nothing at all"

printf 'npm: registry.example.internal\n' > "$WORK/allowed"
assert_exit 2 "a list without the registry refuses too" -- env CORTEX_PROFILE=work CORTEX_DESTINATIONS="$WORK/allowed" node "$CP" install
assert_exit 2 "plain http to a remote mirror is refused" -- node "$CP" install --registry http://registry.example.internal/
assert_exit 1 "an unknown flag cannot run" -- node "$CP" install --force
assert_exit 1 "nor an unknown command" -- node "$CP" upgrade

out="$(node "$CP" remove 2>&1)"
assert_contains "$out" "nothing installed" "remove with nothing installed says so"

# The index without the add-on: no symbols, and the parser named.
mkrepo "$WORK/proj"
cd "$WORK/proj" || exit 1
printf 'export function a() { return 1; }\n' > a.js
git add -A >/dev/null && git commit -qm init
node "$REPO_ROOT/index/cortex-index.mjs" . >/dev/null 2>&1
idx="$(cat .cortex/index/index.json)"
assert_contains "$idx" '"parser": "regex"' "an index built without the add-on says regex"
assert_not_contains "$idx" '"symbols"' "and has no symbols section"
assert_eq "" "$( [ -d .cortex/index/symbols ] && echo exists)" "and no symbol cache"
