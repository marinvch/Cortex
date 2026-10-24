# cortex-setup registers the Cortex MCP server in each agent a team uses (#623). The configs are
# other people's files, and two of them are committed for a whole team, so the contract is checked
# on fixtures:
#
#   - each agent's generated config equals tools/test/fixtures/setup/<agent>.*, so a format change
#     shows up here as a failing test and not in a teammate's editor;
#   - a merge keeps every unrelated server byte-for-byte, leaves an existing `cortex` entry as it is,
#     and refuses a file it cannot read — writing nothing at all when one file is refused;
#   - without --write nothing is written anywhere, checked by fingerprinting the whole tree, the fake
#     home included (docs/changing-cortex.md: assert the property, not one symptom).
#
# Nothing here launches Copilot, Gemini CLI or Codex; the fixtures are the agents' documented
# formats, with the doc URLs and the date checked in the header of tools/_setup-agents.mjs.

. "$(dirname "${BASH_SOURCE[0]}")/_helpers.sh"   # $WORK or refuse — see the gate there

SETUP="$REPO_ROOT/tools/cortex-setup.mjs"
FIX="$REPO_ROOT/tools/test/fixtures/setup"

# A Cortex for CORTEX_HOME to name: only its mcp/server.js is looked for.
CH="$WORK/cortex-home"
mkdir -p "$CH/mcp" && : > "$CH/mcp/server.js"

# Every run gets a home of its own (USERPROFILE is what node reads on Windows) and no CODEX_HOME,
# CORTEX_HOME or Claude plugin registry from the developer's machine.
HOME_DIR="$WORK/home"
mkdir -p "$HOME_DIR"
setup() { # args...
  HOME="$HOME_DIR" USERPROFILE="$HOME_DIR" CODEX_HOME="" CORTEX_HOME="$CH" node "$SETUP" "$@"
}

# Compare a file with a fixture, line endings normalised (a Windows checkout gives the fixture CRLF),
# and @CORTEX_HOME@ standing for the CORTEX_HOME the run was given, as node saw it.
same_as() { # file fixture -> "same" or a diff summary
  CORTEX_HOME="$CH" node -e '
    const fs = require("fs");
    const norm = (s) => s.replace(/\r\n/g, "\n");
    const home = process.env.CORTEX_HOME.replace(/\\/g, "/");
    const got = norm(fs.readFileSync(process.argv[1], "utf8"));
    const want = norm(fs.readFileSync(process.argv[2], "utf8")).split("@CORTEX_HOME@").join(home);
    process.stdout.write(got === want ? "same" : "differs:\n" + got);
  ' "$1" "$2"
}

# The whole tree under a directory, as one line per file: path and content hash.
fingerprint() { # dir
  ( cd "$1" || exit 1; find . -type f ! -path './.git/*' | LC_ALL=C sort | while read -r f; do printf '%s %s\n' "$f" "$(cksum < "$f")"; done )
}

# --- a fresh repo: each agent's config is its fixture --------------------------------------------------

P="$WORK/proj"
mkrepo "$P"
printf '# Proj\n\nRules.\n' > "$P/AGENTS.md"

before="$(fingerprint "$WORK")"
out="$(setup --agents claude,copilot,gemini,codex --repo "$P")"
assert_eq "$before" "$(fingerprint "$WORK")" "a dry run writes nothing anywhere — repo and home"
assert_contains "$out" "A dry run: nothing was written" "and says so"
assert_contains "$out" ".vscode/mcp.json" "the plan names the Copilot file"
assert_contains "$out" "project scope" "and its scope"
assert_contains "$out" "user scope" "Codex is user scope, and the plan says why"
assert_contains "$out" "a second copy of the same server" "claude writes nothing: the plugin carries the server"
assert_contains "$out" "Settings > Copilot > MCP servers" "the coding agent is configured on github.com, not in a file"
assert_exit 0 "--dry-run is the same dry run" -- setup --agents copilot --repo "$P" --dry-run
assert_eq "$before" "$(fingerprint "$WORK")" "and --dry-run writes nothing either"

