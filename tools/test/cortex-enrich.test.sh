# Enrichment is the one place in Cortex where a model wrote the input.
#
# index/test/enrich.test.mjs covers validateBatch, mergeEnrichment and classifyBatches as functions.
# This covers the loop a user and an agent actually run — plan, status, merge — and the failure it
# defends is the one named in index/AGENTS.md: **never let an unreported drop happen**, because a
# silently incomplete enrichment looks exactly like a complete one.
#
# Two real incidents sit behind these assertions. Treating a renumbered batch as a hallucination
# discarded 210 correct summaries in one run; counting result *filenames* left `status` reporting 39
# of 39 complete while 33 of them answered batches that no longer existed. Both cost a paid model
# pass and neither raised an error, so every assertion below is about what the CLI *says*, not
# whether it exits zero.

ENRICH="$REPO_ROOT/index/cortex-enrich.mjs"
INDEX="$REPO_ROOT/index/cortex-index.mjs"

# --- a real git repo, because the indexer asks git what belongs to it (ADR 0003) -----------------

PROJ="$WORK/proj"
fixture() {
  rm -rf "$PROJ"
  mkdir -p "$PROJ/src" "$PROJ/lib"
  cd "$PROJ" || exit 1
  git init -q .; git config user.email t@t; git config user.name t

  # isEnrichable skips anything under three lines, so these are written long enough to be planned.
  printf 'export const q = 1;\n// the store\n// row one\n// row two\n'          > src/db.js
  printf 'import { q } from "./db.js";\nexport const u = q;\n// a\n// b\n'      > src/user.js
  printf 'export const h = 2;\n// helper\n// c\n// d\n'                          > lib/help.js
  printf '{ "name": "p", "version": "1.0.0" }\n'                                 > package.json
  git add -A && git commit -qm init

  node "$INDEX" . >/dev/null 2>&1
  cd "$WORK" || exit 1
}
run() { node "$ENRICH" "$@" "$PROJ" 2>&1; }
BATCHES="$PROJ/.cortex/index/enrich"

fixture

# --- plan ----------------------------------------------------------------------------------------

out="$(run plan)"
assert_contains "$out" "Planned 2 batches" "one batch per layer, deterministically"
assert_contains "$out" "covering 3 files" "and the plan says how much work it is"
assert_contains "$out" "batch-<n>.json" "and where each answer goes, so the agent needs no other doc"

# The plan is the identity of the work. Re-running it on an unchanged tree must not renumber
# anything, or an interrupted run cannot resume — which is the entire reason batching is
# deterministic rather than cheapest-first.
before="$(cat "$PROJ/.cortex/index/batches.json")"
run plan >/dev/null
assert_eq "$before" "$(cat "$PROJ/.cortex/index/batches.json")" "a re-plan on the same tree is byte-identical"

# --- status: what an agent reads to decide what work is left --------------------------------------

out="$(run status)"
assert_contains "$out" "0/2 batches complete" "nothing answered yet"
assert_contains "$out" "pending:" "and the remaining work is listed"

# Nothing on disk is work to DO. Calling it stale would tell an agent to redo what it never did.
assert_not_contains "$out" "redo or delete" "an unanswered batch is pending, never stale"

# The shape the skill documents: a bare array of entries.
printf '[{"path":"lib/help.js","summary":"A helper constant.","role":"utility"}]\n' > "$BATCHES/batch-1.json"
# The shape a model reaches for anyway — it echoes the batch number back. `merge` has always
# accepted this. `status` did not, and printed "answers a different plan — redo or delete" over a
# complete, correct batch that merge, run on the identical file, enriched without one issue. An
# agent obeying status deletes correct output and pays for the pass twice.
cat > "$BATCHES/batch-2.json" <<'JSON'
{"batchIndex":2,"files":[
  {"path":"src/db.js","summary":"The store constant.","role":"core-logic"},
  {"path":"src/user.js","summary":"Reads the store constant.","role":"core-logic"}
]}
JSON
out="$(run status)"
assert_contains "$out" "2/2 batches complete" "status accepts every shape merge accepts"
assert_not_contains "$out" "redo or delete" "so correct work is never condemned"

# Leniency about the wrapper is not leniency about the answer. A wrapped result answering a foreign
# path is exactly the drift classifyBatches exists to catch.
printf '{"batchIndex":1,"files":[{"path":"old/gone.js","summary":"s"}]}\n' > "$BATCHES/batch-1.json"
out="$(run status)"
assert_contains "$out" "redo or delete" "a wrapped answer to the wrong batch is still stale"
assert_contains "$out" "1 path this batch does not contain" "and says exactly what is wrong with it"

# --- merge: every drop reported, and only what is wrong dropped -----------------------------------

fixture
run plan >/dev/null
printf '[{"path":"lib/help.js","summary":"A helper constant.","role":"utility"}]\n' > "$BATCHES/batch-1.json"
cat > "$BATCHES/batch-2.json" <<'JSON'
[
  {"path":"src/db.js","summary":"The store constant.","role":"core-logic"},
  {"path":"src/ghost.js","summary":"A confident summary of a file that does not exist.","role":"utility"},
  {"path":"lib/help.js","summary":"Right file, wrong batch number.","role":"utility"},
  {"path":"src/user.js","summary":"Reads the store constant.","role":"invented-role"}
]
JSON
out="$(run merge)"

