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