out="$(setup --agents claude,copilot,gemini,codex --repo "$P" --write)"
assert_eq "same" "$(same_as "$P/.vscode/mcp.json" "$FIX/copilot.mcp.json")" "copilot: .vscode/mcp.json is the fixture"
assert_eq "same" "$(same_as "$P/.gemini/settings.json" "$FIX/gemini.settings.json")" "gemini: .gemini/settings.json is the fixture"
assert_eq "same" "$(same_as "$HOME_DIR/.codex/config.toml" "$FIX/codex.config.toml")" "codex: ~/.codex/config.toml is the fixture"
assert_eq "no" "$( [ -e "$P/.mcp.json" ] && echo yes || echo no)" "claude: no .mcp.json beside the plugin's server"
assert_eq "@AGENTS.md" "$(tr -d '\r' < "$P/GEMINI.md")" "gemini: the GEMINI.md shim, pointing at AGENTS.md"
assert_contains "$(cat "$P/.github/copilot-instructions.md")" "AGENTS.md" "copilot: copilot-instructions.md points at AGENTS.md"
assert_not_contains "$(cat "$P/.vscode/mcp.json" "$P/.gemini/settings.json")" "$CH" "the committed files carry no path on this machine"
assert_contains "$out" "git add .vscode/mcp.json .gemini/settings.json" "it names what to commit"
assert_not_contains "$out" "git add .vscode/mcp.json .gemini/settings.json ~/.codex" "and not the user-scope file"
assert_eq "$(printf '# Proj\n\nRules.\n')" "$(tr -d '\r' < "$P/AGENTS.md")" "no connector: the root brief is not touched"

before="$(fingerprint "$WORK")"
out="$(setup --agents claude,copilot,gemini,codex --repo "$P" --write)"
assert_eq "$before" "$(fingerprint "$WORK")" "a second run writes nothing"
assert_contains "$out" "Nothing to write" "and says every entry is already there"

# --- a team's repo: the inbox line -------------------------------------------------------------------

T="$WORK/team"
mkrepo "$T"
printf '# Team repo\n' > "$T/AGENTS.md"
mkdir -p "$T/.cortex"
printf '{ "team": "platform", "project": "api", "teamBrainRepo": "https://example.invalid/brain" }\n' > "$T/.cortex/connector.json"
setup --agents codex --repo "$T" --write > /dev/null
brief="$(tr -d '\r' < "$T/AGENTS.md")"
assert_contains "$brief" '## Team-brain' "with a connector, the brief gains a Team-brain section"
assert_contains "$brief" 'call the Cortex `inbox` tool (or run `ai-os inbox`) at the start of a task' "holding the inbox line"
setup --agents codex --repo "$T" --write > /dev/null
assert_eq "1" "$(grep -c 'ai-os inbox' "$T/AGENTS.md")" "and a second run does not add it twice"

# --- merges: unrelated entries byte-for-byte, an existing cortex kept ------------------------------------

M="$WORK/merge"
mkrepo "$M"
mkdir -p "$M/.vscode" "$M/.gemini"
cp "$FIX/copilot-existing.in.json" "$M/.vscode/mcp.json"
cp "$FIX/gemini-existing.in.json" "$M/.gemini/settings.json"
H2="$WORK/home2"
mkdir -p "$H2/.codex"
cp "$FIX/codex-existing.in.toml" "$H2/.codex/config.toml"
gem_before="$(cksum < "$M/.gemini/settings.json")"
HOME="$H2" USERPROFILE="$H2" CODEX_HOME="" CORTEX_HOME="$CH" node "$SETUP" --agents copilot,gemini,codex --repo "$M" --write > "$WORK/merge.out"
assert_eq "same" "$(same_as "$M/.vscode/mcp.json" "$FIX/copilot-existing.out.json")" "copilot: other servers and inputs kept byte-for-byte, cortex added last, 4-space indent kept"
assert_eq "same" "$(same_as "$H2/.codex/config.toml" "$FIX/codex-existing.out.toml")" "codex: the old file is the exact prefix, the table appended"
assert_eq "$gem_before" "$(cksum < "$M/.gemini/settings.json")" "gemini: a cortex entry already there is left exactly as it is"
assert_contains "$(cat "$WORK/merge.out")" "left exactly as it is" "and the plan says so"

# CODEX_HOME is honoured, and must exist (Codex requires it to).
H3="$WORK/codex-home"
mkdir -p "$H3"
HOME="$HOME_DIR" USERPROFILE="$HOME_DIR" CODEX_HOME="$H3" CORTEX_HOME="$CH" node "$SETUP" --agents codex --repo "$M" --write > /dev/null
assert_eq "same" "$(same_as "$H3/config.toml" "$FIX/codex.config.toml")" "codex: CODEX_HOME/config.toml when CODEX_HOME is set"
assert_exit 2 "a CODEX_HOME that does not exist is refused, not created" -- env HOME="$HOME_DIR" USERPROFILE="$HOME_DIR" CODEX_HOME="$WORK/nope" CORTEX_HOME="$CH" node "$SETUP" --agents codex --repo "$M" --write
assert_eq "no" "$( [ -e "$WORK/nope" ] && echo yes || echo no)" "and nothing was created"

