# The workspace harness's S1 claude-setup check and S4 overlap check, run against a workspace this
# fragment builds.
#
# tools/test/e2e-workspace.mjs is normally driven by CORTEX_E2E_WORKSPACE against a team's real
# repos, which CI does not have — so a check inside it could rot unseen. This builds the smallest
# workspace those checks can act on and pins their lines:
#
#   S1 — every repo /cortex served (root AGENTS.md + CLAUDE.md) has zero claude-setup/* findings. A
#        clean served repo must pass; a served repo with one planted breach — a skill carrying a
#        top-level key Claude Code ignores — must fail, naming that repo and the finding. The
#        placeholder this replaced failed on every run, so neither answer was reachable before.
#   S4 — two identities edit one clone, one on a branch and one staged, and `cortex-impact
#        --against` must warn in both forms it takes.
#
# S2 needs a team-brain and is not asserted here.

. "$(dirname "${BASH_SOURCE[0]}")/_helpers.sh"   # $WORK or refuse — see the gate there

# A repo /cortex has served, as far as the loop reader can tell: the root brief and its shim.
serve() {
  printf '# %s\n\nWhat a new joiner needs on day one.\n' "$1" > AGENTS.md
  printf '@AGENTS.md\n' > CLAUDE.md
}

mkdir -p "$WORK/ws/app/src" "$WORK/ws/notes"
cd "$WORK/ws/app" || exit 1
git init -q .
git config user.email t@example.invalid; git config user.name t
printf 'import { b } from "./b.js";\nexport const a = b;\n' > src/a.js
printf 'export const b = 1;\n'                            > src/b.js
printf '# app\n'                                          > README.md
printf '{ "name": "app", "version": "1.0.0" }\n'          > package.json
serve app
git add -A && git commit -qm init

cd "$WORK/ws/notes" || exit 1
git init -q .
git config user.email t@example.invalid; git config user.name t
printf '# notes\n' > README.md
git add -A && git commit -qm init
cd "$WORK" || exit 1

before="$(git -C "$WORK/ws/app" status --porcelain; git -C "$WORK/ws/app" for-each-ref)"
out="$(node "$REPO_ROOT/tools/test/e2e-workspace.mjs" "$WORK/ws" --work "$WORK/e2e" 2>&1)"

# S1: one served repo, clean. `notes` was never served, so it is outside the denominator — the same
# one the .claude/-artifacts line counts, which is why both lines say "installed repos".
assert_contains "$out" "ok    claude-setup checker finds nothing in what /cortex wrote: 1/1 installed repos" \
  "S1: a served repo whose Claude setup is clean passes the claude-setup check"
if grep -qE "\.claude/ artifacts are on disk: [01]/1 installed repos" <<<"$out"; then
  _pass "and the .claude/-artifacts line counts the same installed repos"
else
  _fail "and the .claude/-artifacts line counts the same installed repos" "$(grep 'artifacts are on disk' <<<"$out")"
fi
assert_not_contains "$out" "replace this placeholder" "the S1 placeholder is gone"

# The line the harness prints for the check: `ok`, then the label with the repo and forms counted.
assert_contains "$out" "ok    two identities editing overlapping files get a warning (cortex-impact --against): app, 2/2 forms warn" \
  "S4: both --against-ref and a CRLF --against list warn about the overlap and the one-hop collision"
assert_not_contains "$out" "[step 8.4]" "and the overlap check is no longer an expected failure"
assert_contains "$out" "PASS  the workspace is left untouched" "the harness still leaves the workspace as it found it"
assert_eq "$before" "$(git -C "$WORK/ws/app" status --porcelain; git -C "$WORK/ws/app" for-each-ref)" \
  "and the repo the check edited a clone of has no new branch and no change"

# S1 the other way: a second served repo whose skill carries `capability:` at the top level, which
# Claude Code ignores without a word. The check must go red and say which repo and which finding.
mkdir -p "$WORK/ws/svc/.claude/skills/deploy"
cd "$WORK/ws/svc" || exit 1
git init -q .
git config user.email t@example.invalid; git config user.name t
printf 'export const handler = () => 1;\n'       > index.js
printf '{ "name": "svc", "version": "1.0.0" }\n' > package.json
serve svc
printf -- '---\nname: deploy\ndescription: Deploy the service. Use when the user asks to ship svc.\ncapability: judgment\n---\n\nRun the deploy.\n' \
  > .claude/skills/deploy/SKILL.md
git add -A && git commit -qm init
cd "$WORK" || exit 1

out="$(node "$REPO_ROOT/tools/test/e2e-workspace.mjs" "$WORK/ws" --work "$WORK/e2e-breach" 2>&1)"
assert_contains "$out" "FAIL  claude-setup checker finds nothing in what /cortex wrote: 1/2 installed repos" \
  "S1: a served repo with a planted claude-setup breach fails the check"
assert_contains "$out" "svc: claude-setup/skill-unknown-key" "and the detail names the repo and the first finding"
assert_contains "$out" ".claude/skills/deploy/SKILL.md — capability" "down to the file and the key"
assert_not_contains "$out" "app: claude-setup/" "while the clean served repo is not blamed"
assert_contains "$out" "FAIL  S1 install + correct map" "and the scenario fails rather than hiding it behind an expected failure"
