# tools/cortex-destinations.mjs and the destinations line in tools/cortex-preflight.mjs.
#
# The checker is the door the shell half uses into core/destinations.js, so its exit codes are the
# contract cortex-cron.sh relies on: 0 allowed, 2 refused, 1 could not run. Every run names its own
# HOME and list, so no run reads the machine's.

. "$(dirname "${BASH_SOURCE[0]}")/_helpers.sh"   # $WORK or refuse — see the gate there

DC="$REPO_ROOT/tools/cortex-destinations.mjs"
PF="$REPO_ROOT/tools/cortex-preflight.mjs"
export HOME="$WORK/home"
export USERPROFILE="$HOME"
mkdir -p "$HOME"
unset CORTEX_PROFILE CORTEX_DESTINATIONS
LIST="$WORK/allowed"
printf '# approved\ngit: github.com/acme\nhttps: acme.service-now.com\nftp: nope\n' > "$LIST"

assert_exit 0 "home allows any destination" -- node "$DC" check git https://github.com/someone/brain.git
assert_exit 2 "work with no list refuses" -- env CORTEX_PROFILE=work node "$DC" check git https://github.com/acme/brain.git
assert_exit 0 "work allows a listed owner" -- env CORTEX_PROFILE=work CORTEX_DESTINATIONS="$LIST" node "$DC" check git git@github.com:acme/brain.git
assert_exit 2 "and refuses a lookalike owner" -- env CORTEX_PROFILE=work CORTEX_DESTINATIONS="$LIST" node "$DC" check git https://github.com/acme-evil/brain.git
assert_exit 2 "and a lookalike host" -- env CORTEX_PROFILE=work CORTEX_DESTINATIONS="$LIST" node "$DC" check https https://acme.service-now.com.evil.example/api
assert_exit 0 "a path on this machine is always allowed" -- env CORTEX_PROFILE=work node "$DC" check git "$WORK/brain.git"
assert_exit 2 "lab refuses a push" -- env CORTEX_PROFILE=lab node "$DC" check git https://github.com/acme/brain.git
assert_exit 0 "and allows a pull" -- env CORTEX_PROFILE=lab node "$DC" check git https://github.com/acme/brain.git --inbound
assert_exit 1 "an unknown kind cannot run" -- node "$DC" check ftp https://x.example/
assert_exit 1 "nor an unknown profile" -- env CORTEX_PROFILE=works node "$DC" check git https://x.example/a
assert_exit 1 "nor no arguments" -- node "$DC"

err="$(env CORTEX_PROFILE=work CORTEX_DESTINATIONS="$LIST" node "$DC" check git https://someone:hunter2-not-real@github.com/other/brain.git 2>&1 >/dev/null)"
assert_contains "$err" "github.com/other/brain" "a refusal names the host and path"
assert_not_contains "$err" "hunter2-not-real" "and never the credential"
assert_not_contains "$err" "someone" "or the user"

out="$(env CORTEX_PROFILE=work node "$DC" status 2>&1)"
assert_contains "$out" "REFUSED until it exists" "status on work with no list says everything is refused"
assert_contains "$out" "git: github.com/your-org" "and how to write the file"
out="$(env CORTEX_PROFILE=work CORTEX_DESTINATIONS="$LIST" node "$DC" status --json 2>&1)"
assert_contains "$out" '"state": "ok"' "status --json reports the list's state"
assert_contains "$out" '"entries": 2' "and its entries"
assert_contains "$out" '"line": 4' "and the bad line, by number"

out="$(env CORTEX_PROFILE=work node "$PF" 2>&1)"
assert_contains "$out" "NONE APPROVED" "preflight on work with no list says nothing is approved"
assert_contains "$out" "cortex-destinations.mjs status" "and where to look"
out="$(env CORTEX_PROFILE=work CORTEX_DESTINATIONS="$LIST" node "$PF" 2>&1)"
assert_contains "$out" "2 approved" "preflight counts the approved destinations"
assert_contains "$out" "approved-destinations line 4" "and reports the bad line"
out="$(node "$PF" --json 2>&1)"
assert_contains "$out" '"destinations"' "preflight --json carries the destinations state"
