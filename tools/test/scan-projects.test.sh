# cortex-scan-projects.sh keeps work repos out of a personal vault — the employer firewall.
#
# The firewall is one `grep -qE` on each repo's path, and a false "no match" registers a work repo's
# name and path in a home vault. That line used to be `echo "$repo" | grep -qE` under the script's
# own pipefail, the pattern issue #433 was about; it takes a here-string now, and until this file
# nothing ran it at all. The script finds its vault from its own location, so the fixture copies
# it (and the lib it sources) into a throwaway vault rather than running it where it ships.

. "$(dirname "${BASH_SOURCE[0]}")/_helpers.sh"   # $WORK or refuse — see the gate there

CODE="$WORK/code"
mkdir -p "$CODE/vault/tools" "$CODE/vault/projects"
cp "$REPO_ROOT/tools/cortex-scan-projects.sh" "$REPO_ROOT/tools/_cortex-lib.sh" "$CODE/vault/tools/"
mkrepo "$CODE/mine/side-app"
mkrepo "$CODE/Work/job-api"
# A stub left by an earlier scan, before the repo moved under Work/: the firewall purges it.
printf 'stale\n' > "$CODE/vault/projects/job-api.md"

out="$(bash "$CODE/vault/tools/cortex-scan-projects.sh" "$CODE" 2>&1)"; rc=$?
assert_eq 0 "$rc" "the scan finishes"
assert_contains "$out" "1 work-firewalled" "and reports the work repo it skipped"
[ -f "$CODE/vault/projects/side-app.md" ] && _pass "a personal repo is registered" \
                                          || _fail "a personal repo is registered" "$out"
[ -e "$CODE/vault/projects/job-api.md" ] && _fail "a work repo's earlier stub is purged, not kept" \
                                         || _pass "a work repo's earlier stub is purged, not kept"
assert_not_contains "$(cat "$CODE/vault/projects/projects-map.md" 2>/dev/null)" "job-api" \
  "and the work repo is not named anywhere in the projects map"
