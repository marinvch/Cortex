# tools/cortex-release-plan.mjs — what .github/workflows/release.yml does with one push to master.
#
# The workflow cuts a release when a merge changes VERSION (ADR 0022). Everything it decides is in
# this script, so it can be run here on scratch repos: did VERSION change, is the tree fit to
# release, is the tag already on the remote, does this version take Latest. A bare repo on disk is
# the remote, so nothing here reaches the network and nothing here creates a release.
#
# Two properties hold in every case. A refusal exits 1 and prints nothing on stdout, so a workflow
# that appends stdout to $GITHUB_OUTPUT gets no action from it. And the notes file exists only
# when the answer is `release`.

. "$(dirname "${BASH_SOURCE[0]}")/_helpers.sh"   # $WORK or refuse — see the gate there

TOOL="$REPO_ROOT/tools/cortex-release-plan.mjs"
cd "$WORK" || exit 1

# --- the scratch repo -------------------------------------------------------------------------------

sites() { # version — the seven sites cortex-version.mjs checks
  printf '%s\n' "$1" > r/VERSION
  for f in .claude-plugin/plugin.json .claude-plugin/marketplace.json mcp/package.json core/package.json; do
    printf '{\n  "version": "%s"\n}\n' "$1" > "r/$f"
  done
  printf '# R\n\n**v%s** installable\n' "$1" > r/README.md
}

changelog() { # versions, newest first
  {
    printf '# Changelog\n\n## [Unreleased]\n\n'
    for v in "$@"; do printf '## [%s] — 2026-01-01\n\nNotes for %s.\n\n' "$v" "$v"; done
    for v in "$@"; do printf '[%s]: https://example.com/releases/tag/v%s\n' "$v" "$v"; done
  } > r/CHANGELOG.md
}

commit() { git -C r add -A && git -C r commit -q -m "$1"; }
head_sha() { git -C r rev-parse HEAD; }

VERSIONS=""
stamp() { # version — every site, a changelog section, one commit
  VERSIONS="$1 $VERSIONS"
  sites "$1"
  # shellcheck disable=SC2086
  changelog $VERSIONS
  commit "stamp $1"
}

fresh() { # a repo stamped 2.0.0, with an empty bare remote named origin
  rm -rf r origin.git notes.md
  mkrepo r
  git init -q --bare origin.git
  git -C r remote add origin ../origin.git
  mkdir -p r/.claude-plugin r/mcp r/core
  VERSIONS=""
  stamp 2.0.0
}

# plan <before> [args...] — stdout in $out, stderr in $err, exit code in $rc.
plan() {
  local before="$1"
  shift
  rm -f notes.md
  out="$(node "$TOOL" --repo r --before "$before" --notes-out notes.md "$@" 2>stderr.txt)"
  rc=$?
  err="$(cat stderr.txt)"
  # An uncaught exception also exits 1 with nothing on stdout, which is what a refusal looks like.
  case "$err" in *"    at "*) CRASHED="$CRASHED [$before $*]" ;; esac
}
CRASHED=""

value() { printf '%s\n' "$out" | sed -n "s/^$1=//p"; }
has_notes() { if [ -e notes.md ]; then echo yes; else echo no; fi; }

# --- VERSION unchanged ------------------------------------------------------------------------------

fresh
before="$(head_sha)"
echo x > r/other.txt
commit "a change that stamps nothing"
plan "$before"
assert_eq "0" "$rc" "a push that leaves VERSION alone exits 0"
assert_eq "none" "$(value action)" "and plans nothing"
assert_contains "$out" "VERSION unchanged" "and says so in the words the run log is checked for"
assert_eq "no" "$(has_notes)" "and writes no notes"
assert_eq "" "$err" "and nothing on stderr"

# The sites disagree and the changelog is unusable, and neither is this push's doing.
echo '{ "version": "9.9.9" }' > r/core/package.json
echo junk > r/CHANGELOG.md
before="$(head_sha)"
commit "breaks a site without stamping"
plan "$before"
assert_eq "none" "$(value action)" "an unchanged VERSION is never checked further: nothing is being released"

