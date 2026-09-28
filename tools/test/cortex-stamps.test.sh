# cortex-stamps writes into a target repo, and prints the sentence that decides whether /cortex
# rewrites a file the team owns. Both halves need a real git fixture.
#
#   - `record` writes `.cortex/stamps.json` and nothing else. The whole promise of the record is
#     that it is committed and shared, so a repo whose ignore rules hide it must be told, with the
#     fix that actually works — and git cannot re-include a file under an ignored directory, so
#     `!.cortex/stamps.json` alone is the wrong advice for the commonest rule, `.cortex/`.
#   - status reaches all six states from real edits, deletions and template changes, and exits 0
#     whatever it finds: an out-of-date file is information, not a failure.
#
# index/test/stamps.test.mjs covers the module from literals; this is the CLI's own contract.

. "$(dirname "${BASH_SOURCE[0]}")/_helpers.sh"   # $WORK or refuse — see the gate there

STAMPS="$REPO_ROOT/index/cortex-stamps.mjs"
INDEX="$REPO_ROOT/index/cortex-index.mjs"
PROJ="$WORK/proj"
TPL="$WORK/templates"

# Read one field of the --json status: `jq`-free, so the test needs nothing the repo does not.
json_state() { # json path -> state
  node -e 'const j = JSON.parse(require("fs").readFileSync(0, "utf8")); const e = (j.files || []).find((f) => f.path === process.argv[1]); process.stdout.write(e ? e.state : "absent");' "$2" <<< "$1"
}

# --- a repo and a templates directory --------------------------------------------------------------

mkrepo "$PROJ"
mkdir -p "$TPL/loop"
for n in a b c d e f; do
  printf '# %s\n\nrun {{CMD}}\n' "$n" > "$TPL/loop/$n.md"
  printf '# %s\n\nrun npm test\n' "$n" > "$PROJ/$n.md"
done
printf '# readme\n' > "$PROJ/README.md"
( cd "$PROJ" || exit 1; git add -A && git commit -qm "stamped by /cortex" )

# --- record -----------------------------------------------------------------------------------------

for n in a b c d e f; do
  out="$(node "$STAMPS" record "$PROJ" "$n.md" "loop/$n.md" --templates "$TPL" --version 2.40.0 --value "CMD=npm test" 2>&1)"; rc=$?
  [ "$rc" -eq 0 ] || _fail "record $n.md exits 0" "rc=$rc" "$out"
done
assert_contains "$out" "Recorded f.md" "record says what it recorded"
assert_contains "$out" ".cortex/stamps.json" "and where"
assert_not_contains "$out" "ignored" "a repo with no ignore rule hears nothing about one"

# The target repo is otherwise unchanged: exactly one new file, and no temp file left behind.
changed="$(git -C "$PROJ" status --porcelain -uall)"
assert_eq "?? .cortex/stamps.json" "$changed" "record writes .cortex/stamps.json and nothing else"

rec="$(cat "$PROJ/.cortex/stamps.json")"
assert_contains "$rec" '"format": 1' "the record carries its format"
assert_contains "$rec" '"cortex": "2.40.0"' "and the version that wrote it"
assert_contains "$rec" '"CMD": "npm test"' "and the values it was rendered with"

# A value may contain a comma — a list flag would split it into two values and lose half.
node "$STAMPS" record "$PROJ" "a.md" "loop/a.md" --templates "$TPL" --version 2.40.0 --value "CMD=npm test -- a,b" >/dev/null 2>&1
assert_contains "$(cat "$PROJ/.cortex/stamps.json")" '"CMD": "npm test -- a,b"' "a value with a comma is kept whole"
node "$STAMPS" record "$PROJ" "a.md" "loop/a.md" --templates "$TPL" --version 2.40.0 --value "CMD=npm test" >/dev/null 2>&1

# A Windows-shaped path is the same file, not a second entry.
out="$(node "$STAMPS" record "$PROJ" '.\a.md' "loop/a.md" --templates "$TPL" --version 2.40.0 --value "CMD=npm test" 2>&1)"
assert_contains "$out" "Recorded a.md " "a .\\ path is accepted and recorded as the repo-relative path"
n_a="$(grep -c '"a.md"' "$PROJ/.cortex/stamps.json")"
assert_eq "1" "$n_a" "a .\\ path records the same entry"