# The hallucination: a summary for a path the index does not contain may never reach the index.
assert_contains "$out" "src/ghost.js" "a hallucinated path is named"
assert_contains "$out" "is not in the index — dropped" "and dropped"

# The renumber: batch identity is POSITIONAL, so adding a layer moves every batch after it. A real
# path arriving against a moved number is correct work. Discarding it cost 210 summaries once.
assert_contains "$out" "belongs to another batch now — kept" "a real path filed against a moved batch is kept"

# A wrong role is a repairable defect, not a reason to throw the summary away.
assert_contains "$out" "unknown role 'invented-role' — cleared" "an unknown role is cleared, and said so"

# Coverage is counted across every batch at once, never per batch — once files can move, a per-batch
# gap means nothing. Three files were planned and all three arrived, from two different batches.
assert_contains "$out" "Enriched 3/" "every planned file is enriched, whichever batch carried it"
assert_not_contains "$out" "was not covered by any batch" "so nothing is falsely reported as missing"

# --- the silence that costs the most --------------------------------------------------------------

# A batch nobody answered, and a file a batch answered around. Both are how an incomplete enrichment
# comes to look complete, and each is reported at its own level: an absent batch by number, a
# skipped file by name. Reporting the second for the first would say the same gap twice.
fixture
run plan >/dev/null
printf '[{"path":"lib/help.js","summary":"A helper constant.","role":"utility"}]\n' > "$BATCHES/batch-1.json"
out="$(run merge)"
assert_contains "$out" "1 batches had no result: 2" "a batch with no answer is named by number"
assert_contains "$out" "Enriched 1/" "and the coverage count is the honest one, not the planned one"

# A batch that DID answer, and left one of its own files out. This is the gap a count alone hides —
# 2 of 3 reads like progress, and the file that was skipped is the thing a reader needs named.
fixture
run plan >/dev/null
printf '[{"path":"lib/help.js","summary":"A helper constant.","role":"utility"}]\n' > "$BATCHES/batch-1.json"
printf '[{"path":"src/db.js","summary":"The store constant.","role":"core-logic"}]\n' > "$BATCHES/batch-2.json"
out="$(run merge)"
assert_contains "$out" "'src/user.js' was not covered by any batch" "a file its own batch skipped is named"

# --- scope: a deliberately partial run must not read as an interrupted one -------------------------

fixture
out="$(run plan --include src)"
assert_contains "$out" "Planned 1 batches" "--include narrows the plan"
assert_contains "$out" "Included: src" "and says so"
out="$(run status)"
assert_contains "$out" "planned only for: src" "status reads the scope back off the plan"

fixture
out="$(run plan --exclude lib)"
assert_contains "$out" "Excluded: lib" "--exclude is recorded too"
assert_contains "$out" "Planned 1 batches" "and really applies"

# The root is the first BARE argument, wherever it sits. Reading it positionally as argv[3] meant a
# flag written first ate it: `plan --include src <repo>` fell back to process.cwd(), wrote .cortex/
# into whatever directory the caller was standing in, and left the named repo untouched — a stray
# generated directory in an unrelated project, which is the one thing index/ may never do.
fixture
mkdir -p "$WORK/elsewhere"
( cd "$WORK/elsewhere" && node "$ENRICH" plan --include src "$PROJ" >/dev/null 2>&1 )
[ -d "$WORK/elsewhere/.cortex" ] && _fail "a flag before the root does not redirect the write to the cwd" \
                                 || _pass "a flag before the root does not redirect the write to the cwd"
[ -f "$PROJ/.cortex/index/batches.json" ] && _pass "the named repo is the one that gets planned" \
                                          || _fail "the named repo is the one that gets planned"
# And the flag's VALUE is not mistaken for the root either — `--include src` must not plan ./src.
assert_contains "$(run status)" "planned only for: src" "the scope survives, so the value was consumed as a value"

# The inline form carries its value in the same token, so the NEXT argument is the root and must
# not be stepped over. Getting this wrong swaps the two failure modes rather than fixing either.
fixture
out="$(node "$ENRICH" plan --include=src "$PROJ" 2>&1)"
assert_contains "$out" "Included: src" "--include=src is read as a scope"
assert_contains "$out" "Planned 1 batches" "and the root after it is still the root"

# --- a single dash is a flag, and an unknown flag is refused rather than reinterpreted -------------

# `--`-only was the sibling convention and it left a hole: `-v` was taken as a repo ROOT, so the run
# created a directory literally named `-v` and exited 0. The realistic trigger is a typo of the very
# flag this command exists to support — `-include src <repo>` wrote .cortex/ into <cwd>/-include,
# left the named repo untouched, AND got an empty scope, because listFlag("--include") matches
# nothing. Nothing errored, because buildIndex on a directory that does not exist returns zero files.
fixture
mkdir -p "$WORK/elsewhere"
out="$( cd "$WORK/elsewhere" && node "$ENRICH" plan -v 2>&1 )"; rc=$?
assert_eq "1" "$rc" "a single-dash argument is refused, not read as a path"
assert_contains "$out" "unknown flag: -v" "and named"
[ -d "$WORK/elsewhere/-v" ] && _fail "no directory is created from a mangled flag" \
                            || _pass "no directory is created from a mangled flag"

