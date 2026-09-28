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
