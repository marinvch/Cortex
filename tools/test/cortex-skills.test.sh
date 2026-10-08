# cortex-skills writes nothing, so everything it is worth is in the sentences it prints.
#
# index/test/skills.test.mjs covers proposeSkills as a function, and
# tools/test/install-on-a-project.test.sh proves the right skills come back for a Next.js + Prisma
# repo. What neither reaches is this CLI's own contract — the three answers it gives when it does
# NOT have a clean proposal to make, which is where a tool that guesses does its damage:
#
#   - no index → refuse and name the command that builds one, rather than propose from nothing;
#   - no dependency manifest → say the stack is unknown, rather than infer one from directory names;
#   - a skill already in the repo → report it as present, rather than propose writing it again.
#
# The evidence sentence is the fourth. A proposal a user cannot check is one they cannot consent to,
# and it must name what was DETECTED in the words the rest of the output uses.

. "$(dirname "${BASH_SOURCE[0]}")/_helpers.sh"   # $WORK or refuse — see the gate there

SKILLS="$REPO_ROOT/index/cortex-skills.mjs"
INDEX="$REPO_ROOT/index/cortex-index.mjs"

PROJ="$WORK/proj"
run() { node "$SKILLS" "$PROJ" "$@" 2>&1; }

# --- a real repo with a real manifest --------------------------------------------------------------

rm -rf "$PROJ"; mkdir -p "$PROJ/src/app/api" "$PROJ/.github/workflows"
cd "$PROJ" || exit 1
git init -q .; git config user.email t@t; git config user.name t
cat > package.json <<'JSON'
{ "name": "shop", "version": "1.0.0",
  "dependencies": { "next": "15.0.0", "react": "19.0.0", "@prisma/client": "6.0.0", "stripe": "17.0.0" } }
JSON
printf '{ "compilerOptions": { "strict": true } }\n'                        > tsconfig.json
printf 'export default function Page() { return <div>hi</div>; }\n'          > src/app/page.tsx
printf 'export async function POST() { return Response.json({ ok: true }); }\n' > src/app/api/route.ts
printf 'name: ci\non: [push]\njobs: { build: { runs-on: ubuntu-latest } }\n' > .github/workflows/ci.yml
git add -A && git commit -qm init
cd "$WORK" || exit 1

# --- it refuses to propose from nothing -------------------------------------------------------------

out="$(run)"; rc=$?
assert_eq "2" "$rc" "with no index there is no detection, and a refusal beats a guess"
assert_contains "$out" "no index at" "the refusal says what is missing"
assert_contains "$out" "cortex-index.mjs" "and names the command that fixes it"

node "$INDEX" "$PROJ" >/dev/null 2>&1

# --- the evidence a user consents to ----------------------------------------------------------------

out="$(run)"
assert_contains "$out" "Detected stack" "the run shows what it read off the repo"
assert_contains "$out" "verify-webhook" "a Stripe dependency earns the webhook skill"
assert_contains "$out" "Nothing has been written" "and the whole output is a proposal"

# A file signal that CONFIRMS is not decoration. This repo depends on @prisma/client and owns no
# schema, so the schema lives in another repo — and an /add-migration skill pointing at a migration
# command that does not belong to this codebase is worse than no skill at all.
assert_not_contains "$out" "add-migration" "a Prisma dependency without a schema does not earn the migration skill"
mkdir -p "$PROJ/prisma"
printf 'generator client { provider = "prisma-client-js" }\n' > "$PROJ/prisma/schema.prisma"
( cd "$PROJ" && git add -A >/dev/null 2>&1 && git commit -qm schema >/dev/null 2>&1 )
node "$INDEX" "$PROJ" >/dev/null 2>&1
out="$(run)"
assert_contains "$out" "add-migration" "and owning the schema is what earns it"
# The proposal carries the exact `paths:` line the written skill gets, from what was detected —
# so the migration skill loads on the schema, and the webhook skill (Stripe says nothing about
# where its handler lives) carries none.
mig_block="$(printf '%s' "$out" | grep -A3 '/add-migration')"
assert_contains "$mig_block" "paths: prisma/**, **/*.prisma" "the migration skill is scoped to the schema it was earned by"
hook_block="$(printf '%s' "$out" | sed -n '/\/verify-webhook/,/^$/p')"
assert_not_contains "$hook_block" "paths:" "a skill with nothing file-shaped detected gets no paths line"