# --- status: everything current ------------------------------------------------------------------

out="$(node "$STAMPS" "$PROJ" --templates "$TPL" 2>&1)"; rc=$?
assert_eq "0" "$rc" "status exits 0"
assert_contains "$out" "All 6 stamped files are current" "an untouched repo says so in one line"
assert_eq "?? .cortex/stamps.json" "$(git -C "$PROJ" status --porcelain -uall)" "status writes nothing"

# --- status: the six states from real changes -----------------------------------------------------

printf '\nOur own rule.\n' >> "$PROJ/b.md"                    # edited
printf '\nNew rule.\n'     >> "$TPL/loop/c.md"                # update
printf '\nOur own rule.\n' >> "$PROJ/d.md"                    # conflict
printf '\nNew rule.\n'     >> "$TPL/loop/d.md"
git -C "$PROJ" rm -q e.md                                     # missing
rm "$TPL/loop/f.md"                                           # retired

json="$(node "$STAMPS" "$PROJ" --templates "$TPL" --json 2>&1)"; rc=$?
assert_eq "0" "$rc" "status --json exits 0 with files out of date"
assert_eq "current"  "$(json_state "$json" a.md)" "an untouched file is current"
assert_eq "edited"   "$(json_state "$json" b.md)" "a file the team edited is edited"
assert_eq "update"   "$(json_state "$json" c.md)" "a template that moved under an untouched file is update"
assert_eq "conflict" "$(json_state "$json" d.md)" "both moved is conflict"
assert_eq "missing"  "$(json_state "$json" e.md)" "a deleted file is missing"
assert_eq "retired"  "$(json_state "$json" f.md)" "a template this Cortex no longer ships is retired"

out="$(node "$STAMPS" "$PROJ" --templates "$TPL" 2>&1)"; rc=$?
assert_eq "0" "$rc" "human status exits 0 too — out of date is information, not failure"
assert_contains "$out" "update (1)" "files are grouped by state"
assert_contains "$out" "c.md" "and each out-of-date file is named"
assert_not_contains "$out" "a.md" "a current file is not listed by default"
assert_contains "$out" "1 current" "but is counted"
out="$(node "$STAMPS" "$PROJ" --templates "$TPL" --all 2>&1)"
assert_contains "$out" "a.md" "--all lists the current ones too"

# A CRLF checkout is not an edit — the LF rule, end to end.
printf '# a\r\n\r\nrun npm test\r\n' > "$PROJ/a.md"
assert_eq "current" "$(json_state "$(node "$STAMPS" "$PROJ" --templates "$TPL" --json 2>&1)" a.md)" "a CRLF copy of the file still reads current"

# --- the plugin's own templates and VERSION are the defaults ------------------------------------

cp "$REPO_ROOT/templates/loop/REVIEW.md" "$PROJ/REVIEW.md"
out="$(node "$STAMPS" record "$PROJ" REVIEW.md loop/REVIEW.md 2>&1)"; rc=$?
assert_eq "0" "$rc" "record with no --templates reads the plugin's templates/"
ver="$(tr -d '\r\n' < "$REPO_ROOT/VERSION")"
assert_contains "$(cat "$PROJ/.cortex/stamps.json")" "\"version\": \"$ver\"" "and with no --version records the plugin's VERSION"
assert_eq "current" "$(json_state "$(node "$STAMPS" "$PROJ" --json 2>&1)" REVIEW.md)" "status reads the same templates by default"

# --- refusals ------------------------------------------------------------------------------------

