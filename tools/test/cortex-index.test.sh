# The index is the fact every other Cortex command reads, so a wrong one is wrong everywhere.
#
# index/test/build.test.mjs and walk.test.mjs cover the graph and the walker.
# tools/test/install-on-a-project.test.sh covers the `--out` mode, which is read-only by
# construction. Neither covers what happens on the run a user actually does — no flags, writing into
# their repository — and that is where the two claims on this CLI's stdout live:
#
#   1. "Skipped by name: N files under bin/" — the number that stops an incomplete index from being
#      read as a complete one. It is a GUESS about a directory name, and only git can overrule it,
#      so it is only observable in a real git repo. The unit fixture is not one.
#   2. "Created .cortex/ … Added to .gitignore" — a directory appearing in someone's project on a
#      run they did not explicitly ask for has to be visible. `.cortex/memory/` is deliberately NOT
#      ignored, because it is committed; that asymmetry is the whole design of the memory store.

INDEX="$REPO_ROOT/index/cortex-index.mjs"

PROJ="$WORK/proj"
fixture() {
  rm -rf "$PROJ"
  mkdir -p "$PROJ/src" "$PROJ/bin"
  cd "$PROJ" || exit 1
  git init -q .; git config user.email t@t; git config user.name t

  printf 'export const q = 1;\n'                                  > src/db.js
  printf 'import { q } from "./db.js";\nexport const u = q;\n'    > src/user.js
  printf '{ "name": "p", "version": "1.0.0" }\n'                  > package.json
  printf '# p\n'                                                  > README.md
  cd "$WORK" || exit 1
}
run() { node "$INDEX" "$PROJ" "$@" 2>&1; }
IXFILE="$PROJ/.cortex/index/index.json"

# --- bin/ is a guess, and git is the only thing allowed to overrule it ----------------------------

# `bin/` means build output in one ecosystem and hand-written source in the next — bin/cli.js,
# bin/rails, an ops repo's shell tools. Skipping it outright made bin/n, the whole of tj/n,
# invisible with nothing in the report to say so.
fixture
printf '#!/bin/sh\necho deploy\n' > "$PROJ/bin/deploy.sh"          # tracked → source
git -C "$PROJ" add -A >/dev/null 2>&1
git -C "$PROJ" commit -qm init

out="$(run)"
assert_contains "$out" "Indexed" "the run reports what it found"
assert_contains "$(cat "$IXFILE")" "bin/deploy.sh" "a git-TRACKED file under bin/ is indexed as source"
assert_not_contains "$out" "Skipped by name" "and nothing was guessed away, so nothing is reported"

# The other half of the same rule, and the half the unit fixture can never reach: outside git
# everything under bin/ looks like output, so tracking is the only signal that separates them.
printf 'compiled\n' > "$PROJ/bin/app.out"                          # untracked → output
out="$(run)"
assert_contains "$out" "Skipped by name: 1 file under bin/" "an untracked file under bin/ is skipped AND counted"
assert_contains "$out" "git-tracked files there are indexed as source" "with the rule that decided it"
assert_not_contains "$(cat "$IXFILE")" "bin/app.out" "and it really is out of the index"
# Losing the tracked one to the same guess is the expensive failure: a plausible number, and
# nothing to mark the index incomplete.
assert_contains "$(cat "$IXFILE")" "bin/deploy.sh" "while the tracked file beside it stays in"

# --- what lands in someone's repository, and what is said about it --------------------------------

fixture
git -C "$PROJ" add -A >/dev/null 2>&1; git -C "$PROJ" commit -qm init
out="$(run)"

assert_contains "$out" "Created .cortex/" "a generated directory appearing is announced, never silent"
assert_contains "$out" "Added to .gitignore" "and so is the gitignore write"
[ -f "$IXFILE" ] && _pass "the index lands at .cortex/index/index.json" \
                 || _fail "the index lands at .cortex/index/index.json"