# --- refusals: a file it cannot read, and then nothing is written at all ----------------------------------

R="$WORK/refuse"
mkrepo "$R"
printf '# R\n' > "$R/AGENTS.md"
mkdir -p "$R/.vscode"
printf '{\n  // a comment VS Code accepts\n  "servers": {}\n}\n' > "$R/.vscode/mcp.json"
before="$(fingerprint "$WORK")"
assert_exit 2 "a JSONC mcp.json is refused" -- setup --agents copilot,gemini,codex --repo "$R" --write
assert_eq "$before" "$(fingerprint "$WORK")" "and with one file refused, --write writes none of them — not Gemini's, not Codex's"
out="$(setup --agents copilot --repo "$R" 2>&1)"
assert_contains "$out" "not plain JSON" "the refusal is a sentence naming the file's problem"

printf '{ "servers": [] }\n' > "$R/.vscode/mcp.json"
assert_exit 2 "a servers key that is not an object is refused" -- setup --agents copilot --repo "$R" --write

toml_refused() { # content message
  local h="$WORK/tomlhome"
  rm -rf "$h"; mkdir -p "$h/.codex"
  printf '%s' "$1" > "$h/.codex/config.toml"
  local sum; sum="$(cksum < "$h/.codex/config.toml")"
  assert_exit 2 "$2" -- env HOME="$h" USERPROFILE="$h" CODEX_HOME="" CORTEX_HOME="$CH" node "$SETUP" --agents codex --repo "$R" --write
  assert_eq "$sum" "$(cksum < "$h/.codex/config.toml")" "  ...and the file is left as it was"
}
toml_refused $'mcp_servers = { other = { command = "x" } }\n' "codex: an inline mcp_servers table is refused (a header cannot extend it)"
toml_refused $'notes = """\nnever closed\n' "codex: a file ending inside a multi-line string is refused"
toml_refused $'args = [\n  "a",\n' "codex: a file ending inside an array is refused"
toml_refused $'this is not toml\n' "codex: a line that is neither a header nor key = value is refused"
toml_refused $'[[mcp_servers]]\nname = "x"\n' "codex: mcp_servers as an array of tables is refused"

kept_toml() { # content message
  local h="$WORK/tomlkeep"
  rm -rf "$h"; mkdir -p "$h/.codex"
  printf '%s' "$1" > "$h/.codex/config.toml"
  local sum; sum="$(cksum < "$h/.codex/config.toml")"
  HOME="$h" USERPROFILE="$h" CODEX_HOME="" CORTEX_HOME="$CH" node "$SETUP" --agents codex --repo "$R" --write > /dev/null
  assert_eq "$sum" "$(cksum < "$h/.codex/config.toml")" "$2"
}
kept_toml $'[mcp_servers.cortex]\ncommand = "mine"\n' "codex: [mcp_servers.cortex] already there is kept"
kept_toml $'[mcp_servers."cortex"]\ncommand = "mine"\n' "codex: ...in a quoted spelling too"
kept_toml $'[mcp_servers]\ncortex = { command = "mine" }\n' "codex: ...or as cortex = {} under [mcp_servers]"
kept_toml $'[mcp_servers.cortex.env]\nX = "1"\n' "codex: ...or only its env sub-table"

# --- arguments ----------------------------------------------------------------------------------------

assert_exit 1 "no --agents is a usage error" -- setup --repo "$P"
assert_exit 1 "an unknown agent is a usage error" -- setup --agents copilot,cursor --repo "$P"
assert_exit 1 "--write with --dry-run is a usage error" -- setup --agents copilot --repo "$P" --write --dry-run
assert_exit 1 "a --repo that does not exist is a usage error" -- setup --agents copilot --repo "$WORK/missing"
json="$(setup --agents copilot,codex --repo "$P" --json)"
assert_contains "$json" '"action": "keep"' "--json reports each file's action"
assert_contains "$json" '"cortexHome"' "and the CORTEX_HOME it found"