# Each refusal is checked for its sentence as well as its code: an uncaught crash also exits 1, and
# a stack trace is not a refusal anyone can act on.
before="$(cat "$PROJ/.cortex/stamps.json")"
refusal() { # code needle message -- command...
  local want="$1" needle="$2" msg="$3"; shift 4
  local got rc; got="$("$@" 2>&1)"; rc=$?
  assert_eq "$want" "$rc" "$msg (exit $want)"
  assert_contains "$got" "$needle" "$msg (says why)"
  assert_not_contains "$got" "    at " "$msg (a sentence, not a stack trace)"
}
refusal 2 "Record runs after the file is written" "recording a file that is not there is refused" -- node "$STAMPS" record "$PROJ" nope.md loop/a.md --templates "$TPL"
refusal 1 "no template loop/nope.md" "recording against a template that does not exist is refused" -- node "$STAMPS" record "$PROJ" a.md loop/nope.md --templates "$TPL"
refusal 1 "--version must be X.Y.Z" "a version that is not x.y.z is refused" -- node "$STAMPS" record "$PROJ" a.md loop/a.md --templates "$TPL" --version latest
refusal 1 "--value must be KEY=VALUE" "a --value without KEY= is refused" -- node "$STAMPS" record "$PROJ" a.md loop/a.md --templates "$TPL" --value oops
refusal 1 "must not contain" "a path outside the repo is refused" -- node "$STAMPS" record "$PROJ" ../x.md loop/a.md --templates "$TPL"
refusal 1 "record needs a repo, a path and a template" "record needs its three arguments" -- node "$STAMPS" record "$PROJ" a.md
refusal 1 "templates directory not found" "a templates directory that is not there is refused" -- node "$STAMPS" "$PROJ" --templates "$WORK/nope"
assert_eq "$before" "$(cat "$PROJ/.cortex/stamps.json")" "no refusal touched the record"

printf '{ not json' > "$PROJ/.cortex/stamps.json"
out="$(node "$STAMPS" record "$PROJ" a.md loop/a.md --templates "$TPL" 2>&1)"; rc=$?
assert_eq "2" "$rc" "a damaged record is refused, never overwritten"
assert_contains "$out" "stamps.json" "and the refusal names the file"
assert_eq "{ not json" "$(cat "$PROJ/.cortex/stamps.json")" "the damaged file is left for the user to see"
assert_exit 2 "status on a damaged record is refused too" -- node "$STAMPS" "$PROJ" --templates "$TPL"

# --- no record is an answer, not an error ------------------------------------------------------------

mkrepo "$WORK/bare"
out="$(node "$STAMPS" "$WORK/bare" --templates "$TPL" 2>&1)"; rc=$?
assert_eq "0" "$rc" "a repo with no record exits 0"
assert_contains "$out" "No stamp record" "and says there is none"
json="$(node "$STAMPS" "$WORK/bare" --templates "$TPL" --json 2>&1)"
assert_contains "$json" '"files": null' "--json says null, never an empty list that reads as all current"
assert_eq "" "$(git -C "$WORK/bare" status --porcelain -uall)" "status on a repo with no record writes nothing"

# --- an ignored record: warned, written, and the .gitignore left alone -------------------------------

ign() { # dir rule
  mkrepo "$1"
  printf '# x\n' > "$1/x.md"
  printf '%s\n' "$2" > "$1/.gitignore"
  ( cd "$1" || exit 1; git add -A && git commit -qm init )
}

ign "$WORK/ign-dir" ".cortex/"
out="$(node "$STAMPS" record "$WORK/ign-dir" x.md loop/a.md --templates "$TPL" 2>&1)"; rc=$?
assert_eq "0" "$rc" "an ignored record is still written"
[ -f "$WORK/ign-dir/.cortex/stamps.json" ] && _pass "the file is on disk" || _fail "the file is on disk"
assert_contains "$out" "is ignored by .gitignore:1" "the warning names the rule that hides it"
assert_contains "$out" "will not be committed" "and what that costs"
assert_not_contains "$out" "Commit .cortex/stamps.json" "and it is not told to commit a file git will not take"
assert_contains "$out" '.cortex/*' "a directory rule is told to become .cortex/* — a negation under it cannot work"
assert_contains "$out" '!.cortex/stamps.json' "and names the negation"
assert_eq ".cortex/" "$(cat "$WORK/ign-dir/.gitignore")" "the user's .gitignore is not edited"
assert_eq "" "$(git -C "$WORK/ign-dir" status --porcelain)" "nothing git can see changed"
out="$(node "$STAMPS" "$WORK/ign-dir" --templates "$TPL" 2>&1)"
assert_contains "$out" "is ignored by .gitignore:1" "status repeats the warning while it holds"

# Before any record exists, --json already says the one it would write is ignored — so a first
# /cortex can offer the fix inside its single confirmation rather than after the write.
ign "$WORK/ign-first" ".cortex/"
json="$(node "$STAMPS" "$WORK/ign-first" --templates "$TPL" --json 2>&1)"
assert_contains "$json" '"files": null' "no record yet"
assert_contains "$json" '"dirIgnored": true' "and the ignore rule is reported all the same"

