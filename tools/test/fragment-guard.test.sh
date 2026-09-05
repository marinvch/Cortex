# Every *.test.sh here refuses to run outside tools/test/run.sh.
#
# The fragments are sourced, not executed: run.sh exports $WORK and $REPO_ROOT and cds into a fresh
# temp dir first. Run one directly and both are empty, `cd "$WORK/proj"` becomes `cd ""` — which
# fails without stopping the script — and the `git init`, `> README.md` and `git add -A && git
# commit` after it run against whatever repository you were standing in. On 2026-09-05 that
# happened here: two fixture commits on master, README.md replaced by `# readme`, the git identity
# rewritten. Every leaf brief prints these paths in exactly the form that does it.
#
# So this is the one test that runs the fragments the wrong way on purpose. Two halves, because
# either alone fails open: the behavioural half proves the gate stops a real fixture in a real git
# repo, and the structural half proves a fragment written tomorrow cannot skip the gate — under
# run.sh a missing guard line is invisible, since the runner sources the helpers anyway.

. "$(dirname "${BASH_SOURCE[0]}")/_helpers.sh"   # $WORK or refuse — see the gate there

TESTS="$REPO_ROOT/tools/test"

# The whole tree, not one symptom. A runaway fixture writes README.md and package.json, sets a git
# identity and commits — checking for any single one of those passes for every other way of failing.
tree_state() { ( cd "$1" && find . -path ./.git -prune -o -type f -print0 | sort -z | xargs -0 -r ls -l | awk '{print $5, $NF}'
                 cd "$1" && git log --oneline | cat && git config --local --list | cat ) 2>/dev/null; }

# --- the gate stops a fragment run directly ----------------------------------

# A real repo with a commit and an identity: the runaway commit has to be possible for the refusal
# to mean anything.
SANDBOX="$WORK/sandbox"
mkrepo "$SANDBOX"
printf 'the real readme\n' > "$SANDBOX/README.md"
( cd "$SANDBOX" && git add -A >/dev/null 2>&1 && git commit -qm readme )

before="$(tree_state "$SANDBOX")"
worst=0
for f in "$TESTS"/*.test.sh; do
  ( cd "$SANDBOX" && env -u WORK -u REPO_ROOT bash "$f" >/dev/null 2>&1 )
  rc=$?
  [ "$rc" -eq 0 ] && worst=1
done
assert_eq 0 "$worst" "every fragment run directly exits non-zero"
assert_eq "$before" "$(tree_state "$SANDBOX")" "and none of them touched the directory it ran in"

# $WORK pointing at a directory that does not exist is the same failure with a longer fuse: the cd
# still fails, the script still continues.
out="$( cd "$SANDBOX" && WORK="$WORK/gone" REPO_ROOT="$REPO_ROOT" bash "$TESTS/cortex-view.test.sh" 2>&1 )"; rc=$?
assert_eq 1 "$rc" "a \$WORK that does not exist is refused too"
assert_contains "$out" "tools/test/run.sh" "and the refusal names the command to run instead"

# --- the gate is unskippable -------------------------------------------------

missing=""
for f in "$TESTS"/*.test.sh; do
  first="$(grep -m1 -v '^[[:space:]]*\(#.*\)\?$' "$f")"
  case "$first" in
    *'_helpers.sh'*) ;;
    *) missing="$missing $(basename "$f")" ;;
  esac
done
assert_eq "" "$missing" "every fragment sources _helpers.sh as its first line of code"

# The runner has to export $WORK before it sources the helpers, or the gate fires on every file and
# the suite reports 26 crashes instead of running.
work_line="$(awk '/^ *export WORK/{print NR; exit}' "$TESTS/run.sh")"
src_line="$(awk '/_helpers\.sh"$/{print NR; exit}' "$TESTS/run.sh")"
assert_eq 1 "$([ -n "$work_line" ] && [ -n "$src_line" ] && [ "$work_line" -lt "$src_line" ] && echo 1 || echo 0)" \
          "run.sh exports WORK before it sources _helpers.sh"

# A bare `cd "$X"` that continues on failure is the shape underneath all of this. The gate makes an
# empty $WORK impossible; this keeps the second line of defence from being deleted by accident.
bare="$(grep -n '^[[:space:]]*cd "' "$TESTS"/*.test.sh | grep -v '||' | grep -v '&&' || true)"
assert_eq "" "$bare" "no fragment cds without exiting on failure"
