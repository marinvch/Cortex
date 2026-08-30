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

rm -rf "$work"