# The advice must actually work: apply it and git must see the file.
printf '.cortex/*\n!.cortex/stamps.json\n' > "$WORK/ign-dir/.gitignore"
assert_eq "?? .cortex/stamps.json" "$(git -C "$WORK/ign-dir" status --porcelain -uall | grep stamps)" "the advised fix makes the record visible to git"

ign "$WORK/ign-file" "*.json"
out="$(node "$STAMPS" record "$WORK/ign-file" x.md loop/a.md --templates "$TPL" 2>&1)"
assert_contains "$out" '!.cortex/stamps.json' "a file rule is told to add the negation"
assert_not_contains "$out" '.cortex/*' "and not to rewrite a rule that a negation already beats"

# What Cortex itself writes to .gitignore must not hide the record it asks the team to commit.
mkrepo "$WORK/indexed"
printf 'export const x = 1;\n' > "$WORK/indexed/x.js"
( cd "$WORK/indexed" || exit 1; git add -A && git commit -qm init )
node "$INDEX" "$WORK/indexed" >/dev/null 2>&1
assert_contains "$(cat "$WORK/indexed/.gitignore")" ".cortex/index/" "the fixture's .gitignore was written by cortex-index"
out="$(node "$STAMPS" record "$WORK/indexed" x.js loop/a.md --templates "$TPL" 2>&1)"
assert_not_contains "$out" "ignored" "Cortex's own ignore lines do not hide the record"
assert_contains "$out" "Commit .cortex/stamps.json" "and a first record that git will take is told to be committed"
assert_exit 1 "and git agrees it is not ignored" -- git -C "$WORK/indexed" check-ignore -q .cortex/stamps.json

# --- the whole loop: render, record, bump a template, update ------------------------------------------
#
# The real templates, copied so one can be bumped as a release would. The nine whole-file loop
# templates are stamped with realistic values; verification.md (appended to CLAUDE.md) and
# settings.hooks.json (merged into settings.json) are not recorded — the spec leaves a block inside a
# shared file unspecified, and a hash of the whole file would call every team edit to it a conflict.

REAL="$WORK/real"
RT="$WORK/real-templates"
VALS="$WORK/values"
mkrepo "$REAL"
cp -r "$REPO_ROOT/templates" "$RT"
mkdir -p "$VALS"

cat > "$VALS/REVIEW.md.json" <<'JSON'
{ "NIT_CAP": "3", "DO_NOT_REPORT": "- `dist/` is generated; never review it." }
JSON
cat > "$VALS/verifier.md.json" <<'JSON'
{ "RUN": "npm run dev" }
JSON
cat > "$VALS/protected-paths.sh.json" <<'JSON'
{ "PROTECTED_LIST": "dist/, prisma/migrations/", "PROTECTED_PATTERNS": "  \"*/dist/*\"\n  \"*/prisma/migrations/*\"" }
JSON
cat > "$VALS/format-changed.sh.json" <<'JSON'
{ "FORMAT_CASES": "  *.ts|*.tsx|*.js) npx prettier --write \"$path\" >/dev/null 2>&1 ;;" }
JSON
cat > "$VALS/intent-README.md.json" <<'JSON'
{ "OWNER": "The product owner", "LEGACY_NOTE": "" }
JSON
cat > "$VALS/intent.md.json" <<'JSON'
{}
JSON
cat > "$VALS/agent-evals.yml.json" <<'JSON'
{ "TEST_CMD": "npm test", "SETUP_STEPS": "" }
JSON
cat > "$VALS/cortex-review.yml.json" <<'JSON'
{ "CORTEX_REF": "v2.40.0" }
JSON
cat > "$VALS/bands.yaml.json" <<'JSON'
{ "METRIC": "p95 checkout latency", "READONLY_CMD": "curl -s https://metrics.example/p95", "RUNBOOK": "docs/runbook.md" }
JSON

# template → where /cortex puts it
LANDS="REVIEW.md:REVIEW.md verifier.md:.claude/agents/verifier.md protected-paths.sh:.claude/hooks/protected-paths.sh
format-changed.sh:.claude/hooks/format-changed.sh intent-README.md:intent/README.md intent.md:intent/TEMPLATE.md
agent-evals.yml:.github/workflows/agent-evals.yml cortex-review.yml:.github/workflows/cortex-review.yml bands.yaml:bands.yaml"

