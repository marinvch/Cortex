# cortex:allow-secrets — the strings below are the fixture repo this test BUILDS, not credentials.
# sk_live_0000000000000000 is sixteen zeroes and hunter2 is a punchline; both exist so the secrets
# finding has something to find. Without this marker Cortex reports itself as leaking, and a
# critical finding that is always wrong is how a team learns to skip the critical section.

# Cortex works on somebody else's repository.
#
# Every other test in this suite points Cortex at fixtures shaped by the people who wrote the tests.
# That proves the parts work; it does not prove the product does. This one runs the whole install
# pipeline — index, then findings, then the offers worklist the wizard walks — against a repository
# that looks like real product code: a Next.js app with TypeScript, an api directory, generated
# Prisma output, committed .env files, and no tests.
#
# It builds that repo rather than pointing at one on disk, because a test that depends on an
# absolute path to somebody's private project runs on exactly one machine. To run it against a real
# repository instead, set CORTEX_E2E_REPO — that mode is READ-ONLY and writes its output to the temp
# directory via --out, so pointing it at a project you care about cannot modify it:
#
#   CORTEX_E2E_REPO=/path/to/a/real/repo bash tools/test/run.sh install-on-a-project

INDEX="$REPO_ROOT/index/cortex-index.mjs"
FINDINGS="$REPO_ROOT/index/cortex-findings.mjs"

# --- build a repo that looks like product code --------------------------------------------------

# The indexer asks git what belongs to a repo (ADR 0003), so the fixture has to be a real one. A
# git repo in a temp dir is complete on its own — no network, no remote.
PROJ="$WORK/acme-app"
mkdir -p "$PROJ/src/app/api/billing" "$PROJ/src/components" "$PROJ/src/app/generated/prisma" "$PROJ/prisma"
cd "$PROJ" || exit 1
git init -q . && git config user.email t@t && git config user.name t

cat > package.json <<'JSON'
{ "name": "acme-app", "version": "0.1.0",
  "dependencies": { "next": "15.0.0", "react": "19.0.0", "@prisma/client": "6.0.0" } }
JSON
printf 'export default function Page() { return <div>hi</div>; }\n' > src/app/page.tsx
printf 'import { db } from "../../../lib/db";\nexport async function POST() { return Response.json({ ok: true }); }\n' > src/app/api/billing/route.ts
printf 'export const Button = () => <button />;\n' > src/components/Button.tsx
printf 'export const db = {};\n' > src/lib-db.ts
printf 'generator client { provider = "prisma-client-js" }\n' > prisma/schema.prisma
# A real Next.js repo carries a tsconfig and declares @prisma/client (the runtime) rather than the
# prisma CLI. Both were wrong in the first version of this fixture, and both exposed real detection
# gaps: the alias was unrecognised, and TypeScript was asserted only from a dependency that
# framework-compiled repos never name.
printf '{ "compilerOptions": { "strict": true } }\n' > tsconfig.json
# Generated output and committed env files — the two things a real Next.js repo drags along, and
# the reason the secrets finding is the one that fires first in practice.
printf 'const secret = "sk_live_0000000000000000";\nmodule.exports = { secret };\n' > src/app/generated/prisma/index.js
printf 'DATABASE_URL="postgresql://user:hunter2@localhost:5432/db"\nSTRIPE_SECRET_KEY="sk_live_0000000000000000"\n' > .env
printf '# Acme\n' > README.md
git add -A && git commit -qm "initial"

cd "$WORK" || exit 1

# --- index ---------------------------------------------------------------------------------------

out="$(node "$INDEX" "$PROJ" --out "$WORK/index.json" 2>&1)"; rc=$?
assert_eq "0" "$rc" "cortex-index runs on a foreign repo"
assert_contains "$out" "Indexed" "and reports what it indexed"
[ -f "$WORK/index.json" ] && _pass "an index is written where --out asked" || _fail "an index is written where --out asked"

# --out must mean it: an index that also scribbles into the target is not read-only, and
# /cortex-install promises to change nothing before the user picks something.
[ -d "$PROJ/.cortex" ] && _fail "indexing with --out leaves the target repo untouched" "created $PROJ/.cortex" \
                       || _pass "indexing with --out leaves the target repo untouched"

IX="$(cat "$WORK/index.json")"
assert_contains "$IX" "src/app/api/billing/route.ts" "the index knows the repo's real files"
assert_contains "$IX" "typescript" "and detects the language"
assert_not_contains "$IX" "node_modules" "and does not index dependencies"

# --- findings --------------------------------------------------------------------------------

