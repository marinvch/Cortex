# tools/server/server-setup.sh — both halves, run for real.
#
# HOME is overridden in every case that touches it. `server` mode writes to $HOME/git, and a test
# that creates directories in a developer's real home is a bug in the test — a silent one, because
# it would still pass.

SETUP="$REPO_ROOT/tools/server/server-setup.sh"

# --- usage ---

out="$(bash "$SETUP" 2>&1 || true)"
assert_exit 1 "no mode is a usage error" -- bash "$SETUP"
assert_contains "$out" "usage:" "and prints usage"

# --- server mode ---

FAKE_HOME="$WORK/home"
mkdir -p "$FAKE_HOME"
out="$(HOME="$FAKE_HOME" bash "$SETUP" server 2>&1)"
assert_eq "0" "$?" "server mode exits 0"
assert_exit 0 "creates a bare repo at \$HOME/git/<name>.git" -- test -d "$FAKE_HOME/git/cortex-brain.git"
assert_exit 0 "and it is genuinely bare" -- test -f "$FAKE_HOME/git/cortex-brain.git/HEAD"
assert_contains "$out" "clone URL" "prints a clone URL for the client half"

# Idempotence matters here: this is documented as a setup command people re-run when unsure whether
# it worked, and a second run must not destroy the first one's repo.
before="$(ls "$FAKE_HOME/git/cortex-brain.git")"
out="$(HOME="$FAKE_HOME" bash "$SETUP" server 2>&1)"
assert_eq "0" "$?" "a second server run exits 0"
assert_contains "$out" "already exists" "and says so rather than reinitialising"
assert_eq "$before" "$(ls "$FAKE_HOME/git/cortex-brain.git")" "the existing repo is untouched"

# A custom name is honoured.
HOME="$FAKE_HOME" bash "$SETUP" server my-brain >/dev/null 2>&1
assert_exit 0 "honours a custom repo name" -- test -d "$FAKE_HOME/git/my-brain.git"

# --- client mode ---

# Refuses to run outside a vault root. Without this guard it would clone into whatever directory it
# happened to be in, which for an agent is usually someone's product repo.
mkdir -p "$WORK/notavault"
out="$(cd "$WORK/notavault" && bash "$SETUP" client "$FAKE_HOME/git/cortex-brain.git" 2>&1 || true)"
assert_contains "$out" "VAULT ROOT" "client mode refuses to run outside a vault root"

# --- client mode with NO git identity ---
#
# A fresh server or container has none, and that is exactly where this script runs. The commit and
# push inside it are both `|| true`, so without an identity the clone ends up with no branch and no
# upstream — and the script used to print "ready" regardless. The MCP's pull/push would then fail
# later for a reason nobody could trace back here.

BARE="$FAKE_HOME/git/cortex-brain.git"
NOID="$WORK/vault-noid"
mkdir -p "$NOID/mcp"
: > "$NOID/mcp/server.js"
out="$(cd "$NOID" && HOME="$FAKE_HOME" GIT_CONFIG_GLOBAL=/dev/null bash "$SETUP" client "$BARE" acme 2>&1 || true)"
assert_contains "$out" "no upstream" "without a git identity the missing upstream is reported"
assert_contains "$out" "user.email" "and the message names the actual fix"
assert_exit 1 "and it exits non-zero rather than claiming success" -- \
  env HOME="$FAKE_HOME" GIT_CONFIG_GLOBAL=/dev/null bash -c "cd '$WORK/vault-noid2' 2>/dev/null || { mkdir -p '$WORK/vault-noid2/mcp' && : > '$WORK/vault-noid2/mcp/server.js' && cd '$WORK/vault-noid2'; }; bash '$SETUP' client '$BARE' acme"

# --- client mode with an identity (the happy path) ---

VAULT="$WORK/vault"
mkdir -p "$VAULT/mcp"
: > "$VAULT/mcp/server.js"
printf '[user]\n\temail = test@cortex.local\n\tname = Cortex Test\n' > "$FAKE_HOME/.gitconfig"

out="$(cd "$VAULT" && HOME="$FAKE_HOME" bash "$SETUP" client "$BARE" acme 2>&1)"
assert_eq "0" "$?" "client mode exits 0 with an identity present"
assert_exit 0 "clones into team/<slug>" -- test -d "$VAULT/team/acme/.git"
assert_contains "$out" "ready: team/acme" "and reports where it landed"

# The real point of the client half: the MCP's pull/push need a branch with an upstream, and a fresh
# bare clone has neither until this script makes one.
upstream="$(git -C "$VAULT/team/acme" rev-parse --abbrev-ref '@{u}' 2>/dev/null || echo none)"
assert_not_contains "$upstream" "none" "the clone has an upstream, so the MCP can push to it"

# Idempotent — re-running must not re-clone over an existing working tree.
out="$(cd "$VAULT" && HOME="$FAKE_HOME" bash "$SETUP" client "$BARE" acme 2>&1)"
assert_contains "$out" "clone already present" "a second client run leaves the clone alone"

# The default slug is `cortex` when none is given.
(cd "$VAULT" && HOME="$FAKE_HOME" bash "$SETUP" client "$BARE" >/dev/null 2>&1)
assert_exit 0 "defaults the slug to 'cortex'" -- test -d "$VAULT/team/cortex/.git"