for pair in $LANDS; do
  t="${pair%%:*}"; dest="${pair#*:}"
  mkdir -p "$REAL/$(dirname "$dest")"
  node "$STAMPS" render "loop/$t" --templates "$RT" --values-file "$VALS/$t.json" > "$REAL/$dest"
  out="$(node "$STAMPS" record "$REAL" "$dest" "loop/$t" --templates "$RT" --version 2.40.0 --values-file "$VALS/$t.json" 2>&1)"
  assert_not_contains "$out" "not re-renderable" "$dest renders back from its values"
done

evals="$(cat "$REAL/.github/workflows/agent-evals.yml")"
assert_contains "$evals" 'Bash(npm test *)' "render fills a placeholder"
assert_contains "$evals" '${{ secrets.ANTHROPIC_API_KEY }}' "and leaves GitHub Actions syntax exactly as written"
assert_not_contains "$evals" 'SETUP_STEPS' "an empty whole-line value deletes the line"
assert_contains "$(cat "$REAL/intent/TEMPLATE.md")" '{{TITLE}}' "a placeholder with no value is kept, as TEMPLATE.md needs"

json="$(node "$STAMPS" "$REAL" --templates "$RT" --json 2>&1)"
counts="$(node -e 'const j = JSON.parse(require("fs").readFileSync(0, "utf8")); process.stdout.write(`${j.files.length} ${j.counts.current} ${j.files.filter((f) => f.renderable).length}`);' <<< "$json")"
assert_eq "9 9 9" "$counts" "nine files recorded, all current, all re-renderable"

# A file the model wrote more into than its values account for is recorded — and marked.
printf 'Reviewers also check the changelog.\n' >> "$REAL/REVIEW.md"
out="$(node "$STAMPS" record "$REAL" REVIEW.md loop/REVIEW.md --templates "$RT" --version 2.40.0 --values-file "$VALS/REVIEW.md.json" 2>&1)"; rc=$?
assert_eq "0" "$rc" "a file its values do not reproduce is still recorded"
assert_contains "$out" "not re-renderable" "and record says it cannot be updated automatically"
assert_contains "$out" "Reviewers also check the changelog." "naming the first line that differs"

( cd "$REAL" || exit 1; git add -A && git commit -qm "stamped by /cortex" )

# A release: every one of these templates gains a line; the team edits two of the files.
for t in verifier.md REVIEW.md agent-evals.yml bands.yaml; do printf '# added in the next release\n' >> "$RT/loop/$t"; done
printf 'watch closely\n' >> "$REAL/bands.yaml"                                # both moved: conflict
printf '# our note\n' >> "$REAL/.claude/hooks/format-changed.sh"               # team only: edited
bands_before="$(cat "$REAL/bands.yaml")"
hook_before="$(cat "$REAL/.claude/hooks/format-changed.sh")"
review_before="$(cat "$REAL/REVIEW.md")"

json="$(node "$STAMPS" "$REAL" --templates "$RT" --json 2>&1)"
assert_eq "update"   "$(json_state "$json" .claude/agents/verifier.md)" "a bumped template under an untouched file is update"
assert_eq "update"   "$(json_state "$json" .github/workflows/agent-evals.yml)" "including a workflow"
assert_eq "review"   "$(json_state "$json" REVIEW.md)" "a bumped template under a file it cannot re-render is review"
assert_eq "conflict" "$(json_state "$json" bands.yaml)" "both moved is conflict"
assert_eq "edited"   "$(json_state "$json" .claude/hooks/format-changed.sh)" "team only is edited"

out="$(node "$STAMPS" diff "$REAL" bands.yaml --templates "$RT" 2>&1)"; rc=$?
assert_eq "0" "$rc" "diff exits 0"
assert_contains "$out" "-watch closely" "the diff shows the team's line"
assert_contains "$out" "+# added in the next release" "and the template's"

