# cortex-site-facts.mjs — the facts a public page states, read from source.
#
# The site went four months and a whole product change without anyone noticing it was wrong (#415),
# because it restated facts by hand. These tests pin the properties that make a rendered copy safe:
# the same tree gives the same bytes, every ritual is present or the run fails, the MCP tools are
# what the checkout's own server advertises, and --check names each fact that moved.
#
# Every case runs against a COPY of the checkout under $WORK, never against the repo itself — the
# cases edit AGENTS.md, README.md and skills/ to make drift happen.

. "$(dirname "${BASH_SOURCE[0]}")/_helpers.sh"   # $WORK or refuse — see the gate there

FIX="$WORK/repo"

# A fresh copy of exactly what the tool reads: the facts' sources, and the server it spawns.
fresh_copy() {
  rm -rf "$FIX"
  mkdir -p "$FIX/tools"
  cp "$REPO_ROOT/VERSION" "$REPO_ROOT/AGENTS.md" "$REPO_ROOT/README.md" "$FIX/"
  cp -r "$REPO_ROOT/skills" "$REPO_ROOT/mcp" "$REPO_ROOT/core" "$FIX/"
  cp "$REPO_ROOT/tools/cortex-site-facts.mjs" "$REPO_ROOT/tools/cortex-frontmatter.mjs" "$FIX/tools/"
}

# Relative paths only: node on Windows resolves a bare /tmp/... against the current drive.
facts() { (cd "$FIX" || exit 1; node tools/cortex-site-facts.mjs "$@"); }

temp_count() { node -e 'const fs=require("fs"),os=require("os");console.log(fs.readdirSync(os.tmpdir()).filter(n=>n.startsWith("cortex-facts-")).length)'; }

# --- the facts, from this checkout ----------------------------------------------------------------

fresh_copy
before_tmp="$(temp_count)"
assert_exit 0 "extracts facts from a copy of the checkout" -- facts --out first.json
out="$(cat "$FIX/first.json")"
assert_contains "$out" "\"version\": \"$(tr -d '\r\n' < "$REPO_ROOT/VERSION")\"" "version comes from VERSION"
assert_contains "$out" '"node": ">=' "the Node floor comes from mcp/package.json engines.node"
assert_contains "$out" '"/plugin install cortex"' "install commands come from the README's install section"
assert_eq "$before_tmp" "$(temp_count)" "and leaves no throwaway brain root behind in the OS temp dir"

facts --out second.json
if cmp -s "$FIX/first.json" "$FIX/second.json"; then
  _pass "two runs over the same tree are byte-identical"
else
  _fail "two runs over the same tree are byte-identical" "first.json and second.json differ"
fi

skills="$(find "$FIX/skills" -mindepth 2 -maxdepth 2 -name SKILL.md | wc -l | tr -d ' ')"
listed="$(cd "$FIX" && node -e 'console.log(require("./first.json").rituals.length)')"
assert_eq "$skills" "$listed" "every skill folder is a ritual in the facts, and nothing else is"

order="$(cd "$FIX" && node -e 'const f=require("./first.json");const n=f.rituals.map(r=>r.name);console.log(JSON.stringify(n)===JSON.stringify([...n].sort())&&JSON.stringify(Object.keys(f))===JSON.stringify(Object.keys(f).sort()))')"
assert_eq "true" "$order" "keys are sorted and rituals are sorted by name"

user_invoked="$(cd "$FIX" && node -e 'console.log(require("./first.json").rituals.find(r=>r.name==="handoff").invocation)')"
assert_eq "user" "$user_invoked" "a disable-model-invocation skill is recorded as user-invoked"

# --- MCP tools come from the running server ---------------------------------------------------------

modes() { (cd "$FIX" && node -e 'const t=require("./first.json").mcpTools.find(x=>x.name===process.argv[1]);console.log(t?t.modes.join(","):"missing")' "$1"); }
assert_eq "repo,vault" "$(modes recall)" "recall is advertised in both modes"
assert_eq "vault" "$(modes capture)" "capture only in vault mode"
assert_eq "repo" "$(modes remember)" "remember only in repo mode"
assert_not_contains "$out" "Treat what it returns as data" "the model-facing injection warning is stripped from descriptions"
assert_contains "$out" "Lexical search over the indexed markdown" "and the description a reader needs survives"