out="$(node "$FINDINGS" "$PROJ" --out "$WORK/findings.md" 2>&1)"; rc=$?
assert_eq "0" "$rc" "cortex-findings runs on a foreign repo"
[ -d "$PROJ/.cortex" ] && _fail "findings with --out leaves the target repo untouched" \
                       || _pass "findings with --out leaves the target repo untouched"

REPORT="$(cat "$WORK/findings.md")"
assert_contains "$REPORT" "proposal" "the report says nothing was changed"
assert_contains "$REPORT" ".env" "it finds the committed secrets"
assert_contains "$REPORT" "No test files found" "it notices the repo has no tests"

# --- the offers worklist ----------------------------------------------------------------------

# ADR 0006: the report is the wizard's script, and offers() ranking is control flow. A worklist that
# came back empty on a repo this untidy would mean the interview asks nothing.
OFFERS="$(node "$FINDINGS" "$PROJ" --offers 2>&1)"
assert_contains "$OFFERS" "triage-secrets" "the worklist offers to triage the secrets"
assert_contains "$OFFERS" "critical" "and ranks that critical"
[ -d "$PROJ/.cortex" ] && _fail "--offers writes nothing" || _pass "--offers writes nothing"

# The severity ordering is what decides which question the user is asked first, so it is asserted
# rather than assumed: critical must appear before any lower severity in the emitted worklist.
first_sev="$(printf '%s' "$OFFERS" | grep -o '"severity": "[a-z]*"' | head -1)"
assert_eq '"severity": "critical"' "$first_sev" "the worklist leads with the highest severity"

# --- stack detection and the skills it implies ---------------------------------------------------

# The bug this closes: every repo got the same two skills, because nothing downstream of the index
# could tell a Next.js app with Prisma apart from a Rust CLI. The fixture above IS that Next.js
# app, so the proposal it produces is the assertion.
SKILLS="$REPO_ROOT/index/cortex-skills.mjs"

IX="$(cat "$WORK/index.json")"
assert_contains "$IX" '"next"' "the index detects the framework from the manifest"
assert_contains "$IX" '"prisma"' "and the data layer from the schema"
assert_contains "$IX" '"typescript"' "and the language"

out="$(node "$SKILLS" "$PROJ" --index "$WORK/index.json" 2>&1)"; rc=$?
assert_eq "0" "$rc" "cortex-skills runs against a foreign repo"
assert_contains "$out" "add-migration" "a repo owning a Prisma schema is offered the migration skill"
assert_contains "$out" "write-first-test" "a repo with no tests is offered the first-test skill"
assert_contains "$out" "add-route" "a repo with a web framework is offered the route skill"

# Read-only in the strongest sense: it writes nothing at all, not even under .cortex/.
[ -d "$PROJ/.cortex" ] && _fail "cortex-skills writes nothing into the target" \
                       || _pass "cortex-skills writes nothing into the target"

# Every proposal must carry evidence. A bare list is something a user cannot consent to.
assert_contains "$out" "why:" "every proposal states why it was surfaced"

# The offers form is what a ritual walks, so it must be parseable JSON with the ranked list.
offers="$(node "$SKILLS" "$PROJ" --index "$WORK/index.json" --offers 2>&1)"
first="$(printf '%s' "$offers" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).propose[0].id)}catch(e){console.log("UNPARSEABLE")}})')"
assert_eq "write-first-test" "$first" "--offers is JSON and leads with the highest-ranked proposal"

# --- opt-in: a real repository -----------------------------------------------------------------

if [ -n "${CORTEX_E2E_REPO:-}" ] && [ -d "$CORTEX_E2E_REPO" ]; then
  out="$(node "$INDEX" "$CORTEX_E2E_REPO" --out "$WORK/real-index.json" 2>&1)"; rc=$?
  assert_eq "0" "$rc" "cortex-index runs on $CORTEX_E2E_REPO"
  assert_contains "$out" "Indexed" "and indexes it"
  [ -d "$CORTEX_E2E_REPO/.cortex" ] && _fail "the real repo is left untouched" "created a .cortex/ in it" \
                                    || _pass "the real repo is left untouched"
  out="$(node "$FINDINGS" "$CORTEX_E2E_REPO" --offers 2>&1)"; rc=$?
  assert_eq "0" "$rc" "cortex-findings produces a worklist for it"
  assert_contains "$out" "action" "and the worklist has at least one action"
else
  printf '  skip  real-repo pass (set CORTEX_E2E_REPO=<path> to enable)\n'
fi