# --- VERSION raised ---------------------------------------------------------------------------------

fresh
before="$(head_sha)"
stamp 2.0.1
plan "$before"
assert_eq "0" "$rc" "a push that raises VERSION exits 0"
assert_eq "release" "$(value action)" "and plans a release"
assert_eq "2.0.1" "$(value version)" "of the version at the pushed commit"
assert_eq "2.0.0" "$(value previous)" "naming the version before the push"
assert_eq "v2.0.1" "$(value tag)" "under the tag v<version>"
assert_eq "$(head_sha)" "$(value target)" "on the pushed commit"
assert_eq "true" "$(value latest)" "as Latest, with no tag on the remote at all"
assert_eq "Notes for 2.0.1." "$(cat notes.md)" "and the notes file holds that version's changelog section"
assert_eq "" "$err" "with nothing on stderr"

plan "$before" --sha "$(head_sha)"
assert_eq "release" "$(value action)" "--sha naming the checked-out commit changes nothing"

plan "$before" --sha "$before"
assert_eq "1" "$rc" "--sha naming another commit is refused: the files read would not be that commit's"
assert_eq "" "$out" "with nothing on stdout"
assert_contains "$err" "checkout is at" "and the reason"

# --- a merge commit -----------------------------------------------------------------------------------

fresh
before="$(head_sha)"
git -C r checkout -q -b feature
stamp 2.1.0
branch_tip="$(head_sha)"
git -C r checkout -q -
echo y > r/meanwhile.txt
commit "master moved while the branch was open"
before="$(head_sha)"
git -C r merge -q --no-ff -m "Merge the stamped branch" feature
plan "$before"
assert_eq "release" "$(value action)" "a merge commit whose first parent holds the old version plans a release"
assert_eq "2.0.0" "$(value previous)" "the old version is read from the commit before the push"
assert_eq "$(head_sha)" "$(value target)" "and the target is the merge commit"
assert_eq "no" "$(if [ "$(value target)" = "$branch_tip" ]; then echo yes; else echo no; fi)" "not the branch commit that stamped it"

# --- a push that carried several commits ------------------------------------------------------------

fresh
before="$(head_sha)"
stamp 2.0.1
echo z > r/after.txt
commit "a later commit in the same push"
plan "$before"
assert_eq "release" "$(value action)" "VERSION is compared across the whole push, not the last commit"
assert_eq "$(head_sha)" "$(value target)" "and the tip is what gets the tag"

# --- lowered, malformed, missing ----------------------------------------------------------------------

fresh
before="$(head_sha)"
sites 1.9.0
commit "lower the version"
plan "$before"
assert_eq "1" "$rc" "a lowered VERSION is refused"
assert_eq "" "$out" "with nothing on stdout"
assert_contains "$err" "from 2.0.0 to 1.9.0, which is not higher" "and the reason"
assert_eq "no" "$(has_notes)" "and no notes"

fresh
before="$(head_sha)"
sites 2.00.0
commit "the same version, written differently"
plan "$before"
assert_eq "1" "$rc" "a VERSION that changed its text and not its value is refused: it is not a new version"
assert_contains "$err" "which is not higher" "by the comparison, before the sites are compared"

fresh
before="$(head_sha)"
sites 2.0
commit "half a version"
plan "$before"
assert_eq "1" "$rc" "a VERSION that is not x.y.z is refused"
assert_eq "" "$out" "with nothing on stdout"
assert_contains "$err" "not a version" "and the reason"

fresh
before="$(head_sha)"
sites v2.0.1
commit "a tag name in VERSION"
plan "$before"
assert_eq "1" "$rc" "a VERSION with a leading v is refused: the tag would be vv2.0.1"
assert_contains "$err" "not a version" "by this script, before the sites are compared"