IGN="$(cat "$PROJ/.gitignore")"
assert_contains "$IGN" ".cortex/index/" "the generated index directory is ignored"
assert_contains "$IGN" ".cortex/findings/" "and the generated findings directory"
# The asymmetry IS the design: .cortex/memory/ is committed, because that is how several developers
# share one context. Matched as whole RULES, not as substrings — the header comment mentions
# `.cortex/memory/` by name to explain itself, and a substring test reads that sentence as a rule.
has_rule() { grep -v '^[[:space:]]*#' "$PROJ/.gitignore" | grep -qx -- "$1"; }
has_rule ".cortex/memory/" && _fail "memory/ is committed on purpose and must never be ignored" \
                          || _pass "memory/ is committed on purpose and must never be ignored"
has_rule ".cortex/" && _fail "the parent is never ignored wholesale, which would take memory/ with it" \
                    || _pass "the parent is never ignored wholesale, which would take memory/ with it"

# Announcing it twice would be a lie the second time — nothing was created and nothing was added.
out="$(run)"
assert_not_contains "$out" "Created .cortex/" "a second run created nothing, and says nothing"
assert_not_contains "$out" "Added to .gitignore" "and adds no duplicate entry"
assert_eq "$IGN" "$(cat "$PROJ/.gitignore")" "the .gitignore is byte-identical after the second run"

# A user who already ignored the parent themselves has settled the question. Adding narrower
# entries under it would imply memory/ is not ignored when their line ignores it — a disagreement
# only they can resolve.
fixture
printf '.cortex/\n' > "$PROJ/.gitignore"
git -C "$PROJ" add -A >/dev/null 2>&1; git -C "$PROJ" commit -qm init
run >/dev/null
assert_eq ".cortex/" "$(cat "$PROJ/.gitignore")" "a broader rule the user wrote is left exactly alone"

# --- deterministic, which is what makes it safe in CI ---------------------------------------------

# build.test.mjs asserts two calls to buildIndex agree. This asserts the CLI does: same tree, same
# bytes on disk, including everything the CLI adds around the build.
#
# The fixture ignores `.cortex/` itself, so this run leaves the tree completely alone — which is
# what makes it a clean test of the CLI rather than of what the CLI just wrote. A repo that does NOT
# already ignore `.cortex/` gets its `.gitignore` appended to DURING the run, after the walk has
# measured that file, so the first index reports a `.gitignore` that no longer exists by the time
# the command returns and the second run disagrees with it. That is a real defect in the ordering
# of the write, not in the builder, and it is reported rather than pinned here — asserting the
# converged behaviour would turn the bug into the specification.
fixture
printf '.cortex/\n' > "$PROJ/.gitignore"
git -C "$PROJ" add -A >/dev/null 2>&1; git -C "$PROJ" commit -qm init
run >/dev/null
first="$(cat "$IXFILE")"
run >/dev/null
assert_eq "$first" "$(cat "$IXFILE")" "two runs over an unchanged tree write identical bytes"

# --- the argument is the repo, not the directory the caller happens to be in -----------------------

fixture
git -C "$PROJ" add -A >/dev/null 2>&1; git -C "$PROJ" commit -qm init
mkdir -p "$WORK/elsewhere"
( cd "$WORK/elsewhere" && node "$INDEX" "$PROJ" >/dev/null 2>&1 )
[ -d "$WORK/elsewhere/.cortex" ] && _fail "a named repo is indexed in place, not into the cwd" \
                                 || _pass "a named repo is indexed in place, not into the cwd"
[ -f "$IXFILE" ] && _pass "and the named repo is the one that gets the index" \
                 || _fail "and the named repo is the one that gets the index"

# --- the sequence, which is the only thing here a user can act on ----------------------------------

# An index answers nothing anybody asked. Without this line the reader is left holding a menu of
# eleven commands sorted by nothing, which is the state /cortex-next exists to end.
assert_contains "$(run)" "Next →" "the run ends by naming the single next command"
