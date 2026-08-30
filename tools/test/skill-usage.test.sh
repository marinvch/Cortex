# A skill's most common defect is invisible in its own file: correct, wired in, never reached.
#
# This is the only tool in Cortex that reads the session record rather than the repo, so two things
# get asserted that no other test here has to. First, that the two counts stay SEPARATE — a typed
# slash command and a model-chosen Skill call diagnose different problems, and collapsing them loses
# the diagnosis. Second, that it extracts names and nothing else: the directory it reads holds
# everything the user has ever typed, and a tool that leaked a prompt into a report would be a
# privacy failure nobody would notice until it was quoted back at them.
#
# CORTEX_SESSIONS_DIR exists for this test. Without it every case would read the developer's real
# transcripts, which is both a privacy problem and a test that passes for reasons nobody controls.

USAGE="$REPO_ROOT/tools/cortex-skill-usage.mjs"

work="$(mktemp -d)"
sess="$work/projects"
mkdir -p "$sess/proj-alpha" "$sess/proj-beta"

# A transcript line is one JSON object per line. These are the two shapes that count, plus prompt
# text that must never surface in any output.
SECRET="the-users-private-prompt-text-that-must-never-be-printed"

cat > "$sess/proj-alpha/a.jsonl" <<JSONL
{"type":"user","timestamp":"2026-08-01T10:00:00Z","message":{"role":"user","content":"<command-name>/cortex-install</command-name><command-args>x</command-args>"}}
{"type":"user","timestamp":"2026-08-01T10:01:00Z","message":{"role":"user","content":"$SECRET"}}
{"type":"assistant","timestamp":"2026-08-01T10:02:00Z","message":{"content":[{"type":"tool_use","name":"Skill","input":{"skill":"cortex:dream"}}]}}
JSONL

cat > "$sess/proj-beta/b.jsonl" <<JSONL
{"type":"user","timestamp":"2026-08-02T10:00:00Z","message":{"role":"user","content":"<command-name>/cortex:cortex-install</command-name>"}}
{"type":"assistant","timestamp":"2026-08-02T10:01:00Z","message":{"content":[{"type":"tool_use","name":"Read","input":{"file_path":"$SECRET"}}]}}
JSONL

out="$(CORTEX_SESSIONS_DIR="$sess" node "$USAGE" 2>&1)"

# --- privacy ------------------------------------------------------------------------------------------
#
# First, because everything else is worthless if this fails.
assert_not_contains "$out" "$SECRET" "no prompt text reaches the report"
json="$(CORTEX_SESSIONS_DIR="$sess" node "$USAGE" --json 2>&1)"
assert_not_contains "$json" "$SECRET" "nor the json, which is the shape a ritual would paste onward"

# --- counting -----------------------------------------------------------------------------------------

assert_contains "$out" "2 sessions across 2 projects" "it says how much history it actually read"

# `/cortex-install` and `/cortex:cortex-install` are ONE ritual used twice. Counting the plugin
# prefix as a separate skill would report a used ritual as two unused ones.
line="$(printf '%s' "$out" | grep -E '^\s*/cortex-install\b')"
case "$line" in
  *" 2 "*) _pass "the plugin-prefixed and bare forms count as one ritual" ;;
  *) _fail "the plugin-prefixed and bare forms count as one ritual" "got: $line" ;;
esac

# The gap between the columns IS the diagnosis, so they must not be summed away.
assert_contains "$json" '"typed": 2' "typed invocations are counted separately"
assert_contains "$json" '"auto": 0' "from model-chosen ones"

# /dream was reached only by the model choosing it — the shape that says a slash command is decoration.
assert_contains "$json" '"verdict": "auto-only"' "a skill reached only automatically is labelled as such"

# --- never reached --------------------------------------------------------------------------------------

unused="$(CORTEX_SESSIONS_DIR="$sess" node "$USAGE" --unused 2>&1)"
assert_contains "$unused" "/handoff" "a shipped skill absent from the record is reported as never reached"
assert_not_contains "$unused" "/cortex-install" "and one that was used is not"

# The nuance that keeps this from doing damage. Auto-firing a deliberate act is a defect, not a fix,
# so the tool must say so where someone reading only this output would act.
assert_contains "$unused" "deliberate" \
  "and the list warns that some skills SHOULD be zero — /dream and /handoff are decisions"

# --- a tool_use that is not a Skill call must not count ------------------------------------------------------
# proj-beta has a Read call. If any tool_use counted, the totals would silently inflate and every
# skill would look healthier than it is.
count="$(printf '%s' "$json" | grep -c '"name": "Read"' || true)"
assert_eq "0" "$count" "a non-Skill tool call is not counted as usage"

# --- an empty or missing history says so rather than reporting zeros --------------------------------------
#
# Reporting "0 uses" for a directory that does not exist would mark every skill dead on a fresh
# machine — a confident wrong answer, which is the failure mode this repo keeps designing against.
assert_exit 2 "a missing session directory fails loudly instead of reporting everything unused" \
  -- env CORTEX_SESSIONS_DIR="$work/nope" node "$USAGE"

# --- it writes nothing -------------------------------------------------------------------------------------
before="$(find "$sess" -type f -exec md5sum {} \; | sort)"
CORTEX_SESSIONS_DIR="$sess" node "$USAGE" >/dev/null 2>&1
after="$(find "$sess" -type f -exec md5sum {} \; | sort)"
assert_eq "$before" "$after" "reading the session record leaves it byte-identical"

rm -rf "$work"
