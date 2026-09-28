# cortex-shared-plugin writes into a team's committed .claude/settings.json — outside .cortex/, into
# a file that holds hooks and permissions other people depend on. So the contract is checked on a
# real git fixture, where "every other key is as it was" is a git diff anyone can read:
#
#   - the offer (a cortex-loop row) appears on the work profile or with a team-brain connector, and
#     never on home or lab without one;
#   - the merge only inserts: a team's keys, marketplaces and plugins survive, and the diff is the two
#     entries plus the comma JSON forces on the line before each;
#   - a second run writes nothing; a file that does not parse is refused and left exactly as it was.
#
# index/test/shared-plugin.test.mjs covers the merge from literals; this is the CLI's own contract.

. "$(dirname "${BASH_SOURCE[0]}")/_helpers.sh"   # $WORK or refuse — see the gate there

SP="$REPO_ROOT/index/cortex-shared-plugin.mjs"
LOOP="$REPO_ROOT/index/cortex-loop.mjs"

# The state of the team-plugin row in cortex-loop --json: missing, present, blocked, or absent.
row_bucket() { # json -> bucket
  node -e 'const j = JSON.parse(require("fs").readFileSync(0, "utf8")); for (const b of ["missing", "present", "blocked"]) if (j[b].some((e) => e.id === "team-plugin")) { process.stdout.write(b); process.exit(0); } process.stdout.write("absent");' <<< "$1"
}

# --- who is offered it ------------------------------------------------------------------------------

P="$WORK/proj"
mkrepo "$P"
printf '{ "name": "p" }\n' > "$P/package.json"
( cd "$P" || exit 1; git add -A && git commit -qm init )

assert_eq "absent"  "$(row_bucket "$(CORTEX_PROFILE= node "$LOOP" "$P" --json 2>/dev/null)")" "no profile and no connector: not offered, not named"
assert_eq "absent"  "$(row_bucket "$(CORTEX_PROFILE=home node "$LOOP" "$P" --json 2>/dev/null)")" "home with no connector: not offered"
assert_eq "absent"  "$(row_bucket "$(CORTEX_PROFILE=lab node "$LOOP" "$P" --json 2>/dev/null)")" "lab with no connector: not offered"
assert_eq "missing" "$(row_bucket "$(CORTEX_PROFILE=work node "$LOOP" "$P" --json 2>/dev/null)")" "the work profile: offered"
out="$(CORTEX_PROFILE=work node "$LOOP" "$P" 2>/dev/null)"
assert_contains "$out" "Cortex for the whole team" "the human loop names the row"

C="$WORK/connected"
mkrepo "$C"
mkdir -p "$C/.cortex"
printf '{ "team": "platform", "project": "api", "teamBrainRepo": "git@example.com:t/brain.git" }\n' > "$C/.cortex/connector.json"
( cd "$C" || exit 1; git add -A && git commit -qm init )
json="$(CORTEX_PROFILE=home node "$LOOP" "$C" --json 2>/dev/null)"
assert_eq "missing" "$(row_bucket "$json")" "a team-brain connector: offered even on home"
assert_contains "$json" "the platform team's brain" "and the evidence names the team"

# The connector /team-add wrote before it named the team: { slug, teamBrainRepo }, where slug is the
# PROJECT. Still a team's repo — but the project's name is not the team's.
L="$WORK/legacy"
mkrepo "$L"
mkdir -p "$L/.cortex"
printf '{ "slug": "web-app", "teamBrainRepo": "https://example.invalid/t/brain.git" }\n' > "$L/.cortex/connector.json"
( cd "$L" || exit 1; git add -A && git commit -qm init )
json="$(CORTEX_PROFILE=home node "$LOOP" "$L" --json 2>/dev/null)"
assert_eq "missing" "$(row_bucket "$json")" "an old {slug} connector: offered"
assert_not_contains "$json" "web-app team" "and the project slug is not called the team"

# --- status writes nothing ----------------------------------------------------------------------------

out="$(node "$SP" "$P" 2>&1)"; rc=$?
assert_eq "0" "$rc" "status exits 0"
assert_contains "$out" "extraKnownMarketplaces.cortex" "status names what a merge would add"
assert_contains "$out" "claude plugin install cortex@cortex --scope project" "and says each teammate still installs once"
json="$(node "$SP" "$P" --json 2>&1)"
assert_contains "$json" '"served": false' "--json says it is not served"
assert_eq "" "$(git -C "$P" status --porcelain -uall)" "status writes nothing"

# --- a team's settings: merged into, never replaced --------------------------------------------------------