fresh
before="$(head_sha)"
git -C r rm -q VERSION
commit "delete VERSION"
plan "$before"
assert_eq "1" "$rc" "a deleted VERSION is refused"
assert_eq "" "$out" "with nothing on stdout"

# The version before the push cannot be read, so "raised" cannot be shown.
fresh
git -C r rm -q VERSION
commit "delete VERSION"
before="$(head_sha)"
stamp 2.0.1
plan "$before"
assert_eq "1" "$rc" "a VERSION that did not exist before the push is refused"
assert_contains "$err" "cannot be shown to be higher" "and the reason"

# --- no commit before the push ------------------------------------------------------------------------

fresh
plan ""
assert_eq "1" "$rc" "an empty --before is refused"
assert_eq "" "$out" "with nothing on stdout"
plan "0000000000000000000000000000000000000000"
assert_eq "1" "$rc" "the all-zero id of a first push is refused"
assert_contains "$err" "no commit before" "and the reason"
plan "1234567890123456789012345678901234567890"
assert_eq "1" "$rc" "a commit this checkout does not hold is refused"
assert_contains "$err" "fetch-depth" "and the likely cause is named"
plan "--help"
assert_eq "1" "$rc" "a --before that is not a commit id is refused"
assert_contains "$err" "not a commit id" "before it reaches git as an option"

# A rewritten branch: the commit before the push is not in the history of the one pushed.
fresh
git -C r checkout -q -b side
echo s > r/side.txt
commit "on a side branch"
before="$(head_sha)"
git -C r checkout -q -
stamp 2.0.1
plan "$before"
assert_eq "1" "$rc" "a --before that is not an ancestor of the pushed commit is refused"
assert_contains "$err" "ancestor" "and the reason"

# --- the tag is already on the remote ---------------------------------------------------------------

fresh
before="$(head_sha)"
stamp 2.0.1
git -C r tag v2.0.1
plan "$before"
assert_eq "release" "$(value action)" "a tag that exists only in the checkout decides nothing: the remote is asked"

git -C r push -q origin v2.0.1
plan "$before"
assert_eq "0" "$rc" "a tag already on the remote exits 0"
assert_eq "exists" "$(value action)" "and plans nothing"
assert_eq "$(head_sha)" "$(value points)" "and prints where the tag points"
assert_eq "no" "$(has_notes)" "and writes no notes"
plan "$before"
assert_eq "exists" "$(value action)" "a second run gives the same answer"

# An annotated tag is an object of its own. What it points at is the commit.
fresh
before="$(head_sha)"
stamp 2.0.1
git -C r tag -a -m "annotated" v2.0.1
git -C r push -q origin v2.0.1
plan "$before"
assert_eq "exists" "$(value action)" "an annotated tag on the remote counts"
assert_eq "$(head_sha)" "$(value points)" "and points is the commit, not the tag object"

# The tag sits on another commit. It is still not this run's to move.
fresh
before="$(head_sha)"
git -C r tag v2.0.1
git -C r push -q origin v2.0.1
stamp 2.0.1
plan "$before"
assert_eq "0" "$rc" "a tag on another commit still exits 0"
assert_eq "exists" "$(value action)" "and plans nothing"
assert_eq "$before" "$(value points)" "and prints the commit it is on"

# --- Latest -----------------------------------------------------------------------------------------

fresh
git -C r tag v2.0.9
git -C r tag v1.99.99
git -C r tag nightly
git -C r tag v3.0.0-rc1
git -C r tag v-next
git -C r push -q origin v2.0.9 v1.99.99 nightly v3.0.0-rc1 v-next
before="$(head_sha)"
stamp 2.0.10
plan "$before"
assert_eq "release" "$(value action)" "lower tags on the remote do not stop a release"
assert_eq "true" "$(value latest)" "2.0.10 is above v2.0.9: versions compare as numbers, and a tag that is not v<x.y.z> is not a version"

git -C r tag v2.1.0
git -C r push -q origin v2.1.0
plan "$before"
assert_eq "release" "$(value action)" "a higher tag on the remote does not stop a release either"
assert_eq "false" "$(value latest)" "but this version does not take Latest from it"