refusal 1 "conflict" "update refuses a named file that is not safe to update" -- node "$STAMPS" update "$REAL" bands.yaml --templates "$RT" --version 2.40.0
assert_eq "$bands_before" "$(cat "$REAL/bands.yaml")" "and does not touch it"
verifier_before="$(cat "$REAL/.claude/agents/verifier.md")"
refusal 1 "Nothing was written" "named paths are all or nothing" -- node "$STAMPS" update "$REAL" .claude/agents/verifier.md bands.yaml --templates "$RT" --version 2.40.0
assert_eq "$verifier_before" "$(cat "$REAL/.claude/agents/verifier.md")" "so the safe one named beside it is not written either"
refusal 1 "given twice" "a value given twice is refused, not resolved by order" -- node "$STAMPS" record "$REAL" REVIEW.md loop/REVIEW.md --templates "$RT" --values-file "$VALS/REVIEW.md.json" --value NIT_CAP=9

out="$(node "$STAMPS" update "$REAL" --templates "$RT" --version 2.41.0 2>&1)"; rc=$?
assert_eq "0" "$rc" "update applies every update file"
assert_contains "$out" "Updated .claude/agents/verifier.md" "and names each one"
assert_contains "$(cat "$REAL/.claude/agents/verifier.md")" "# added in the next release" "the file carries the new template's line"
assert_contains "$(cat "$REAL/.claude/agents/verifier.md")" "npm run dev" "rendered with the recorded value"
assert_eq "$bands_before" "$(cat "$REAL/bands.yaml")" "a conflict is never rewritten"
assert_eq "$hook_before" "$(cat "$REAL/.claude/hooks/format-changed.sh")" "an edited file is never rewritten"
assert_eq "$review_before" "$(cat "$REAL/REVIEW.md")" "a file that cannot be re-rendered is never rewritten"

json="$(node "$STAMPS" "$REAL" --templates "$RT" --json 2>&1)"
assert_eq "current" "$(json_state "$json" .claude/agents/verifier.md)" "an updated file reads current again"
assert_eq "current" "$(json_state "$json" .github/workflows/agent-evals.yml)" "every one of them"
assert_contains "$json" '"cortex": "2.41.0"' "and the record names the release that updated it"
changed="$(git -C "$REAL" status --porcelain -uall | sed 's/^...//' | sort | tr '\n' ' ')"
assert_eq ".claude/agents/verifier.md .claude/hooks/format-changed.sh .cortex/stamps.json .github/workflows/agent-evals.yml bands.yaml " "$changed" "update wrote the update files and the record, nothing else (the other two are the team's edits)"

# A release whose template gains a placeholder nothing recorded can fill: rendering would leave
# `{{OWNER}}` in a file every agent reads, so the update is refused and the file left alone.
printf 'Owner: {{OWNER}}\n' >> "$RT/loop/verifier.md"
verifier_before="$(cat "$REAL/.claude/agents/verifier.md")"
out="$(node "$STAMPS" update "$REAL" --templates "$RT" --version 2.41.0 2>&1)"; rc=$?
assert_eq "1" "$rc" "an update that had to refuse a file exits 1"
assert_contains "$out" "{{OWNER}}" "naming the placeholder with no recorded value"
assert_eq "$verifier_before" "$(cat "$REAL/.claude/agents/verifier.md")" "and leaves the file as it was"

# --- an older plugin: a teammate a release behind --------------------------------------------------------
#
# The record is shared, the plugin is per machine. Against a record a newer Cortex wrote, this plugin's
# own templates are the older ones, so an untouched file reads as update — and applying it would put
# the older template back. Status names the older plugin with the two commands that update it, and
# update refuses the whole plan. VERSION is this checkout's; 9.0.0 is newer than any it will be soon,
# and the refusal is checked without --version, which is how a teammate runs it.

NEWER="$WORK/newer"
NT="$WORK/newer-templates"
mkrepo "$NEWER"
cp -r "$REPO_ROOT/templates" "$NT"
mkdir -p "$NEWER/.claude/agents"
node "$STAMPS" render loop/verifier.md --templates "$NT" --values-file "$VALS/verifier.md.json" > "$NEWER/.claude/agents/verifier.md"
node "$STAMPS" record "$NEWER" .claude/agents/verifier.md loop/verifier.md --templates "$NT" --version 9.0.0 --values-file "$VALS/verifier.md.json" >/dev/null 2>&1
( cd "$NEWER" || exit 1; git add -A && git commit -qm "stamped by a newer /cortex" )
printf '# what the older release said\n' > "$NT/loop/verifier.md"      # this plugin's template differs
verifier_before="$(cat "$NEWER/.claude/agents/verifier.md")"
record_before="$(cat "$NEWER/.cortex/stamps.json")"
UPDATE_STEPS='`claude plugin marketplace update cortex`, then `claude plugin update cortex@cortex`, then `/reload-plugins` or a new session'

