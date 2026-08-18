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

# --- cron mode ---------------------------------------------------------------
#
# A fake `crontab` is prepended to PATH for every case below. The real binary is absent on CI and is
# the developer's own on a workstation; invoking it for real in a test is unacceptable either way.
# The fake records its stdin so the tests can assert what WOULD have been installed.

FAKEBIN="$WORK/fakebin"
mkdir -p "$FAKEBIN"
cat > "$FAKEBIN/crontab" <<'FAKE'
#!/usr/bin/env bash
# Records stdin on `crontab -`, replays the recorded table on `crontab -l`.
STORE="${FAKE_CRONTAB_STORE:?FAKE_CRONTAB_STORE must be set}"
case "${1:-}" in
  -l) [ -f "$STORE" ] && cat "$STORE" || { echo "no crontab" >&2; exit 1; } ;;
  -)  cat > "$STORE" ;;
  *)  echo "fake crontab: unsupported args: $*" >&2; exit 2 ;;
esac
FAKE
chmod +x "$FAKEBIN/crontab"

export FAKE_CRONTAB_STORE="$WORK/crontab.txt"
CRONHOME="$WORK/cronhome"
mkdir -p "$CRONHOME"
cp "$FAKE_HOME/.gitconfig" "$CRONHOME/.gitconfig" 2>/dev/null || true

run_cron() { # extra args...
  ( export PATH="$FAKEBIN:$PATH" HOME="$CRONHOME" XDG_CONFIG_HOME="$CRONHOME/.config"
    cd "$WORK" && bash "$SETUP" cron "$BARE" "$CRONHOME/cortex-work" "$@" 2>&1 )
}

out="$(run_cron)"
assert_exit 0 "cron mode clones the working brain" -- test -d "$CRONHOME/cortex-work/.git"
assert_contains "$out" "0 6 * * *" "prints the daily schedule"
assert_contains "$out" "10 6 * * 1" "prints the weekly schedule"
assert_contains "$out" "cortex-cron.sh" "names the script to run"

# The docs hardcode $HOME/ai-os, which is wrong for anyone who cloned elsewhere. The path printed
# must be the real one on disk — a provisioning step that prints a path that does not exist is worse
# than one that prints nothing, because it looks finished.
printed_path="$(printf '%s\n' "$out" | grep -o '[^ ]*cortex-cron\.sh' | head -1)"
assert_exit 0 "and that path actually exists" -- test -f "$printed_path"

# Printing must not install.
assert_exit 1 "printing does not touch the crontab" -- test -f "$FAKE_CRONTAB_STORE"

# Idempotent clone.
out="$(run_cron)"
assert_contains "$out" "already" "a second run does not re-clone"

# --- the env file ---

ENVFILE="$CRONHOME/.config/cortex/cron.env"
assert_exit 0 "creates the env file" -- test -f "$ENVFILE"
envbody="$(cat "$ENVFILE")"
assert_not_contains "$envbody" "sk-ant" "the template carries no real key"
assert_contains "$out" "cron.env" "and the output points at it"

# Probe whether this host can express POSIX mode bits at all, rather than guessing from the platform
# name. Git Bash on NTFS reports a working `stat` while silently ignoring both `chmod` and `umask`,
# so checking for `stat` alone would assert something the filesystem cannot represent and fail for a
# reason that has nothing to do with the script. On Linux (and CI) this probe passes and the real
# assertion runs.
_probe="$WORK/.modeprobe"
( umask 077; : > "$_probe" ) 2>/dev/null
chmod 600 "$_probe" 2>/dev/null || true
if [ "$(stat -c %a "$_probe" 2>/dev/null || echo unknown)" = "600" ]; then
  assert_eq "600" "$(stat -c %a "$ENVFILE")" "the env file is 0600 — it holds a live API key"
else
  # Skipping loudly beats asserting something weaker and calling it a pass.
  echo "  skip  env-file mode check (this filesystem does not honour POSIX mode bits)"
fi
rm -f "$_probe"

# An existing env file is never clobbered — it holds a key someone pasted.
printf 'ANTHROPIC_API_KEY=already-here\n' > "$ENVFILE"
run_cron >/dev/null
assert_eq "ANTHROPIC_API_KEY=already-here" "$(cat "$ENVFILE")" "an existing env file is left alone"

# The crontab line must SOURCE the env file rather than inline the key.
out="$(run_cron)"
assert_contains "$out" "cron.env" "the crontab line sources the env file"
assert_not_contains "$out" "ANTHROPIC_API_KEY=sk-" "and never inlines a key"

# --- --install ---

printf '0 3 * * * echo unrelated-job\n' > "$FAKE_CRONTAB_STORE"
run_cron --install >/dev/null
installed="$(cat "$FAKE_CRONTAB_STORE")"
assert_contains "$installed" "cortex-cron (managed)" "install writes a marked block"
assert_contains "$installed" "unrelated-job" "and leaves unrelated cron lines untouched"

# Second install replaces the managed block rather than appending a duplicate.
run_cron --install >/dev/null
installed="$(cat "$FAKE_CRONTAB_STORE")"
assert_eq "2" "$(printf '%s\n' "$installed" | grep -c 'cortex-cron\.sh')" "a second install leaves exactly one pair of lines"
assert_contains "$installed" "unrelated-job" "and still leaves the unrelated line"
