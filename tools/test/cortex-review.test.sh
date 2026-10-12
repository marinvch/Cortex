# Cortex writes context documents; this is the first thing that reads them back.
#
# index/test/review.test.mjs covers the matching. This covers what a user runs, and the two failures
# that matter are both about honesty rather than crashes: claiming a rule exists when the repo has no
# context layer, and staying quiet about documents the change may have just made wrong.

. "$(dirname "${BASH_SOURCE[0]}")/_helpers.sh"   # $WORK or refuse — see the gate there

REVIEW="$REPO_ROOT/index/cortex-review.mjs"

fixture() {
  rm -rf "$WORK/proj"
  mkdir -p "$WORK/proj/src/lib" "$WORK/proj/docs/adr"
  cd "$WORK/proj" || exit 1
  git init -q .; git config user.email t@t; git config user.name t

  printf 'export const coverage = 1;\n'                 > src/lib/coverage.mjs
  printf 'import { coverage } from "./coverage.mjs";\n' > src/lib/use.mjs
  printf '{ "name": "p", "version": "1.0.0" }\n'        > package.json
  printf '# Root\n\nCoverage uses two signals, in src/lib/coverage.mjs.\n' > AGENTS.md
  printf '@AGENTS.md\n'                                  > CLAUDE.md
  printf '# lib\n\nRules for this directory.\n'          > src/lib/AGENTS.md
  printf '# Terms\n\n## Coverage\n\nWhich tests exercise which file.\n' > CONTEXT.md
  printf '# 1. A decision\n\nAbout src/lib/coverage.mjs.\n' > docs/adr/0001-a-decision.md

  git add -A && git commit -qm init
  node "$REPO_ROOT/index/cortex-index.mjs" . >/dev/null 2>&1
  cd "$REPO_ROOT" || exit 1
}

fixture
run() { node "$REVIEW" --root "$WORK/proj" "$@" 2>&1; }

# --- the governing set ------------------------------------------------------------------------------

out="$(run src/lib/coverage.mjs)"
assert_contains "$out" "src/lib/AGENTS.md" "the leaf that owns the directory governs"
assert_contains "$out" "AGENTS.md" "and so does the root"
assert_not_contains "$out" "CLAUDE.md" "a shim is not a third authority"

# Nearest first: a review that reads the root and stops has missed the rules written for exactly
# this directory, so the order is the instruction.
first="$(printf '%s' "$out" | sed -n '/governing this change/,$p' | grep -oE '[a-zA-Z/.]*AGENTS\.md' | head -1)"
assert_eq "src/lib/AGENTS.md" "$first" "the nearest brief is listed first"

# --- the drift half ---------------------------------------------------------------------------------

# This is the finding the author cannot see: the code looks right, and the sentence describing it
# lives in another file. The fixture's AGENTS.md says "two signals" about the file being changed.
assert_contains "$out" "NAME something this change touched" "documents naming the file are surfaced"
# Assert the RENDERED mention — ":<line>  <text>" — not just the phrase. The footer quotes
# "Coverage uses two signals" as a cautionary example, so a bare phrase match passed even with the
# line text deleted from the output entirely. A guard that matches the tool's own prose guards
# nothing.
assert_contains "$out" ":3  Coverage uses two signals" "the line itself is quoted, with its number"
assert_contains "$out" "docs/adr/0001-a-decision.md" "an ADR naming the file counts too"

# A mention is evidence, not a verdict. The tool must not read as an accusation.
assert_contains "$out" "not a defect" "a mention is stated as a place to look, not a finding"

# A file nothing names produces no drift list, and says what that does NOT prove.
out2="$(run src/lib/use.mjs)"
assert_contains "$out2" "No context document names" "silence is reported explicitly"
assert_contains "$out2" "not proof" "and is not dressed up as a clean bill of health"

# --- refusing to review against nothing ---------------------------------------------------------

# Improvising a review from general principles is how a tool that claims to check DOCUMENTED rules
# starts inventing them.
rm -rf "$WORK/bare"; mkdir -p "$WORK/bare/src"; cd "$WORK/bare" || exit 1
git init -q .; git config user.email t@t; git config user.name t
printf 'export const a = 1;\n' > src/a.js
printf '{ "name": "b", "version": "1.0.0" }\n' > package.json
git add -A && git commit -qm init
node "$REPO_ROOT/index/cortex-index.mjs" . >/dev/null 2>&1
cd "$REPO_ROOT" || exit 1
out3="$(node "$REVIEW" --root "$WORK/bare" src/a.js 2>&1)"
assert_contains "$out3" "no context layer" "a repo with no documents says so"
assert_contains "$out3" "cortex-install" "and names what would create one"