out="$(node "$STAMPS" "$NEWER" --templates "$NT" 2>&1)"; rc=$?
assert_eq "0" "$rc" "status on a newer record exits 0 — it is information"
assert_contains "$out" "stamped by Cortex 9.0.0 and this is Cortex $ver, an older plugin" "status names both releases"
assert_contains "$out" "$UPDATE_STEPS" "and the two commands, in order, then the reload"
json="$(node "$STAMPS" "$NEWER" --templates "$NT" --json 2>&1)"
older="$(node -e 'const j = JSON.parse(require("fs").readFileSync(0, "utf8")); const o = j.olderPlugin; process.stdout.write(o ? `${o.stamped} ${o.running} ${o.commands.join("|")}` : "null");' <<< "$json")"
assert_eq "9.0.0 $ver claude plugin marketplace update cortex|claude plugin update cortex@cortex" "$older" "--json carries both releases and both commands"
assert_contains "$json" "$UPDATE_STEPS" "and the same sentence"
assert_eq "update" "$(json_state "$json" .claude/agents/verifier.md)" "the hazard: to this plugin, the untouched file looks like an update"

refusal 1 "an older plugin" "update on an older plugin is refused" -- node "$STAMPS" update "$NEWER" --templates "$NT"
refusal 1 "Nothing was written" "all of it, with nothing written" -- node "$STAMPS" update "$NEWER" --templates "$NT"
refusal 1 "$UPDATE_STEPS" "and the refusal says how to update" -- node "$STAMPS" update "$NEWER" .claude/agents/verifier.md --templates "$NT"
assert_eq "$verifier_before" "$(cat "$NEWER/.claude/agents/verifier.md")" "the file a newer Cortex stamped is untouched"
assert_eq "$record_before" "$(cat "$NEWER/.cortex/stamps.json")" "and so is the record"
assert_eq "" "$(git -C "$NEWER" status --porcelain -uall)" "nothing git can see changed"

out="$(node "$STAMPS" diff "$NEWER" .claude/agents/verifier.md --templates "$NT" 2>&1)"
assert_contains "$out" "an older plugin" "diff says its comparison is against an older template"

out="$(node "$REPO_ROOT/index/cortex-next.mjs" "$NEWER" 2>&1)"
assert_contains "$out" "Update the Cortex plugin" "cortex-next asks for the plugin update"
assert_contains "$out" "$UPDATE_STEPS" "with the same two commands"
assert_contains "$out" "claude plugin marketplace update cortex && claude plugin update cortex@cortex" "as the command to copy"

# The same release: nothing to say.
EQ="$WORK/same-release"
mkrepo "$EQ"
cp "$REPO_ROOT/templates/loop/REVIEW.md" "$EQ/REVIEW.md"
node "$STAMPS" record "$EQ" REVIEW.md loop/REVIEW.md >/dev/null 2>&1
out="$(node "$STAMPS" "$EQ" 2>&1)"
assert_not_contains "$out" "older plugin" "a record this release wrote raises no warning"
assert_contains "$(node "$STAMPS" "$EQ" --json 2>&1)" '"olderPlugin": null' "--json says null"

# --- adoption: a repo /cortex stamped before the record existed -----------------------------------------
#
# The same nine files at the same locations, and no .cortex/stamps.json — what every repo installed by
# 2.39.x looks like. Nothing about them is known: not the release, not the values, not whether the
# team has edited them since. So adopting records them with nothing known, they read as `conflict`,
# and each is compared with this release's template before anything changes. Adopting writes the
# record and nothing else.

OLD="$WORK/old-install"
mkrepo "$OLD"
for pair in $LANDS; do
  t="${pair%%:*}"; dest="${pair#*:}"
  mkdir -p "$OLD/$(dirname "$dest")"
  node "$STAMPS" render "loop/$t" --templates "$REPO_ROOT/templates" --values-file "$VALS/$t.json" > "$OLD/$dest" 2>/dev/null
done
( cd "$OLD" || exit 1; git add -A && git commit -qm "stamped by /cortex 2.39.1" )