# The stack block and the evidence sentences must speak ONE vocabulary. This printed
# "framework   Next.js · React" and, three lines below, "why: next, react" — and the delivery row
# shipped the internal identifier verbatim: "why: githubActions — the path from a green local run".
# Found by running this CLI against a real Next.js app; no fixture in index/test/ could show it,
# because the ids were only ever compared to themselves.
assert_contains "$out" "GitHub Actions" "a detected id is written the way the reader is shown it"
assert_not_contains "$out" "githubActions" "never as the raw camelCase identifier"
why_route="$(printf '%s' "$out" | grep -A1 '/add-route' | grep 'why:')"
assert_contains "$why_route" "Next.js" "the evidence names the framework, spelled as the stack block spells it"

# Every proposal states its grounds. A bare list of skill names is something nobody can check.
count="$(printf '%s' "$out" | grep -c '^  /')"
whys="$(printf '%s' "$out" | grep -c 'why:')"
assert_eq "$count" "$whys" "every single proposal carries its own evidence line"

# --- read-only in the strongest sense ----------------------------------------------------------------

# It writes nothing at all, not even under .cortex/. The bodies are written by the ritual after the
# user picks, because a useful body quotes this repo's real commands — and inventing those is the
# one failure a deterministic module cannot detect in itself.
tree_state() { ( cd "$1" && find . -path ./.git -prune -o -type f -print0 2>/dev/null | sort -z | xargs -0 -r ls -l 2>/dev/null | awk '{print $5, $NF}' ); }
before="$(tree_state "$PROJ")"
run >/dev/null
run --offers >/dev/null
assert_eq "$before" "$(tree_state "$PROJ")" "neither mode changes a single file in the target"

# --- a skill the repo already has is present, not proposed again -------------------------------------

# Re-proposing finished work is how a report teaches people to stop reading it. Reported rather than
# dropped, because a reader has to be able to tell "you already have this" from "this did not apply".
mkdir -p "$PROJ/.claude/skills/verify-webhook"
printf '# verify-webhook\n' > "$PROJ/.claude/skills/verify-webhook/SKILL.md"
out="$(run)"
assert_contains "$out" "Already present: verify-webhook" "an existing skill is reported as present"
assert_not_contains "$(printf '%s' "$out" | grep '^  /')" "verify-webhook" "and is not proposed a second time"

offers="$(run --offers)"
already="$(printf '%s' "$offers" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).alreadyPresent.map(p=>p.id).join(","))}catch(e){console.log("UNPARSEABLE")}})')"
assert_eq "verify-webhook" "$already" "--offers is JSON and keeps the two lists apart"

# --- a skill the repo has moved away from (#462) -------------------------------------------------------

# A re-run of /cortex kept two skills that said the repo had no tests beside 83 of them, and cited
# paths that had moved. Present is not the same as true. Every line printed must be provable from
# disk — and what the repo's own .gitignore declares generated is absent by design, which only a
# real git checkout can say.
mkdir -p "$PROJ/.claude/skills/type-check"
cat > "$PROJ/.claude/skills/type-check/SKILL.md" <<'MD'
---
name: type-check
description: Check the types.
---

There is no test suite here, so the checker is the only verification.
The nav lives in `src/components/Nav.tsx`; the page is `src/app/page.tsx`.
The bundle lands in `dist/app/main.js`.

```bash
npm run typecheck
```
MD
printf 'dist/\n' > "$PROJ/.gitignore"
printf 'test("page", () => {});\n' > "$PROJ/src/app/page.test.tsx"
( cd "$PROJ" && git add -A >/dev/null 2>&1 && git commit -qm "tests and a skill" >/dev/null 2>&1 )
node "$INDEX" "$PROJ" >/dev/null 2>&1