# The remote cannot be read. That is not the same as a remote with no tags.
fresh
before="$(head_sha)"
stamp 2.0.1
git -C r remote set-url origin ../nowhere.git
plan "$before"
assert_eq "1" "$rc" "a remote that cannot be listed is refused, not read as having no tags"
assert_eq "" "$out" "with nothing on stdout"
plan "$before" --remote elsewhere
assert_eq "1" "$rc" "so is a remote that is not configured"

# --- the tree is not fit to release -----------------------------------------------------------------

# One site still says the old version.
fresh
before="$(head_sha)"
stamp 2.0.1
printf '{\n  "version": "2.0.0"\n}\n' > r/core/package.json
commit "one site left behind"
plan "$before"
assert_eq "1" "$rc" "a half-stamped version is refused"
assert_eq "" "$out" "with nothing on stdout"
assert_contains "$err" "core/package.json" "and the site is named"
assert_eq "no" "$(has_notes)" "and no notes"

# No changelog section at all.
fresh
before="$(head_sha)"
sites 2.0.1
commit "stamped with no changelog entry"
plan "$before"
assert_eq "1" "$rc" "a version with no changelog section is refused"
assert_eq "" "$out" "with nothing on stdout"
assert_contains "$err" "2.0.1" "and the version is named"
assert_eq "no" "$(has_notes)" "and no notes"

# A heading the version check accepts and the notes script does not: it has no date.
fresh
before="$(head_sha)"
sites 2.0.1
printf '# Changelog\n\n## [2.0.1]\n\nNotes.\n\n## [2.0.0] — 2026-01-01\n\nOld.\n\n[2.0.1]: https://example.com/releases/tag/v2.0.1\n' > r/CHANGELOG.md
commit "a heading with no date"
plan "$before"
assert_eq "1" "$rc" "a section the notes script cannot bound is refused"
assert_eq "" "$out" "with nothing on stdout"
assert_contains "$err" "no section for 2.0.1" "and the notes script's reason is passed on"
assert_eq "no" "$(has_notes)" "and no notes"

# An empty section.
fresh
before="$(head_sha)"
sites 2.0.1
printf '# Changelog\n\n## [2.0.1] — 2026-01-02\n\n## [2.0.0] — 2026-01-01\n\nOld.\n\n[2.0.1]: https://example.com/releases/tag/v2.0.1\n' > r/CHANGELOG.md
commit "an empty section"
plan "$before"
assert_eq "1" "$rc" "an empty changelog section is refused"
assert_contains "$err" "is empty" "and the notes script's reason is passed on"

# The order is the spec's: the tree is judged before the tag is looked for.
git -C r tag v2.0.1
git -C r push -q origin v2.0.1
plan "$before"
assert_eq "1" "$rc" "a tree that cannot be released fails even when its tag exists"

# --- versions with a changelog section and no tag ---------------------------------------------------

fresh
stamp 2.0.9
stamp 2.0.10
git -C r tag v2.0.0 HEAD~2
git -C r push -q origin v2.0.0
before="$(head_sha)"
stamp 2.0.11
plan "$before"
assert_eq "2.0.9 2.0.10" "$(value untagged)" "every other version with a section and no tag is listed, lowest first"
git -C r tag v2.0.11
git -C r push -q origin v2.0.11
plan "$before"
assert_eq "exists" "$(value action)" "with the tag present"
assert_eq "2.0.9 2.0.10" "$(value untagged)" "the list is printed all the same"

fresh
before="$(head_sha)"
stamp 2.0.1
git -C r tag v2.0.0 "$before"
git -C r push -q origin v2.0.0
plan "$before"
assert_eq "" "$(value untagged)" "and it is empty when every other version has its tag"
assert_eq "1" "$(printf '%s\n' "$out" | grep -c '^untagged=')" "as a line with no value, so the key is always there"

