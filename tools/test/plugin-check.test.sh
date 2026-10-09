# A plugin reaches a session through three copies, and the tool has to report each one separately.
#
# Collapsing them into a single "you are up to date / you are not" is the failure this exists to
# prevent: updating the marketplace does NOT move the installed cache, so a user who ran the update
# and saw one number move concludes the job is done while the session keeps running the old copy.
# Every command is still present and every skill still loads, so nothing announces it — a correct fix
# just looks broken.
#
# The registry lives under $HOME, so every case here overrides it (run.sh's rule) and none of them can
# read the real machine.

. "$(dirname "${BASH_SOURCE[0]}")/_helpers.sh"   # $WORK or refuse — see the gate there

PC="$REPO_ROOT/tools/cortex-plugin-check.mjs"

work="$(mktemp -d)"

# stage <installed-version> <clone-version> — build a fake ~/.claude/plugins for one scenario.
# An empty version means "that copy is not present at all", which is its own reportable state.
#
# It echoes a NATIVE path, because the tool asks node for the home directory and node answers with
# the platform's own variable — USERPROFILE on Windows, HOME elsewhere. An override that sets only
# HOME leaves a Windows run reading the real machine, which is how the first version of this file
# "passed" against the developer's actual plugin registry. as_home() below sets both.
stage() {
  local inst="$1" clone="$2" h="$work/home-$3"
  rm -rf "$h"; mkdir -p "$h/.claude/plugins/marketplaces/cortex"
  [ -n "$clone" ] && printf '%s\n' "$clone" > "$h/.claude/plugins/marketplaces/cortex/VERSION"
  if [ -n "$inst" ]; then
    cat > "$h/.claude/plugins/installed_plugins.json" <<JSON
{"version":2,"plugins":{"cortex@cortex":[{"scope":"user","version":"$inst",
"installPath":"$h/.claude/plugins/cache/cortex/cortex/$inst"}]}}
JSON
  else
    printf '{"version":2,"plugins":{}}\n' > "$h/.claude/plugins/installed_plugins.json"
  fi
  # A native path: node resolves a bare /tmp/... against the current drive on Windows.
  if command -v cygpath >/dev/null 2>&1; then cygpath -w "$h"; else printf '%s' "$h"; fi
}

# Run a command with the home directory pointed at a fixture, on any platform.
as_home() { local h="$1"; shift; env HOME="$h" USERPROFILE="$h" "$@"; }

repo_version="$(cat "$REPO_ROOT/VERSION")"

# --- behind ------------------------------------------------------------------------------------------

h="$(stage 1.0.0 1.0.0 behind)"
assert_exit 1 "--check fails when the installed cache is behind the repo" \
  -- as_home "$h" node "$PC" --check

out="$(as_home "$h" node "$PC" 2>&1)"
assert_contains "$out" "installed cache" "it names the stage that decides behaviour"
assert_contains "$out" "marketplace clone" "and the stage an update moves first"
assert_contains "$out" "1.0.0" "reporting what is actually installed, not what should be"
assert_contains "$out" "$repo_version" "beside what the repo holds"

# The load-bearing sentence. Someone who updates the marketplace and stops has done half the job, and
# the report is the only thing that will tell them.
assert_contains "$out" "the first alone is not enough" \
  "and says the two steps are two, because the first alone silently does nothing"

# --- current ------------------------------------------------------------------------------------------

h="$(stage "$repo_version" "$repo_version" current)"
assert_exit 0 "--check passes when the running copy matches the repo" \
  -- as_home "$h" node "$PC" --check
out="$(as_home "$h" node "$PC" 2>&1)"
assert_contains "$out" "matches the repo" "and says so plainly"

# --- the half-done update ---------------------------------------------------------------------------
#
# The exact trap: marketplace current, installed cache stale. This must still fail, because the copy
# that runs is the installed one — a check that passed here would bless the broken state.
h="$(stage 1.0.0 "$repo_version" half)"
assert_exit 1 "a fresh marketplace with a stale install still fails — the clone is not what runs" \
  -- as_home "$h" node "$PC" --check

# --- not installed at all ------------------------------------------------------------------------------
#
# Running from a checkout is a normal, correct state. It must not read as "behind", or working on
# Cortex itself would report a permanent false failure.
h="$(stage "" "" none)"
assert_exit 0 "an uninstalled plugin is not a failure — a checkout is a valid way to run" \
  -- as_home "$h" node "$PC" --check
out="$(as_home "$h" node "$PC" 2>&1)"
assert_contains "$out" "Not installed" "and it says which state it is in rather than inventing a version"

# --- json ------------------------------------------------------------------------------------------------

h="$(stage 1.0.0 1.0.0 json)"
out="$(as_home "$h" node "$PC" --json 2>&1)"
assert_contains "$out" '"behind": true' "--json exposes the verdict for a ritual to walk"
assert_contains "$out" '"stage": "installed cache"' "with every stage kept separate, not summarised"

# --- it writes nothing ------------------------------------------------------------------------------------

h="$(stage 1.0.0 1.0.0 readonly)"; b="$work/home-readonly"
before="$(find "$b" -type f | sort; cat "$b/.claude/plugins/installed_plugins.json")"
as_home "$h" node "$PC" >/dev/null 2>&1 || true
after="$(find "$b" -type f | sort; cat "$b/.claude/plugins/installed_plugins.json")"
assert_eq "$before" "$after" "a check leaves the plugin registry byte-identical"

