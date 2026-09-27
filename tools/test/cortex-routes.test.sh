# The route map prints sentences a user acts on — "this call reaches that controller", "nothing
# reaches this endpoint" — so the command itself earns a test against real git repositories.
#
# index/test/routes.test.mjs covers extraction and resolution from literals. This covers what only a
# run shows: the workspace is discovered the way the acceptance run discovers it (git repos directly
# under a directory, the team-brain left out), a missing index is built in memory and SAID to be,
# nothing is written into any repo, and every "unused" is phrased as a floor. The failure it prevents
# is a confident one: "safe to delete" about an endpoint another service calls.

. "$(dirname "${BASH_SOURCE[0]}")/_helpers.sh"   # $WORK or refuse — see the gate there

ROUTES="$REPO_ROOT/index/cortex-routes.mjs"
WS="$WORK/ws"

commit_all() { git add -A && git commit -qm init; }

# --- a workspace: a front end with a gateway, a Spring service, and a team-brain -------------------

mkdir -p "$WS/depot-web/src" "$WS/depot-web/gateway" "$WS/depot-orders/src/main/java/com/depot/orders" "$WS/depot-orders/src/main/resources" "$WS/team-brain/projects"
cd "$WS/depot-web" || exit 1
git init -q . && git config user.email t@t && git config user.name t
printf 'export const client = { baseUrl: "/api" };\nexport const one = (id) => request(`/orders/${id}`);\nexport const all = () => request("/orders");\n' > src/client.ts
printf 'export const ROUTES = [\n  { prefix: "/api/orders", service: "orders", rewrite: "/orders" },\n];\n' > gateway/routes.js
commit_all

cd "$WS/depot-orders" || exit 1
git init -q . && git config user.email t@t && git config user.name t
printf 'spring:\n  application:\n    name: depot-orders\n' > src/main/resources/application.yml
# CRLF on purpose: a Windows working copy must cite the same lines as a POSIX one.
printf '@RestController\r\n@RequestMapping("/orders")\r\npublic class OrderController {\r\n  @GetMapping("/{id}")\r\n  public Order get(@PathVariable String id) { return null; }\r\n  @GetMapping("/{id}/audit")\r\n  public Audit audit(@PathVariable String id) { return null; }\r\n}\r\n' > src/main/java/com/depot/orders/OrderController.java
commit_all

cd "$WS/team-brain" || exit 1
git init -q . && git config user.email t@t && git config user.name t
printf '# Team: depot\n' > team.md && printf '' > projects/.gitkeep
commit_all
cd "$WORK" || exit 1

tree_state() { ( cd "$1" && find . -path '*/.git' -prune -o -type f -print0 2>/dev/null | sort -z | xargs -0 -r ls -l 2>/dev/null | awk '{print $5, $NF}' ); }
BEFORE="$(tree_state "$WS")"

# --- who serves this call ---------------------------------------------------------------------------

out="$(node "$ROUTES" "$WS" --workspace 2>&1)"; rc=$?
assert_eq "0" "$rc" "cortex-routes runs over a workspace"
assert_contains "$out" "2 repos: depot-orders (built in memory), depot-web (built in memory)" "the team-brain is not a code repo, and a missing index is said to be built in memory"
assert_contains "$out" "via /api/orders (depot-web/gateway/routes.js:2) depot-orders/src/main/java/com/depot/orders/OrderController.java:4" \
  "a call resolves through the gateway to the controller line that serves it — the CRLF file cites the right line"
assert_contains "$out" "No handler Cortex can see serves GET /orders" "a call nothing serves is named"
assert_contains "$out" "GET /orders/{}/audit is reached by no call Cortex can see" "so is an endpoint nothing calls"
assert_contains "$out" "never \"safe to delete\"" "and it is phrased as a floor"
assert_contains "$out" "A floor, not a total" "and so is the whole map"
assert_eq "$BEFORE" "$(tree_state "$WS")" "and nothing in any repo was written — not even .cortex/"

# A stored index is used when it carries routes, and the "built in memory" note goes away for it.
( cd "$WS/depot-orders" && node "$REPO_ROOT/index/cortex-index.mjs" . --out "$WORK/orders-index.json" >/dev/null 2>&1 )
out="$(node "$ROUTES" "$WS/depot-orders" --index "$WORK/orders-index.json" 2>&1)"
assert_contains "$out" "1 repo: depot-orders" "a single repo is a workspace of one, read from the index it was pointed at"
assert_not_contains "$out" "built in memory" "a stored index with routes is used as it is"
assert_contains "$out" "No front-end call was found, so no endpoint is reported as unused" \
  "a back-end-only repo does not report every endpoint unused"

# --- the machine-readable form ---------------------------------------------------------------------

json="$(node "$ROUTES" "$WS" --workspace --json 2>&1)"
parsed="$(printf '%s' "$json" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);console.log(j.stats.linked+"/"+j.stats.calls+" "+j.sources["depot-web"])}catch(e){console.log("UNPARSEABLE")}})')"
assert_eq "1/2 memory" "$parsed" "--json is JSON with the same numbers and says where each repo's routes came from"

# --- a repo with none of it -------------------------------------------------------------------------

mkdir -p "$WORK/plain" && cd "$WORK/plain" || exit 1
git init -q . && git config user.email t@t && git config user.name t
printf 'export const x = 1;\n' > a.js && commit_all
cd "$WORK" || exit 1
out="$(node "$ROUTES" "$WORK/plain" 2>&1)"; rc=$?
assert_eq "0" "$rc" "a repo with no routes is an answer, not an error"
assert_contains "$out" "No routes in reach" "and it says so"

# --- it refuses rather than guesses ----------------------------------------------------------------

assert_exit 1 "a workspace that is not a directory is refused by the front door" -- node "$ROUTES" "$WORK/nope" --workspace
assert_exit 1 "an unknown flag is refused" -- node "$ROUTES" "$WS" --worksapce
assert_exit 1 "--index with --workspace is refused: each member reads its own" -- node "$ROUTES" "$WS" --workspace --index "$WORK/orders-index.json"
mkdir -p "$WORK/empty-ws"
assert_exit 2 "a directory holding no repositories is not an empty workspace" -- node "$ROUTES" "$WORK/empty-ws" --workspace