# --- flags and refusals ---------------------------------------------------------------------------

out4="$(run src/lib/coverage.mjs --json)"
assert_contains "$out4" '"stale"' "--json exposes the drift list"
assert_contains "$out4" '"briefs"' "and the governing set"

out5="$(run src/lib/nope.mjs)"
assert_contains "$out5" "Not in the index" "an unknown path is reported, not swallowed"

rm -rf "$WORK/proj/.cortex"
out6="$(run src/lib/coverage.mjs)"; rc=$?
assert_eq "2" "$rc" "a missing index is a refusal, not an empty review"

# --- a root that is not a directory ------------------------------------------------------------
#
# The check has no error state without it: buildIndex on a directory that does not exist returns
# zero files rather than throwing, so this command answered confidently about a repository that
# was never there — and two of its siblings wrote into one they invented from a mangled flag.
# index/test/root.test.mjs covers the predicate; this covers that THIS command consults it.

mkdir -p "$WORK/guard" && printf 'x
' > "$WORK/a-file"
out="$(cd "$WORK/guard" && node "${REVIEW}" --root "$WORK/no-such-repo" --staged 2>&1)"; rc=$?
assert_eq "1" "$rc" "a root that does not exist is refused"
assert_contains "$out" "not a directory" "and says what is wrong with it"
assert_contains "$out" "Nothing was changed" "and that nothing happened"
[ -n "$(ls -A "$WORK/guard" 2>/dev/null)" ] && _fail "and nothing is created anywhere" || _pass "and nothing is created anywhere"

# existsSync would pass a file. Walking one as though it were a repository is the same bug.
out="$(node "${REVIEW}" --root "$WORK/a-file" --staged 2>&1)"; rc=$?
assert_eq "1" "$rc" "a file passed as a root is refused too"

# --- git failing is not a branch with no changes -------------------------------------------------
#
# Same reader as cortex-impact, now shared. The maxBuffer fix lived in THIS file and not in that
# one for exactly as long as there were two copies of it.

fixture
out="$(run --since definitely-not-a-ref)"; rc=$?
assert_eq "2" "$rc" "an unreadable change set is a refusal"
assert_contains "$out" "git could not resolve --since" "and names the source that failed"
assert_contains "$out" "git failing, not a branch with no changes" "and refuses to read as an empty diff"
assert_not_contains "$out" "nothing to review" "never the wording used for a genuinely clean branch"

out="$(run --since HEAD)"; rc=$?
assert_eq "2" "$rc" "an empty diff is still nothing to review"
assert_contains "$out" "nothing to review" "and is described as such"
assert_not_contains "$out" "git could not resolve" "with no fault reported, because there was none"

# --- --rules: what each rule in the briefs names -----------------------------------------------
#
# index/test/rule-ledger.test.mjs covers the reading. This covers the sentences a person acts on.
# The failure that matters is the count being read as a score: "names no test" printed as
# "unenforced" would accuse a gotcha no test could pin, so the word must not appear at all.

rules_fixture() {
  rm -rf "$WORK/proj"
  mkdir -p "$WORK/proj/src" "$WORK/proj/test"
  cd "$WORK/proj" || exit 1
  git init -q .; git config user.email t@t; git config user.name t

  printf 'export const guard = 1;\n'                                  > src/paths.js
  printf 'import { guard } from "../src/paths.js";\n'                 > test/paths.test.js
  printf '{ "name": "p", "version": "1.0.0" }\n'                      > package.json
  printf '@AGENTS.md\n'                                               > CLAUDE.md
  {
    printf '# Root\n\n## Invariants\n\n'
    printf -- '- **Every path goes through the guard.** It wraps here, and\n'
    printf '  `test/paths.test.js` pins it.\n'
    printf -- '- **The guard lives in one place**, `src/paths.js`.\n'
    printf -- '- **Never guess an alias.** Read it from the repo.\n'
    printf '\n## Layout\n\n'
    printf -- '- **src/**: the code, in `src/paths.js`\n'
  } > AGENTS.md
  printf '# src\n\nRules for this directory.\n\n## Gotchas\n\n- Imports stay relative.\n' > src/AGENTS.md
  printf '# test\n\nHow the tests are laid out.\n\n## Layout\n\n- one file per module\n' > test/AGENTS.md

  git add -A && git commit -qm init
  node "$REPO_ROOT/index/cortex-index.mjs" . >/dev/null 2>&1
  cd "$REPO_ROOT" || exit 1
}