# --- --remote: is a newer Cortex published? ------------------------------------------------------------
#
# Run from an installed copy, the "repo" row is the cache itself, so "matches the repo" is true by
# construction and says nothing about upstream (#548, item 12). --remote reads VERSION from the
# default branch of the plugin's repository. A bare repo on disk is a complete remote.

# upstream <version> <name> — a bare repo whose default branch holds that VERSION; echoes its path.
upstream() {
  local src="$work/src-$2" bare="$work/up-$2.git"
  rm -rf "$src" "$bare"; mkdir -p "$src"
  git -C "$src" init -q -b main
  git -C "$src" config user.email t@example.invalid; git -C "$src" config user.name t
  [ -n "$1" ] && printf '%s\n' "$1" > "$src/VERSION"
  printf 'x\n' > "$src/README.md"
  git -C "$src" add -A; git -C "$src" commit -q -m v
  git clone -q --bare "$src" "$bare"
  if command -v cygpath >/dev/null 2>&1; then cygpath -m "$bare"; else printf '%s' "$bare"; fi
}

h="$(stage "$repo_version" "$repo_version" remote-newer)"
up="$(upstream 999.0.0 newer)"
out="$(as_home "$h" node "$PC" --remote "$up" 2>&1)"
assert_contains "$out" "upstream" "--remote adds the upstream copy as its own row"
assert_contains "$out" "999.0.0" "with the version published there"
assert_contains "$out" "A newer Cortex is published" "and says a newer one exists"
assert_exit 1 "--check --remote fails when the running copy is behind upstream" \
  -- as_home "$h" node "$PC" --check --remote "$up"
out="$(as_home "$h" node "$PC" --json --remote "$up" 2>&1)"
assert_contains "$out" '"stage": "upstream"' "--json carries the row"
assert_contains "$out" '"behindUpstream": true' "and the verdict"

up="$(upstream "$repo_version" same)"
out="$(as_home "$h" node "$PC" --remote "$up" 2>&1)"
assert_contains "$out" "the latest published" "the same version upstream reads as current"
assert_exit 0 "and passes --check" -- as_home "$h" node "$PC" --check --remote "$up"

# A checkout ahead of what is published is a release in progress, not a failure. Versions compare as
# numbers: 2.9.0 is older than 2.10.0, which a string comparison gets wrong.
up="$(upstream 0.9.10 older)"
assert_exit 0 "an upstream older than the running copy passes" -- as_home "$h" node "$PC" --check --remote "$up"
h2="$(stage 2.9.0 2.9.0 numeric)"
up="$(upstream 2.10.0 numeric)"
out="$(as_home "$h2" node "$PC" --json --remote "$up" 2>&1)"
assert_contains "$out" '"behindUpstream": true' "2.9.0 is behind 2.10.0"
h2="$(stage 2.10.0 2.10.0 numeric2)"
up="$(upstream 2.9.0 numeric2)"
out="$(as_home "$h2" node "$PC" --json --remote "$up" 2>&1)"
assert_contains "$out" '"behindUpstream": false' "and 2.10.0 is not behind 2.9.0"

# An upstream that cannot be read is not a pass: it is its own exit code, as in the docs check.
out="$(as_home "$h" node "$PC" --remote "$work/no-such-remote.git" 2>&1)"
assert_contains "$out" "could not read upstream" "an unreachable upstream is reported"
assert_exit 2 "and --check --remote exits 2, neither pass nor behind" \
  -- as_home "$h" node "$PC" --check --remote "$work/no-such-remote.git"
up="$(upstream "" noversion)"
assert_exit 2 "an upstream with no VERSION file is unread too" -- as_home "$h" node "$PC" --check --remote "$up"
up="$(upstream "not a version" junk)"
assert_exit 2 "and so is one whose VERSION is not a version" -- as_home "$h" node "$PC" --check --remote "$up"

# Without the flag nothing leaves the machine and nothing changes.
out="$(as_home "$h" node "$PC" 2>&1)"
assert_not_contains "$out" "upstream" "without --remote no upstream row is printed"
out="$(as_home "$h" node "$PC" --json 2>&1)"
assert_not_contains "$out" "behindUpstream" "and --json carries no upstream verdict"

# It still writes nothing: the fetch goes to a temp directory that is removed.
h="$(stage "$repo_version" "$repo_version" remote-ro)"; b="$work/home-remote-ro"
up="$(upstream 999.0.0 ro)"
before="$(find "$b" -type f | sort; git -C "$REPO_ROOT" status --porcelain; git -C "$REPO_ROOT" rev-parse FETCH_HEAD 2>/dev/null)"
as_home "$h" node "$PC" --remote "$up" >/dev/null 2>&1 || true
after="$(find "$b" -type f | sort; git -C "$REPO_ROOT" status --porcelain; git -C "$REPO_ROOT" rev-parse FETCH_HEAD 2>/dev/null)"
assert_eq "$before" "$after" "--remote leaves the registry and this repo as they were"

# The temp directory itself goes too, on a read and on a failed read.
t="$work/tmp-clean"; mkdir -p "$t"
as_home "$h" env TMPDIR="$t" TEMP="$t" TMP="$t" node "$PC" --remote "$up" >/dev/null 2>&1 || true
assert_eq "" "$(ls -A "$t")" "a read upstream leaves no temp directory behind"
as_home "$h" env TMPDIR="$t" TEMP="$t" TMP="$t" node "$PC" --remote "$work/no-such-remote.git" >/dev/null 2>&1 || true
assert_eq "" "$(ls -A "$t")" "and neither does an unreachable one"

rm -rf "$work"
