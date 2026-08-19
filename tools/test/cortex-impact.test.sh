# The blast radius is a floor, and the CLI has to say so out loud.
#
# index/test/impact.test.mjs covers the graph walk. This covers the thing a user actually runs, and
# the failure it prevents is not a crash: it is a confident total. Regex import resolution (ADR 0004
# — a plugin install clones the repo and runs no build, so there is no parser) means dynamic imports
# are invisible. A CLI that prints "3 files affected" when the truth is 5 invites someone to stop
# looking; "at least 3" does not. Every assertion below defends a sentence, not a number.

IMPACT="$REPO_ROOT/index/cortex-impact.mjs"

# --- a repo with an index, built the way a user would ---------------------------------------------

fixture() {
  rm -rf "$WORK/proj"
  mkdir -p "$WORK/proj/src" "$WORK/proj/test"
  cd "$WORK/proj"
  git init -q .
  git config user.email t@t; git config user.name t

  printf 'export const q = 1;\n'                                  > src/db.js
  printf 'import { q } from "./db.js";\nexport const user = q;\n' > src/user.js
  printf 'import { user } from "./user.js";\nexport const api = user;\n' > src/api.js
  printf 'import { q } from "./db.js";\nexport const jobs = q;\n' > src/jobs.js
  printf 'import { user } from "../src/user.js";\n'               > test/user.test.js
  printf '{ "name": "p", "version": "1.0.0" }\n'                  > package.json

  git add -A && git commit -qm init
  node "$REPO_ROOT/index/cortex-index.mjs" . >/dev/null 2>&1
  cd "$REPO_ROOT"
}

fixture
run() { node "$IMPACT" --root "$WORK/proj" "$@" 2>&1; }

# --- the floor, stated every way it can be stated -------------------------------------------------

out="$(run src/db.js)"
assert_contains "$out" "At least" "the count is phrased as a floor"
assert_not_contains "$out" "files affected in total" "and never as a total"
assert_contains "$out" "floor, not a total" "the footer repeats the hedge where a reader ends up"

# The transitive walk: api.js imports user.js imports db.js. A tool that only reported direct
# dependents would answer "2" here and miss the file that actually breaks in production.
assert_contains "$out" "src/user.js" "a direct dependent is found"
assert_contains "$out" "src/api.js" "and a transitive one"
assert_contains "$out" "d2" "with the hop count that says how far out it is"

# --- the dangerous wrong answer -------------------------------------------------------------------

# A path the index does not know contributes nothing to the walk. Dropping it silently would print
# an empty radius, which reads as "nothing depends on this" — the one output that gets someone hurt.
out="$(run src/nope.js)"
assert_contains "$out" "Not in the index" "an unknown path is reported, not swallowed"
assert_contains "$out" "src/nope.js" "and named"

# An empty radius is a real answer, but it is not proof. An entry point or a dynamically loaded
# module looks exactly like dead code here.
out="$(run src/api.js)"
assert_contains "$out" "Nothing in the index imports these" "an empty radius says so plainly"
assert_contains "$out" "not a proof" "and refuses to be read as proof it is unused"

# --- the actionable half --------------------------------------------------------------------------

# jobs.js is in db.js's radius and no test touches it; user.js is covered by test/user.test.js.
# Separating them is the whole point: a large covered radius is an ordinary change.
out="$(run src/db.js)"
assert_contains "$out" "exercised by no test" "unverified files get their own section"
assert_contains "$out" "src/jobs.js" "and the uncovered file is in it"
assert_contains "$out" "test/user.test.js" "the covering test is offered as worth running"

# --- flags ------------------------------------------------------------------------------------------

out="$(run src/db.js --depth 1)"
assert_contains "$out" "Stopped at depth 1" "a bounded walk says it was bounded"
assert_not_contains "$out" "src/api.js" "and really does stop"

out="$(run src/db.js --json)"
assert_contains "$out" '"atLeast"' "--json names the count so it cannot be mistaken for a total"
assert_not_contains "$out" '"total"' "and exposes no field that could be"

# --staged reads the working tree. Nothing is staged here, so the fallback is what runs — someone
# mid-edit asking "what does this touch" means their unstaged changes, and an empty answer would lie.
( cd "$WORK/proj" && printf 'export const q = 2;\n' > src/db.js )
out="$(run --staged)"
assert_contains "$out" "src/user.js" "--staged falls back to unstaged edits rather than answering nothing"

# --- refusing to guess --------------------------------------------------------------------------

# Without an index there is no graph. Inventing a radius from nothing is worse than exiting.
rm -rf "$WORK/proj/.cortex"
out="$(run src/db.js)"; rc=$?
assert_eq "2" "$rc" "a missing index is a refusal, not an empty radius"
assert_contains "$out" "cortex-index.mjs" "and names the command that builds one"
