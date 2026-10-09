# cortex-init.sh tells the retired engine's MCP entry from Cortex's own (#552).
#
# The retired engine registered a server named `ai-os` that ran out of the repo's `.ai-os/`
# directory. Cortex's own server was documented under that same name, with AI_OS_ROOT, until #552.
# The installer matched the NAME, so a repo whose `.mcp.json` held a working Cortex registration
# was told it carried an old engine and sent to /migrate-engine, whose Step 5 removes the entry.
#
# What marks the engine is where the entry points: `.ai-os/`. The name marks nothing.

. "$(dirname "${BASH_SOURCE[0]}")/_helpers.sh"   # $WORK or refuse — see the gate there

INIT="$REPO_ROOT/tools/cortex-init.sh"

# init_in <dir> — run the installer there, unattended, with $HOME pointed away from the real one.
init_in() {
  mkdir -p "$WORK/home"
  out="$(cd "$1" 2>/dev/null && HOME="$WORK/home" USERPROFILE="$WORK/home" bash "$INIT" --yes --no-plugins 2>&1)"
}

proj() { # name → a fresh directory under $WORK
  mkdir -p "$WORK/$1/.vscode"
  printf '{ "name": "%s" }\n' "$1" > "$WORK/$1/package.json"
}

# --- Cortex's own server, registered under the older name ---

proj current-old-name
cat > "$WORK/current-old-name/.mcp.json" <<'JSON'
{ "mcpServers": { "ai-os": { "command": "node", "args": ["/opt/cortex/mcp/server.js"], "env": { "AI_OS_ROOT": "/home/dev/vault" } } } }
JSON
init_in "$WORK/current-old-name"
assert_contains "$out" "cortex-init" "the installer ran"
assert_not_contains "$out" "Old engine" "a Cortex server registered as ai-os with AI_OS_ROOT is not the old engine"
assert_not_contains "$out" "migrate-engine" "and the repo is not sent to /migrate-engine"

# --- Cortex's own server, registered under the current name ---

proj current-new-name
cat > "$WORK/current-new-name/.mcp.json" <<'JSON'
{ "mcpServers": { "cortex": { "command": "node", "args": ["/opt/cortex/mcp/server.js"], "env": { "CORTEX_ROOT": "/home/dev/vault" } } } }
JSON
init_in "$WORK/current-new-name"
assert_not_contains "$out" "Old engine" "a server registered as cortex with CORTEX_ROOT is not the old engine"

# --- the retired engine's entry ---

proj engine-entry
cat > "$WORK/engine-entry/.mcp.json" <<'JSON'
{ "mcpServers": { "ai-os": { "command": "node", "args": [".ai-os/mcp-server/dist/index.js"] } } }
JSON
init_in "$WORK/engine-entry"
assert_contains "$out" "Old engine" "an entry that runs out of .ai-os/ is the old engine"
assert_contains "$out" "MCP entry" "and the list names the MCP entry"
assert_contains "$out" "/migrate-engine" "and points at the ritual that harvests it"

proj engine-vscode
cat > "$WORK/engine-vscode/.vscode/mcp.json" <<'JSON'
{ "servers": { "ai-os": { "command": "node", "args": ["${workspaceFolder}\\.ai-os\\mcp-server\\dist\\index.js"] } } }
JSON
init_in "$WORK/engine-vscode"
assert_contains "$out" "MCP entry" "the same entry in .vscode/mcp.json, with Windows separators, is found"

# --- the engine under another server name is still the engine ---

proj engine-renamed
cat > "$WORK/engine-renamed/.mcp.json" <<'JSON'
{ "mcpServers": { "context": { "command": "node", "args": ["./.ai-os/mcp-server/dist/index.js"] } } }
JSON
init_in "$WORK/engine-renamed"
assert_contains "$out" "MCP entry" "what marks the engine is the .ai-os/ path, whatever the server is called"

# --- no MCP config at all ---

proj plain
init_in "$WORK/plain"
assert_not_contains "$out" "Old engine" "a repo with no MCP config reports no engine"
