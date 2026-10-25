# The graph report prints what a reader acts on: which files to read first, which imports cross a
# boundary, which loop to break. index/test/graph-report.test.mjs covers the scoring. This covers
# the command: that it refuses without an index rather than answering from nothing, that it writes
# nothing at all, and that the same repo gives the same bytes.

. "$(dirname "${BASH_SOURCE[0]}")/_helpers.sh"   # $WORK or refuse — see the gate there

GRAPH="$REPO_ROOT/index/cortex-graph.mjs"

rm -rf "$WORK/proj"
mkrepo "$WORK/proj"
cd "$WORK/proj" || exit 1
mkdir -p src/store src/ui test

printf 'export const state = {};\n'                                              > src/store/core.js
printf 'import { state } from "./core.js";\nexport const get = () => state;\n'   > src/store/get.js
printf 'import { state } from "./core.js";\nexport const set = () => state;\n'   > src/store/set.js
printf 'import { get } from "./get.js";\nimport { set } from "./set.js";\nexport { get, set };\n' > src/store/index.js
printf 'import { get } from "../store/index.js";\nimport { b } from "./b.js";\nexport const a = () => get() && b;\n' > src/ui/a.js
printf 'import { a } from "./a.js";\nexport const b = 1;\nexport const c = a;\n'  > src/ui/b.js
printf 'import { get } from "../src/store/get.js";\n'                            > test/get.test.js

out="$(node "$GRAPH" "$WORK/proj" 2>&1)"; rc=$?
assert_eq "2" "$rc" "without an index it refuses"
assert_contains "$out" "cortex-index.mjs" "and names the command that builds one"

git add -A && git commit -qm code
node "$REPO_ROOT/index/cortex-index.mjs" . >/dev/null 2>&1
before="$(git status --porcelain=v1 --ignored | sort)"

out="$(node "$GRAPH" "$WORK/proj" 2>&1)"; rc=$?
assert_eq "0" "$rc" "with an index it answers"
assert_contains "$out" "Hubs" "it lists hubs"
assert_contains "$out" "src/store/index.js  3 links" "and the most linked file is one"
assert_contains "$out" "Bridges" "it lists bridges"
assert_contains "$out" "src/ui/a.js -> src/ui/b.js -> src/ui/a.js" "and names the loop to break"
assert_contains "$out" "floor" "and says every count is a floor"
assert_not_contains "$out" "test/get.test.js" "a test is never a hub or a bridge"

after="$(git status --porcelain=v1 --ignored | sort)"
assert_eq "$before" "$after" "it writes nothing, not even under .cortex/"

node "$GRAPH" "$WORK/proj" --json > "$WORK/one.json" 2>&1
node "$GRAPH" "$WORK/proj" --json > "$WORK/two.json" 2>&1
assert_exit 0 "--json is JSON" -- node -e 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))' "$WORK/one.json"
assert_exit 0 "and the same index gives the same bytes" -- cmp -s "$WORK/one.json" "$WORK/two.json"

assert_exit 1 "an unknown flag is refused, never read as a path" -- node "$GRAPH" "$WORK/proj" --jsn
out="$(node "$GRAPH" --help 2>&1)"
assert_contains "$out" "usage: node index/cortex-graph.mjs" "--help prints the usage"

cd "$REPO_ROOT" || exit 1