out="$(node "$STAMPS" "$OLD" 2>&1)"; rc=$?
assert_eq "0" "$rc" "status on an older install exits 0"
assert_contains "$out" "9 loop files" "and names how many files it could adopt"
assert_contains "$out" "adopt" "and the command that does it"
json="$(node "$STAMPS" "$OLD" --json 2>&1)"
n_adopt="$(node -e 'const j = JSON.parse(require("fs").readFileSync(0, "utf8")); process.stdout.write(`${j.files} ${j.adopt.length}`);' <<< "$json")"
assert_eq "null 9" "$n_adopt" "--json: no record, nine to adopt"

refusal 1 "not a loop file" "adopting a path /cortex never writes is refused" -- node "$STAMPS" adopt "$OLD" src/app.ts
assert_eq "" "$(git -C "$OLD" status --porcelain -uall)" "and writes nothing"

out="$(node "$STAMPS" adopt "$OLD" 2>&1)"; rc=$?
assert_eq "0" "$rc" "adopt exits 0"
assert_contains "$out" "Adopted 9" "and says how many"
assert_eq "?? .cortex/stamps.json" "$(git -C "$OLD" status --porcelain -uall)" "adopting writes the record and not one byte of any loop file"

json="$(node "$STAMPS" "$OLD" --json 2>&1)"
states="$(node -e 'const j = JSON.parse(require("fs").readFileSync(0, "utf8")); process.stdout.write([...new Set(j.files.map((f) => f.state))].join(",") + " " + j.cortex);' <<< "$json")"
assert_eq "conflict null" "$states" "every adopted file is conflict, and no release is claimed for them"
out="$(node "$STAMPS" "$OLD" 2>&1)"
assert_contains "$out" "adopted, release unknown" "status says what is not known rather than inventing a version"
assert_not_contains "$out" "older plugin" "and a record no known release wrote is never newer than this one"
assert_contains "$json" '"olderPlugin": null' "--json agrees"

out="$(node "$STAMPS" update "$OLD" 2>&1)"; rc=$?
assert_eq "0" "$rc" "update on adopted files is not an error"
assert_contains "$out" "Nothing to update" "and rewrites nothing"
assert_eq "?? .cortex/stamps.json" "$(git -C "$OLD" status --porcelain -uall)" "still not one byte of a loop file"
out="$(node "$STAMPS" diff "$OLD" REVIEW.md 2>&1)"
assert_contains "$out" "REVIEW.md: conflict" "the per-file question has its evidence"

refusal 1 "already has" "adopting again, once a record exists, is refused" -- node "$STAMPS" adopt "$OLD"

# Resolving one: the user compared it and kept it — record it with the values it was written with.
node "$STAMPS" record "$OLD" REVIEW.md loop/REVIEW.md --values-file "$VALS/REVIEW.md.json" >/dev/null 2>&1
assert_eq "current" "$(json_state "$(node "$STAMPS" "$OLD" --json 2>&1)" REVIEW.md)" "a resolved adoption reads current"

# Dropping one from the record: the file is left exactly where it is.
bands_before="$(cat "$OLD/bands.yaml")"
out="$(node "$STAMPS" forget "$OLD" bands.yaml 2>&1)"; rc=$?
assert_eq "0" "$rc" "forget exits 0"
assert_eq "absent" "$(json_state "$(node "$STAMPS" "$OLD" --json 2>&1)" bands.yaml)" "the entry is gone from the record"
assert_eq "$bands_before" "$(cat "$OLD/bands.yaml")" "and the file is untouched"
refusal 1 "not in the record" "forgetting a path the record does not hold is refused" -- node "$STAMPS" forget "$OLD" nope.md

# Adopting a subset: only what was named.
OLD2="$WORK/old-install-2"
cp -r "$OLD" "$OLD2"; rm -f "$OLD2/.cortex/stamps.json"
node "$STAMPS" adopt "$OLD2" REVIEW.md .claude/agents/verifier.md >/dev/null 2>&1
json="$(node "$STAMPS" "$OLD2" --json 2>&1)"
n="$(node -e 'const j = JSON.parse(require("fs").readFileSync(0, "utf8")); process.stdout.write(j.files.map((f) => f.path).join(","));' <<< "$json")"
assert_eq ".claude/agents/verifier.md,REVIEW.md" "$n" "adopting named paths records exactly those"