T="$WORK/team"
mkrepo "$T"
mkdir -p "$T/.claude"
cat > "$T/.claude/settings.json" <<'JSON'
{
  "permissions": {
    "allow": ["Bash(npm test)", "Read(./src/**)"],
    "deny": ["Read(./.env)"]
  },
  "hooks": {
    "PostToolUse": [
      { "matcher": "Edit|Write", "hooks": [{ "type": "command", "command": "bash .claude/hooks/format.sh" }] }
    ]
  },
  "extraKnownMarketplaces": {
    "acme-tools": { "source": { "source": "github", "repo": "acme-corp/claude-plugins" } }
  },
  "enabledPlugins": {
    "code-formatter@acme-tools": true
  }
}
JSON
( cd "$T" || exit 1; git add -A && git commit -qm "the team's settings" )
cp "$T/.claude/settings.json" "$WORK/team-before.json"

out="$(node "$SP" "$T" --write 2>&1)"; rc=$?
assert_eq "0" "$rc" "--write exits 0"
assert_contains "$out" "Added extraKnownMarketplaces.cortex and enabledPlugins.cortex@cortex" "and says what it added"
assert_contains "$out" "every other key is as it was" "and that nothing else moved"
assert_contains "$out" "claude plugin install cortex@cortex --scope project" "and what each teammate still does"
assert_eq " M .claude/settings.json" "$(git -C "$T" status --porcelain -uall)" "only settings.json changed"

same="$(node -e '
  const [a, b] = [0, 1].map((i) => JSON.parse(require("fs").readFileSync(process.argv[1 + i], "utf8")));
  delete b.extraKnownMarketplaces.cortex; delete b.enabledPlugins["cortex@cortex"];
  process.stdout.write(JSON.stringify(a) === JSON.stringify(b) ? "same" : "DIFFERENT");
' "$WORK/team-before.json" "$T/.claude/settings.json")"
assert_eq "same" "$same" "with the two entries taken out, the settings are exactly the team's"
# How git aligns the hunks varies (a closing brace can match either one), so the claim is on content:
# at most the two lines before the insertions are removed, and each comes back with only a comma.
diff0="$(git -C "$T" diff -U0)"
removed="$(grep -c '^-[^-]' <<< "$diff0")"
[ "$removed" -le 2 ] && _pass "the diff removes at most the two lines that gain a comma" || _fail "the diff removes at most the two lines that gain a comma" "removed $removed"
added_back=0
while IFS= read -r l; do
  [ -n "$l" ] && grep -qxF "+${l#-}," <<< "$diff0" && added_back=$((added_back + 1))
done <<< "$(grep '^-[^-]' <<< "$diff0")"
assert_eq "$removed" "$added_back" "and each comes back with only a comma added"
cfg="$(cat "$T/.claude/settings.json")"
assert_contains "$cfg" '"repo": "marinvch/Cortex"' "the marketplace is the GitHub source"
assert_contains "$cfg" '"cortex@cortex": true' "and the plugin is enabled"
assert_eq "present" "$(row_bucket "$(CORTEX_PROFILE=work node "$LOOP" "$T" --json 2>/dev/null)")" "the loop now reads the row as served"

# A second run: nothing to add, and not one byte written.
after="$(cat "$T/.claude/settings.json")"
out="$(node "$SP" "$T" --write 2>&1)"; rc=$?
assert_eq "0" "$rc" "a second --write exits 0"
assert_contains "$out" "Nothing to add" "and says there is nothing to add"
assert_eq "$after" "$(cat "$T/.claude/settings.json")" "and the file is byte-for-byte what the first run wrote"

# An entry the team set is theirs: turned off stays off.
printf '{\n  "enabledPlugins": {\n    "cortex@cortex": false\n  }\n}\n' > "$T/.claude/settings.json"
node "$SP" "$T" --write >/dev/null 2>&1
assert_contains "$(cat "$T/.claude/settings.json")" '"cortex@cortex": false' "a plugin the team turned off stays off"
assert_contains "$(cat "$T/.claude/settings.json")" '"cortex": {' "and only the missing marketplace is added"

# --- no settings file yet ------------------------------------------------------------------------------

N="$WORK/fresh"
mkrepo "$N"
out="$(node "$SP" "$N" --write 2>&1)"; rc=$?
assert_eq "0" "$rc" "--write on a repo with no .claude/ exits 0"
assert_eq "?? .claude/settings.json" "$(git -C "$N" status --porcelain -uall)" "and creates exactly .claude/settings.json"
want="$(printf '{\n  "extraKnownMarketplaces": {\n    "cortex": {\n      "source": {\n        "source": "github",\n        "repo": "marinvch/Cortex"\n      }\n    }\n  },\n  "enabledPlugins": {\n    "cortex@cortex": true\n  }\n}')"
assert_eq "$want" "$(cat "$N/.claude/settings.json")" "holding the two documented entries and nothing else"
assert_contains "$out" 'No "autoUpdate" written' "without --auto-update, the output says auto-update was not written"