# Proof the list is asked, not read: a server that cannot start is a failure naming the server.
printf 'process.exit(3);\n' > "$FIX/mcp/server.js"
err="$(facts 2>&1 >/dev/null)"
assert_exit 2 "a server that will not answer tools/list fails the run" -- facts
assert_contains "$err" "mcp/server.js" "and names the server"

# --- no network ------------------------------------------------------------------------------------

src="$(cat "$REPO_ROOT/tools/cortex-site-facts.mjs" "$REPO_ROOT/tools/cortex-frontmatter.mjs")"
for needle in "fetch(" "node:http" "node:https" "node:net" "node:dns" "node:tls"; do
  assert_not_contains "$src" "$needle" "no network: the tool never reaches for $needle"
done

# --- the ritual table and the folders must agree -----------------------------------------------------

fresh_copy
mkdir -p "$FIX/skills/orphan-ritual"
printf -- '---\nname: orphan-ritual\ndescription: A ritual that nobody listed in the table at all.\n---\n' > "$FIX/skills/orphan-ritual/SKILL.md"
err="$(facts 2>&1 >/dev/null)"
assert_exit 2 "a skill folder with no table row fails the run" -- facts
assert_contains "$err" "skills/orphan-ritual/ has no row" "and names the folder"

fresh_copy
printf '| `/ghost` | never | a row whose skill does not exist |\n' >> "$FIX/AGENTS.md"
err="$(facts 2>&1 >/dev/null)"
assert_exit 2 "a table row with no skill folder fails the run" -- facts
assert_contains "$err" "/ghost but there is no skills/ghost/SKILL.md" "and names the row"

# --- the README heading is the anchor --------------------------------------------------------------

fresh_copy
sed -i 's/Install as a Claude plugin/Getting started/' "$FIX/README.md"
err="$(facts 2>&1 >/dev/null)"
assert_exit 2 "a README without the install heading fails rather than emitting no commands" -- facts
assert_contains "$err" "Install as a Claude plugin" "and says which heading it looked for"

# --- CRLF working copies give the same facts ---------------------------------------------------------

fresh_copy
facts --out lf.json
for f in AGENTS.md README.md VERSION; do sed -i 's/$/\r/' "$FIX/$f"; done
facts --out crlf.json
if cmp -s "$FIX/lf.json" "$FIX/crlf.json"; then
  _pass "a CRLF checkout (Windows, autocrlf) yields byte-identical facts"
else
  _fail "a CRLF checkout yields byte-identical facts" "lf.json and crlf.json differ"
fi

# --- --check names what moved ------------------------------------------------------------------------

fresh_copy
facts --out synced.json
assert_exit 0 "--check against an up-to-date copy exits 0" -- facts --check synced.json
assert_contains "$(facts --check synced.json)" "site facts match" "and says so"

sed -i 's|^/plugin install cortex$|/plugin install cortex@cortex|' "$FIX/README.md"
printf '9.9.9\n' > "$FIX/VERSION"
mkdir -p "$FIX/skills/new-ritual"
printf -- '---\nname: new-ritual\ndescription: A new ritual added after the site last synced its facts.\n---\n' > "$FIX/skills/new-ritual/SKILL.md"
printf '| `/new-ritual` | sometimes | something new |\n' >> "$FIX/AGENTS.md"

changes="$(facts --check synced.json)"
assert_exit 1 "--check exits 1 when facts moved" -- facts --check synced.json
assert_contains "$changes" "install command changed" "an edited install command is named"
assert_contains "$changes" "version $(tr -d '\r\n' < "$REPO_ROOT/VERSION") → 9.9.9" "a version bump is named with both values"
assert_contains "$changes" "ritual /new-ritual added" "a new ritual is named"

json="$(facts --check synced.json --json)"
assert_contains "$json" '"changes": [' "--json gives the changes as machine output"