out="$( cd "$WORK/elsewhere" && node "$ENRICH" plan -include src "$PROJ" 2>&1 )"; rc=$?
assert_eq "1" "$rc" "a one-dash typo of --include fails loudly"
assert_contains "$out" "unknown flag: -include" "rather than silently planning nothing, somewhere else"
[ -d "$WORK/elsewhere/-include" ] && _fail "and writes nothing" || _pass "and writes nothing"

# The allowlist is also what stops a flag added later from having its value promoted to the root.
# An unregistered `--out foo` would otherwise plan ./foo; here it is refused until registered.
out="$(node "$ENRICH" plan --out somewhere "$PROJ" 2>&1)"; rc=$?
assert_eq "1" "$rc" "an unregistered flag is refused, so its value cannot become the root"

# --- the property, not the one symptom ---------------------------------------------------------------

# Every shape of the bug above ends the same way: a root that is not a directory, buildIndex
# returning zero files rather than throwing, and "Planned 0 batches" printed with exit 0. Assert
# against that, and the routes nobody has enumerated are covered too.
out="$(node "$ENRICH" plan "$WORK/no-such-repo" 2>&1)"; rc=$?
assert_eq "1" "$rc" "a root that does not exist is a refusal"
assert_contains "$out" "not a directory" "which says what is wrong"
assert_contains "$out" "Nothing was written" "and that nothing happened"
assert_not_contains "$out" "Planned 0 batches" "never a confident empty plan"

printf 'x\n' > "$WORK/afile"
out="$(node "$ENRICH" plan "$WORK/afile" 2>&1)"; rc=$?
assert_eq "1" "$rc" "a file passed as a root is refused too"

# --- ADR 0016: the guarantee attaches to the act ------------------------------------------------------

# `/cortex-enrich plan` is named in ADR 0016 among the entry points that create `.cortex/`, and it
# was the only one of the four that never ignored or announced what it wrote — so it left a
# directory of generated artifacts in someone's `git status` with nothing to say where it came from.
fixture
rm -rf "$PROJ/.cortex" "$PROJ/.gitignore"
out="$(run plan)"
assert_contains "$out" "Created .cortex/" "creating the directory is announced"
assert_contains "$out" "Added to .gitignore" "and the ignore write is reported, not silent"
assert_contains "$(cat "$PROJ/.gitignore")" ".cortex/index/" "the generated index directory really is ignored"
# The asymmetry that makes the memory store work: it is committed, so it must never be ignored.
grep -v '^[[:space:]]*#' "$PROJ/.gitignore" | grep -qx ".cortex/memory/" \
  && _fail "memory/ is committed on purpose and must never be ignored" \
  || _pass "memory/ is committed on purpose and must never be ignored"

# Announcing it twice would be a lie the second time.
out="$(run plan)"
assert_not_contains "$out" "Created .cortex/" "a second plan created nothing and says nothing"
assert_not_contains "$out" "Added to .gitignore" "and adds no duplicate entry"

# merge writes enriched.json, so it carries the same guarantee — the promise is on the act, not on
# whichever subcommand happened to get there first.
fixture
rm -rf "$PROJ/.cortex" "$PROJ/.gitignore"
run plan >/dev/null
rm -f "$PROJ/.gitignore"
out="$(run merge)"
assert_contains "$out" "Added to .gitignore" "merge re-establishes the ignore entry it depends on"

# --- refusing to guess ------------------------------------------------------------------------------

fixture
out="$(run status)"; rc=$?
assert_eq "1" "$rc" "status without a plan exits non-zero rather than reporting nothing to do"
assert_contains "$out" "plan" "and names the command that makes one"

out="$(node "$ENRICH" frobnicate "$PROJ" 2>&1)"; rc=$?
assert_eq "1" "$rc" "an unknown subcommand fails loudly"
assert_contains "$out" "usage:" "with the usage line"

# --- nothing here may touch the repository outside .cortex/ -----------------------------------------

# The product's central claim. Enrichment writes batches.json, batch results and enriched.json, and
# every one of them lives under .cortex/. A whole-tree fingerprint cannot be fooled by a write the
# author of this test did not think to name.
fixture
tree_state() { ( cd "$1" && find . -path ./.git -prune -o -path ./.cortex -prune -o -type f -print0 2>/dev/null | sort -z | xargs -0 -r ls -l 2>/dev/null | awk '{print $5, $NF}' ); }
before="$(tree_state "$PROJ")"
run plan >/dev/null
printf '[{"path":"lib/help.js","summary":"A helper constant.","role":"utility"}]\n' > "$BATCHES/batch-1.json"
run merge >/dev/null
assert_eq "$before" "$(tree_state "$PROJ")" "enrichment changes no file outside .cortex/"
