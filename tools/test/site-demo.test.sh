# cortex-site-demo.mjs — what a /cortex run prints on three small repos, captured for the site.
#
# The site plays this output on its home page, so it is published. These tests pin what makes that
# safe: two runs give the same bytes, nothing in the file names this machine, each of the three repos
# shows the thing it is there to show, and --check tells a current file from a stale one.
#
# The tool builds its repos in the OS temp dir and reads this checkout's index/ CLIs. It writes
# nothing here, so the cases run it in place and send its output to $WORK.

. "$(dirname "${BASH_SOURCE[0]}")/_helpers.sh"   # $WORK or refuse — see the gate there

OUT="$WORK/demo"
mkdir -p "$OUT"

# Relative paths only: node on Windows resolves a bare /tmp/... against the current drive.
demo() { (cd "$OUT" || exit 1; node "$REPO_ROOT/tools/cortex-site-demo.mjs" "$@"); }
field() { (cd "$OUT" || exit 1; node -e 'const d=require("./first.json");const s=Object.fromEntries(d.scenarios.map(x=>[x.id,x]));console.log(eval(process.argv[1]))' "$1"); }
temp_count() { node -e 'const fs=require("fs"),os=require("os");console.log(fs.readdirSync(os.tmpdir()).filter(n=>n.startsWith("cortex-site-demo-")).length)'; }

# --- the capture -------------------------------------------------------------------------------------

before_tmp="$(temp_count)"
assert_exit 0 "captures the three repos" -- demo --out first.json
assert_eq "$before_tmp" "$(temp_count)" "and leaves no repo behind in the OS temp dir"
out="$(cat "$OUT/first.json")"

demo --out second.json >/dev/null
if cmp -s "$OUT/first.json" "$OUT/second.json"; then
  _pass "two runs are byte-identical"
else
  _fail "two runs are byte-identical" "first.json and second.json differ"
fi

assert_eq "new,legacy,team" "$(field 'd.scenarios.map(x=>x.id).join(",")')" "the scenarios are new, legacy and team, in that order"
assert_eq "$(tr -d '\r\n' < "$REPO_ROOT/VERSION")" "$(field 'd.version')" "version comes from VERSION"

# --- nothing of this machine is published --------------------------------------------------------------

assert_not_contains "$out" "$(node -e 'console.log(require("os").tmpdir().replace(/\\/g,"/"))')" "no temp dir path, forward slashes"
assert_not_contains "$out" '\\' "no backslash anywhere, so no Windows path"
assert_not_contains "$out" "$(node -e 'console.log(require("os").userInfo().username)')" "no user name"
assert_eq "0" "$(printf '%s' "$out" | grep -c -E '[0-9]+ms|[0-9a-f]{40}|20[0-9]{2}-[0-9]{2}-[0-9]{2}')" "no timing, commit id or date"

# --- each repo shows what it is there to show ------------------------------------------------------------

assert_eq "true" "$(field 's.new.loop.greenfield')" "the new repo is greenfield"
assert_eq "0" "$(field 's.new.repo.files.length')" "and has no files"
assert_eq "false" "$(field 's.legacy.loop.greenfield')" "the legacy repo is not"
assert_eq "0" "$(field 's.legacy.loop.served')" "and has none of the loop in place"
assert_eq "missing:AGENTS.md,CLAUDE.md,GEMINI.md" "$(field '(r=>r.status+":"+r.paths.join(","))(s.legacy.loop.rows.find(r=>r.id==="brief"))')" \
  "its root brief is missing, and the row names the files that would land"
assert_eq "high" "$(field 's.legacy.findings.items[0].severity')" "its findings are ranked, most severe first"
assert_contains "$(field 's.legacy.index[0]')" "Indexed 7 files" "the indexer's own first line is kept"
assert_eq "undefined" "$(field 'String(s.legacy.loop.rows.find(r=>r.id==="team-plugin"))')" "the legacy repo is not offered the shared plugin"
assert_eq "missing" "$(field 's.team.loop.rows.find(r=>r.id==="team-plugin").status')" "the team repo is"
assert_eq "true" "$(field 's.legacy.loop.rows.every(r=>["present","missing","blocked"].includes(r.status))')" "every row has a status"
assert_eq "true" "$(field '(o=>JSON.stringify(o)===JSON.stringify([...o].sort((a,b)=>a-b)))(s.team.loop.rows.map(r=>s.team.loop.stages.indexOf(r.stage)))')" \
  "rows are in stage order"

# --- --check -------------------------------------------------------------------------------------------

assert_exit 0 "--check passes on a file a run just wrote" -- demo --check first.json
(cd "$OUT" && sed 's/"A new repo"/"A brand new repo"/' first.json > stale.json)
assert_exit 1 "--check fails on a file that differs" -- demo --check stale.json
assert_exit 2 "--check on a missing file is an error, not a pass" -- demo --check nowhere.json
assert_exit 2 "an unknown argument is an error" -- demo --nope

# --- no network, and nothing imported from a leaf ---------------------------------------------------------

src="$(cat "$REPO_ROOT/tools/cortex-site-demo.mjs")"
for needle in "fetch(" "node:http" "node:https" "node:net" "node:dns" "node:tls"; do
  assert_not_contains "$src" "$needle" "the tool has no way to reach the network ($needle)"
done
assert_eq "0" "$(printf '%s\n' "$src" | grep -c -E '^import .*(\.\./index/|\.\./mcp/)')" "it spawns the index CLIs and imports nothing from a leaf"