# --- auto-update: its own choice, off without the flag ---------------------------------------------------
# settings-reference, extraKnownMarketplaces: "an optional `autoUpdate` Boolean". True makes every
# teammate's Claude Code update the plugin in the background; third-party marketplaces default to false.

assert_contains "$(node "$SP" "$P" 2>&1)" "off unless you add --auto-update" "status offers auto-update as a separate choice"

A="$WORK/auto"
mkrepo "$A"
mkdir -p "$A/.claude"
cp "$WORK/team-before.json" "$A/.claude/settings.json"
( cd "$A" || exit 1; git add -A && git commit -qm "the team's settings" )
out="$(node "$SP" "$A" --write --auto-update 2>&1)"; rc=$?
assert_eq "0" "$rc" "--write --auto-update exits 0"
assert_contains "$out" 'Set "autoUpdate": true' "and says it set auto-update"
assert_contains "$out" "pulls new Cortex releases in the background" "and what that means for every teammate"
cortex_entry() { node -e 'process.stdout.write(JSON.stringify(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).extraKnownMarketplaces.cortex))' "$1"; }
assert_eq '{"source":{"source":"github","repo":"marinvch/Cortex"},"autoUpdate":true}' "$(cortex_entry "$A/.claude/settings.json")" "the new cortex entry carries autoUpdate: true"
same="$(node -e '
  const [a, b] = [0, 1].map((i) => JSON.parse(require("fs").readFileSync(process.argv[1 + i], "utf8")));
  delete b.extraKnownMarketplaces.cortex; delete b.enabledPlugins["cortex@cortex"];
  process.stdout.write(JSON.stringify(a) === JSON.stringify(b) ? "same" : "DIFFERENT");
' "$WORK/team-before.json" "$A/.claude/settings.json")"
assert_eq "same" "$same" "and every other key is still the team's"
auto_after="$(cat "$A/.claude/settings.json")"
out="$(node "$SP" "$A" --write --auto-update 2>&1)"
assert_contains "$out" "Nothing to add" "a second --write --auto-update has nothing to add"
assert_contains "$out" "autoUpdate is true; Cortex never changes it" "and says the entry's autoUpdate was kept"
assert_eq "$auto_after" "$(cat "$A/.claude/settings.json")" "and writes not one byte"

# An entry already there keeps its autoUpdate, whatever the flag says — and the output says so.
printf '{\n  "extraKnownMarketplaces": {\n    "cortex": {\n      "source": { "source": "github", "repo": "marinvch/Cortex" },\n      "autoUpdate": false\n    }\n  }\n}\n' > "$A/.claude/settings.json"
out="$(node "$SP" "$A" --write --auto-update 2>&1)"
assert_eq '{"source":{"source":"github","repo":"marinvch/Cortex"},"autoUpdate":false}' "$(cortex_entry "$A/.claude/settings.json")" "an existing autoUpdate: false stays false under --auto-update"
assert_contains "$out" "autoUpdate is false; Cortex never changes it" "and --write says it was left alone"
assert_contains "$(node "$SP" "$A" 2>&1)" "autoUpdate is false; Cortex never changes it" "and so does status"
assert_contains "$(node "$SP" "$A" --json 2>&1)" '"autoUpdate": false' "and --json reports it"

# --- a file that does not parse --------------------------------------------------------------------------

B="$WORK/broken"
mkrepo "$B"
mkdir -p "$B/.claude"
printf '{\n  "hooks": { // a comment\n  }\n}\n' > "$B/.claude/settings.json"
( cd "$B" || exit 1; git add -A && git commit -qm init )
broken="$(cat "$B/.claude/settings.json")"
out="$(node "$SP" "$B" --write 2>&1)"; rc=$?
assert_eq "2" "$rc" "a settings.json that does not parse is refused (exit 2)"
assert_contains "$out" "not valid JSON" "with a sentence"
assert_not_contains "$out" "    at " "not a stack trace"
assert_eq "$broken" "$(cat "$B/.claude/settings.json")" "and the file is exactly as it was"
assert_eq "" "$(git -C "$B" status --porcelain -uall)" "nothing else was written, not even a temp file"
assert_eq "blocked" "$(row_bucket "$(CORTEX_PROFILE=work node "$LOOP" "$B" --json 2>/dev/null)")" "the loop names the row as blocked on it"

# --- arguments ---------------------------------------------------------------------------------------------

assert_exit 1 "an unknown flag is refused" -- node "$SP" "$P" --force