# --- --highest ----------------------------------------------------------------------------------------

out="$(printf 'v2.0.9\nv2.0.10\nv1.99.0\nnightly\nv3.0.0-rc1\n\n' | node "$TOOL" --highest 2>stderr.txt)"; rc=$?
assert_eq "0" "$rc" "--highest reads tag names on stdin"
assert_eq "v2.0.10" "$out" "and prints the highest version among them, compared as numbers"
out="$(printf 'v2.0.10\r\nv2.0.9\r\n' | node "$TOOL" --highest 2>stderr.txt)"; rc=$?
assert_eq "v2.0.10" "$out" "CRLF input gives the same name"
out="$(printf 'nightly\n' | node "$TOOL" --highest 2>stderr.txt)"; rc=$?
assert_eq "1" "$rc" "no version among them exits 1"
assert_eq "" "$out" "with nothing on stdout"

assert_eq "" "$CRASHED" "no refusal above was an uncaught exception"

# --- usage ------------------------------------------------------------------------------------------

out="$(node "$TOOL" --repo r 2>stderr.txt)"; rc=$?
assert_eq "2" "$rc" "no --before is a usage error, on its own exit code"
assert_eq "" "$out" "with nothing on stdout"
out="$(node "$TOOL" --repo r --before x --frobnicate 2>stderr.txt)"; rc=$?
assert_eq "2" "$rc" "so is a flag it does not know"
out="$(node "$TOOL" --repo nowhere --before x 2>stderr.txt)"; rc=$?
assert_eq "2" "$rc" "and a --repo that is not a git repository"

# --- this repository --------------------------------------------------------------------------------
#
# The workflow file is read here because it has no other test: nothing runs it before a real push.
# These are the lines whose loss would not show until a release went wrong.

out="$(cd "$REPO_ROOT" && node "$TOOL" --before "$(git -C "$REPO_ROOT" rev-parse HEAD)" 2>&1)"; rc=$?
assert_eq "0" "$rc" "this checkout, compared with itself, exits 0"
assert_contains "$out" "action=none" "and plans nothing"

# A Windows checkout may hold the file with CRLF endings; the patterns below are written for LF.
WF="$WORK/release.yml"
tr -d '\r' < "$REPO_ROOT/.github/workflows/release.yml" > "$WF"
wf="$(cat "$WF")"
assert_contains "$wf" "branches: [master]" "release.yml runs on a push to master"
assert_eq "0" "$(grep -c '^ *paths' "$WF")" "with no path filter: the job decides (D1)"
assert_eq "0" "$(grep -c '^ *concurrency' "$WF")" "and no concurrency group, which would drop a pending release"
assert_eq "permissions:|  contents: write||" "$(sed -n '/^permissions:/,/^$/p' "$WF" | tr '\n' '|')" "its only permission is contents: write"
assert_eq "0" "$(grep 'secrets\.' "$WF" | grep -vc 'secrets\.GITHUB_TOKEN')" "it names no secret but GITHUB_TOKEN"
assert_contains "$wf" "fetch-depth: 0" "it checks out full history, or the commit before the push is not there"
assert_contains "$wf" 'BEFORE: ${{ github.event.before }}' "the commit before the push arrives as an environment variable"
# Every expression sits alone as the value of an environment variable. One inside a `run:` block
# would be pasted into the script text before the shell reads it.
assert_eq "0" "$(grep -F '${{' "$WF" | grep -vcE '^ +[A-Z_]+: \$\{\{ [^}]+ \}\}$')" "and no expression is written into a script"
assert_contains "$wf" 'cortex-release-plan.mjs --before "$BEFORE" --sha "$GITHUB_SHA"' "the plan is asked about the pushed commit"
assert_contains "$wf" '--target "$GITHUB_SHA"' "the release targets the commit, not the branch"
assert_contains "$wf" "steps.plan.outputs.action == 'release'" "and is created only when the plan says release"
assert_contains "$wf" "--latest=false" "Latest is always stated, either way (D2)"
