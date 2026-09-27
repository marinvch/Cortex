# The workspace harness's S4 overlap check, run against a workspace this fragment builds.
#
# tools/test/e2e-workspace.mjs is normally driven by CORTEX_E2E_WORKSPACE against a team's real
# repos, which CI does not have — so a check inside it could rot unseen. This builds the smallest
# workspace the S4 check can act on (one repo with an import edge, one without) and pins that line:
# two identities edit one clone, one on a branch and one staged, and `cortex-impact --against` must
# warn in both forms it takes. The other scenarios need a team-brain and are not asserted here.

. "$(dirname "${BASH_SOURCE[0]}")/_helpers.sh"   # $WORK or refuse — see the gate there

mkdir -p "$WORK/ws/app/src" "$WORK/ws/notes"
cd "$WORK/ws/app" || exit 1
git init -q .
git config user.email t@example.invalid; git config user.name t
printf 'import { b } from "./b.js";\nexport const a = b;\n' > src/a.js
printf 'export const b = 1;\n'                            > src/b.js
printf '# app\n'                                          > README.md
printf '{ "name": "app", "version": "1.0.0" }\n'          > package.json
git add -A && git commit -qm init

cd "$WORK/ws/notes" || exit 1
git init -q .
git config user.email t@example.invalid; git config user.name t
printf '# notes\n' > README.md
git add -A && git commit -qm init
cd "$WORK" || exit 1

before="$(git -C "$WORK/ws/app" status --porcelain; git -C "$WORK/ws/app" for-each-ref)"
out="$(node "$REPO_ROOT/tools/test/e2e-workspace.mjs" "$WORK/ws" --work "$WORK/e2e" 2>&1)"

# The line the harness prints for the check: `ok`, then the label with the repo and forms counted.
assert_contains "$out" "ok    two identities editing overlapping files get a warning (cortex-impact --against): app, 2/2 forms warn" \
  "S4: both --against-ref and a CRLF --against list warn about the overlap and the one-hop collision"
assert_not_contains "$out" "[step 8.4]" "and the overlap check is no longer an expected failure"
assert_contains "$out" "PASS  the workspace is left untouched" "the harness still leaves the workspace as it found it"
assert_eq "$before" "$(git -C "$WORK/ws/app" status --porcelain; git -C "$WORK/ws/app" for-each-ref)" \
  "and the repo the check edited a clone of has no new branch and no change"