before="$(tree_state "$PROJ")"
out="$(run)"
assert_contains "$out" "/type-check  .claude/skills/type-check/SKILL.md" "a drifted skill is named with its file"
assert_contains "$out" "line 6: says the repo has no tests, and the index counts 1 test file" "a false 'no tests' claim cites its line and the count"
assert_contains "$out" "line 7: names src/components/Nav.tsx, which is not in the repo" "a moved path cites its line"
assert_contains "$out" 'line 11: no package.json in the repo declares a "typecheck" script' "a dead script is caught inside a fence"
assert_not_contains "$out" "src/app/page.tsx" "a path that exists is never reported"
assert_not_contains "$out" "dist/app/main.js" "nor one the repo's .gitignore declares generated"
assert_eq "$before" "$(tree_state "$PROJ")" "reporting drift changes nothing in the target"

drift="$(run --offers | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const d=JSON.parse(s).drift;console.log(d.map(x=>x.skill+":"+x.findings.map(f=>f.line).join("/")).join(","))}catch(e){console.log("UNPARSEABLE")}})')"
assert_eq "type-check:6/7/11" "$drift" "--offers carries the same findings for a ritual to walk"

# Edited since it was written (#548): git is the witness, so this has to be a real checkout. The fact
# rides on the row /cortex plays back, so its one confirmation covers a skill the user was told about.
edited() { run --offers | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const d=JSON.parse(s).drift[0];console.log(d.edited+"|"+d.editedNote)})'; }
assert_eq "false|null" "$(edited)" "edited: one commit is the one that wrote it"
assert_not_contains "$(run)" "edited since it was written" "and the report says nothing about it"
printf '\nA person added this line.\n' >> "$PROJ/.claude/skills/type-check/SKILL.md"
assert_eq "true|edited since it was written, uncommitted changes" "$(edited)" "edited: an uncommitted change is a person's work"
( cd "$PROJ" && git add -A >/dev/null 2>&1 && git commit -qm "a person edits the skill" >/dev/null 2>&1 )
assert_eq "true|edited since it was written, 2 commits" "$(edited)" "edited: a second commit is named with the count"
assert_contains "$(run)" "/type-check  .claude/skills/type-check/SKILL.md — edited since it was written, 2 commits" "and the report says so on the skill's own line"
rm -rf "$PROJ/.claude/skills/type-check"

# --- a repo whose stack cannot be known ---------------------------------------------------------------

# Nothing stack-specific can be proposed honestly without a manifest, and the honest answer is to
# say so. Inferring a stack from directory names is the failure the alias rule warns about in the
# other direction: a guess that means nothing is worse than an absence that says so.
PROJ="$WORK/bare"
rm -rf "$PROJ"; mkdir -p "$PROJ/src"
cd "$PROJ" || exit 1
git init -q .; git config user.email t@t; git config user.name t
printf 'x = 1\n' > src/thing.rb
printf '# bare\n' > README.md
git add -A && git commit -qm init
cd "$WORK" || exit 1
node "$INDEX" "$PROJ" >/dev/null 2>&1

out="$(run)"
assert_contains "$out" "No dependency manifest found" "an unknown stack is stated, never inferred"
assert_contains "$out" "write skills by hand" "and the reader is told what they can do instead"
assert_not_contains "$out" "add-migration" "no stack-specific skill is proposed on no evidence"

# --- a root that is not a directory ------------------------------------------------------------
#
# The check has no error state without it: buildIndex on a directory that does not exist returns
# zero files rather than throwing, so this command answered confidently about a repository that
# was never there — and two of its siblings wrote into one they invented from a mangled flag.
# index/test/root.test.mjs covers the predicate; this covers that THIS command consults it.

mkdir -p "$WORK/guard" && printf 'x
' > "$WORK/a-file"
out="$(cd "$WORK/guard" && node "${SKILLS}" "$WORK/no-such-repo" 2>&1)"; rc=$?
assert_eq "1" "$rc" "a root that does not exist is refused"
assert_contains "$out" "not a directory" "and says what is wrong with it"
assert_contains "$out" "Nothing was changed" "and that nothing happened"
[ -n "$(ls -A "$WORK/guard" 2>/dev/null)" ] && _fail "and nothing is created anywhere" || _pass "and nothing is created anywhere"

# existsSync would pass a file. Walking one as though it were a repository is the same bug.
out="$(node "${SKILLS}" "$WORK/a-file" 2>&1)"; rc=$?
assert_eq "1" "$rc" "a file passed as a root is refused too"