rules_fixture
rules_print() { find "$WORK/proj" -type f -not -path '*/.git/*' | sort | while read -r f; do printf '%s %s\n' "$f" "$(cksum < "$f")"; done; }
before="$(rules_print)"

out="$(run --rules)"; rc=$?
assert_eq "0" "$rc" "--rules exits 0 whatever it lists"
assert_contains "$out" "(4, from 3 briefs)" "it counts the items in the rules sections, and the briefs it read"
assert_contains "$out" "1 of those briefs has no section headed Invariants, Gotchas or Rules" "a brief with no rules section is said to be uncounted"
assert_contains "$out" "   1  name a test file" "one rule names a test"
assert_contains "$out" "   1  name other files, none of them a test" "one names only the implementation"
assert_contains "$out" "   2  name no file" "two name nothing"
assert_contains "$out" "AGENTS.md:7  **The guard lives in one place**" "a row is quoted with its document and line"
assert_contains "$out" "names src/paths.js" "and with the files it does name"
assert_contains "$out" "src/AGENTS.md:7  Imports stay relative." "a leaf brief's rules are listed too, bold or not"
assert_not_contains "$out" "Every path goes through the guard" "a rule that names a test is counted, not listed"
assert_not_contains "$out" "the code, in" "an item under another heading is not a rule, bold or not"
assert_contains "$out" "A row is not a defect" "the list is stated as places to look"
case "$out" in *nforc*) _fail "the word enforced appears nowhere in the output" ;; *) _pass "the word enforced appears nowhere in the output" ;; esac

json="$(node "$REVIEW" --root "$WORK/proj" --rules --json 2>/dev/null)"; rc=$?
assert_eq "0" "$rc" "--rules --json exits 0"
assert_contains "$json" '"state": "test"' "--json lists the rows the summary only counts"
assert_contains "$json" '"test/paths.test.js"' "with the test each one names"
assert_eq "$json" "$(node "$REVIEW" --root "$WORK/proj" --rules --json 2>/dev/null)" "two runs print the same bytes"

assert_eq "$before" "$(rules_print)" "the target tree is byte-identical afterwards"

# A change set beside --rules is refused. Ignoring it would print the whole repo's ledger to
# someone who asked about one file.
out="$(run --rules --staged)"; rc=$?
assert_eq "2" "$rc" "--rules with --staged is refused"
assert_contains "$out" "Remove --staged" "and names what to remove"
out="$(run --rules src/paths.js)"; rc=$?
assert_eq "2" "$rc" "--rules with a file path is refused"

# An empty ledger is not a clean one. A brief with no rules section yields no rows, and the
# reader is told where this looked.
cd "$WORK/proj" || exit 1
printf '# Root\n\nAll paths go through the guard.\n\nNever guess an alias.\n\nRead it from the repo.\n' > AGENTS.md
rm src/AGENTS.md test/AGENTS.md
git add -A && git commit -qm prose
node "$REPO_ROOT/index/cortex-index.mjs" . >/dev/null 2>&1
cd "$REPO_ROOT" || exit 1
out="$(run --rules)"; rc=$?
assert_eq "0" "$rc" "a brief with no rules section still exits 0"
assert_contains "$out" "1 brief read, and none has a section headed Invariants, Gotchas or Rules" "and says where it looked"
assert_contains "$out" "not proof the briefs state no rules" "never that the repo has no rules"

cd "$WORK/proj" || exit 1
git rm -q AGENTS.md CLAUDE.md && git commit -qm none
node "$REPO_ROOT/index/cortex-index.mjs" . >/dev/null 2>&1
cd "$REPO_ROOT" || exit 1
out="$(run --rules)"; rc=$?
assert_eq "0" "$rc" "a repo with no brief exits 0"
assert_contains "$out" "This repo has no brief" "and says there is nothing to list"

