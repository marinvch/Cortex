# ANTHROPIC_API_KEY is set to "test-key-not-real" here so the failure path has a key shaped like
# one. It reaches a closed local port on purpose and authenticates nothing. It carries no
# secrets-exemption marker: the value reads as a placeholder so the scan finds nothing, and a
# blanket exemption over a clean file has no hits to surface it for the periodic re-read.

# tools/server/cortex-cron.sh — run for real against a local bare remote.
#
# No network anywhere in this file. A bare repo on disk is a complete git remote, so push and pull
# are exercised honestly rather than stubbed. The one test that involves the Anthropic API points at
# a closed local port on purpose (see the silent-failure case).

. "$(dirname "${BASH_SOURCE[0]}")/_helpers.sh"   # $WORK or refuse — see the gate there

CRON="$REPO_ROOT/tools/server/cortex-cron.sh"
TODAY="$(date +%F)"

# A brain clone with a real upstream, plus a note committed far enough back to be "since" anything.
setup_brain() { # dir
  local dir="$1" bare="$1.git"
  git init -q --bare "$bare"
  mkrepo "$dir"
  git -C "$dir" remote add origin "$bare"
  mkdir -p "$dir/notes"
  printf '# a note\n\nSomething was decided today.\n' > "$dir/notes/decision.md"
  git -C "$dir" add -A
  git -C "$dir" commit -q -m "add a note"
  # Push the current branch under its own name. Pushing to a hardcoded `main` while the local branch
  # is `master` sets a mismatched upstream, and cortex-cron.sh's bare `git push` then aborts with
  # "the upstream branch of your current branch does not match" — a failure of the fixture, not of
  # the thing under test. Git's default branch name varies by version and config; never assume it.
  local br
  br="$(git -C "$dir" symbolic-ref --short HEAD)"
  git -C "$dir" push -q -u origin "$br"
}

# --- the daily path ---

setup_brain "$WORK/daily"
out="$(BRAIN_DIR="$WORK/daily" bash "$CRON" --daily 2>&1)"
assert_eq "0" "$?" "daily run exits 0"
assert_contains "$out" "pushed" "daily run reports the push"
digest="$WORK/daily/digests/$TODAY.md"
assert_exit 0 "daily writes digests/<today>.md" -- test -f "$digest"
body="$(cat "$digest" 2>/dev/null || true)"
assert_contains "$body" "type: digest" "frontmatter names the report type"
assert_contains "$body" "## Files changed" "the deterministic section is always present"
assert_contains "$body" "notes/decision.md" "the changed note is listed"

# The commit must actually reach the remote — a cron that commits locally and never pushes looks
# identical to a working one from inside the clone.
remote_log="$(git -C "$WORK/daily.git" log --oneline 2>/dev/null || true)"
assert_contains "$remote_log" "cron:" "the digest commit reached the bare remote"

# --- the weekly path ---

setup_brain "$WORK/weekly"
BRAIN_DIR="$WORK/weekly" bash "$CRON" --weekly >/dev/null 2>&1
audit="$WORK/weekly/audits/$TODAY.md"
assert_exit 0 "weekly writes audits/<today>.md" -- test -f "$audit"
assert_contains "$(cat "$audit" 2>/dev/null || true)" "type: audit" "weekly frontmatter says audit"

# --- a quiet day ---

setup_brain "$WORK/quiet"
BRAIN_DIR="$WORK/quiet" bash "$CRON" --daily >/dev/null 2>&1   # first run writes the digest
out="$(BRAIN_DIR="$WORK/quiet" bash "$CRON" --daily 2>&1)"
code=$?
# A cron that exits non-zero on a quiet day trains its operator to ignore it, and then to ignore it
# on the day it matters.
assert_eq "0" "$code" "a second run on the same day still exits 0"
assert_contains "$out" "no changes to commit" "and says why"

# --- BRAIN_DIR / CORTEX_ROOT / AI_OS_ROOT precedence ---
#
# BRAIN_DIR falling back to the root is the 2026-08-18 fix. The root having two names is #552:
# CORTEX_ROOT, and AI_OS_ROOT for a host set up before it. Every run below sets or clears all
# three, so a variable in the shell running the suite cannot pick the clone.
CLEAR="-u BRAIN_DIR -u CORTEX_ROOT -u AI_OS_ROOT"

setup_brain "$WORK/viaroot"
# shellcheck disable=SC2086
out="$(env $CLEAR AI_OS_ROOT="$WORK/viaroot" bash "$CRON" --daily 2>&1)"
assert_eq "0" "$?" "AI_OS_ROOT is still accepted when BRAIN_DIR is unset"
assert_exit 0 "and the digest lands in that directory" -- test -f "$WORK/viaroot/digests/$TODAY.md"
assert_not_contains "$out" "AI_OS_ROOT" "with no warning about the older name"

setup_brain "$WORK/vianew"
# shellcheck disable=SC2086
out="$(env $CLEAR CORTEX_ROOT="$WORK/vianew" bash "$CRON" --daily 2>&1)"
assert_eq "0" "$?" "CORTEX_ROOT is accepted when BRAIN_DIR is unset"
assert_exit 0 "and the digest lands in that directory" -- test -f "$WORK/vianew/digests/$TODAY.md"

setup_brain "$WORK/newwins"
setup_brain "$WORK/oldloses"
# shellcheck disable=SC2086
out="$(env $CLEAR CORTEX_ROOT="$WORK/newwins" AI_OS_ROOT="$WORK/oldloses" bash "$CRON" --daily 2>&1)"
assert_exit 0 "CORTEX_ROOT wins over a different AI_OS_ROOT" -- test -f "$WORK/newwins/digests/$TODAY.md"
assert_exit 1 "and the AI_OS_ROOT clone is left alone" -- test -f "$WORK/oldloses/digests/$TODAY.md"
assert_eq "1" "$(printf '%s\n' "$out" | grep -c 'are both set and differ')" "and one line says the two differ"
assert_contains "$out" "cortex: CORTEX_ROOT and AI_OS_ROOT" "with the cortex: prefix"

setup_brain "$WORK/sameroot"
# shellcheck disable=SC2086
out="$(env $CLEAR CORTEX_ROOT="$WORK/sameroot" AI_OS_ROOT="$WORK/sameroot" bash "$CRON" --daily 2>&1)"
assert_exit 0 "both names on one path is that path" -- test -f "$WORK/sameroot/digests/$TODAY.md"
assert_not_contains "$out" "differ" "and nothing is reported"

setup_brain "$WORK/emptynew"
# shellcheck disable=SC2086
env $CLEAR CORTEX_ROOT="" AI_OS_ROOT="$WORK/emptynew" bash "$CRON" --daily >/dev/null 2>&1
assert_exit 0 "an empty CORTEX_ROOT does not shadow AI_OS_ROOT" -- test -f "$WORK/emptynew/digests/$TODAY.md"

setup_brain "$WORK/wins"
setup_brain "$WORK/loses"
setup_brain "$WORK/loses2"
# shellcheck disable=SC2086
out="$(env $CLEAR AI_OS_ROOT="$WORK/loses" CORTEX_ROOT="$WORK/loses2" BRAIN_DIR="$WORK/wins" bash "$CRON" --daily 2>&1)"
assert_exit 0 "BRAIN_DIR wins when all three are set" -- test -f "$WORK/wins/digests/$TODAY.md"
assert_exit 1 "and AI_OS_ROOT is then ignored" -- test -f "$WORK/loses/digests/$TODAY.md"
assert_exit 1 "and so is CORTEX_ROOT" -- test -f "$WORK/loses2/digests/$TODAY.md"
assert_not_contains "$out" "differ" "and a crontab that names BRAIN_DIR hears nothing about the other two"

# shellcheck disable=SC2086
err="$(env $CLEAR bash "$CRON" --daily 2>&1)"
# shellcheck disable=SC2086
assert_exit 1 "none set is a hard failure" -- env $CLEAR bash "$CRON" --daily
assert_contains "$err" "BRAIN_DIR" "the error names BRAIN_DIR"
assert_contains "$err" "CORTEX_ROOT" "and CORTEX_ROOT"
assert_contains "$err" "AI_OS_ROOT" "and AI_OS_ROOT, so any of the three fixes is discoverable"

# shellcheck disable=SC2086
assert_exit 1 "three empty strings are none set" -- env $CLEAR BRAIN_DIR="" CORTEX_ROOT="" AI_OS_ROOT="" bash "$CRON" --daily

# A root that is set and not there stops the run, under either name: nothing is written anywhere
# else, and the other name's clone is not tried instead.
setup_brain "$WORK/bystander"
for name in CORTEX_ROOT AI_OS_ROOT; do
  # shellcheck disable=SC2086
  assert_exit 1 "a $name that does not exist fails the run" -- env $CLEAR "$name=$WORK/no-such-clone" bash "$CRON" --daily
done
# shellcheck disable=SC2086
assert_exit 1 "a missing CORTEX_ROOT is not rescued by a good AI_OS_ROOT" -- \
  env $CLEAR CORTEX_ROOT="$WORK/no-such-clone" AI_OS_ROOT="$WORK/bystander" bash "$CRON" --daily
assert_exit 1 "and the AI_OS_ROOT clone was not written to" -- test -f "$WORK/bystander/digests/$TODAY.md"

# --- the silent AI failure (the bug behind the stale model id) ---
#
# A bad key, a dead model id or an unreachable network all produce a digest with no summary, exit 0,
# and no warning. The deterministic fallback is the design working as intended; the SILENCE is the
# defect. A cron that appears to work while half of it is dead is worse than one that fails.
#
# Points at a closed local port, so this is a real failure of a real curl with no network involved.

setup_brain "$WORK/aifail"
out="$(BRAIN_DIR="$WORK/aifail" ANTHROPIC_API_KEY="test-key-not-real" \
       CORTEX_API_URL="http://127.0.0.1:9/v1/messages" bash "$CRON" --daily 2>&1)"
code=$?

assert_eq "0" "$code" "a failed summary must NOT fail the cron run"
assert_exit 0 "the deterministic digest is still written" -- test -f "$WORK/aifail/digests/$TODAY.md"
assert_contains "$(cat "$WORK/aifail/digests/$TODAY.md" 2>/dev/null || true)" "## Files changed" \
  "and still carries the change list"
assert_contains "$out" "summary unavailable" "the failure is reported instead of swallowed"

# With no key at all there is nothing to warn about — silence is correct here.
setup_brain "$WORK/nokey"
out="$(env -u ANTHROPIC_API_KEY BRAIN_DIR="$WORK/nokey" bash "$CRON" --daily 2>&1)"
assert_not_contains "$out" "summary unavailable" "no key means no warning; that is the boring path"

# --- reading the response the way the model now sends it (core/claude-code.js model.* rules) ---
#
# A model that always thinks may put a `thinking` block first, so `.content[0].text` reads nothing
# and the summary disappears — silently, since the deterministic digest still gets written
# (model.response.read-by-block-type). Thinking also counts toward max_tokens, so 800 could cut the
# reply off before any text (model.thinking.counts-toward-max-tokens). A refusal and a cut-off reply
# are failed summaries and must be said out loud (model.response.refusal-stop-reason).
#
# A stub curl first on PATH serves a canned response and records the request body. No network.

mkdir -p "$WORK/fakebin"
cat > "$WORK/fakebin/curl" <<'STUB'
#!/usr/bin/env bash
body="" prev=""
for a in "$@"; do [ "$prev" = "-d" ] && body="$a"; prev="$a"; done
printf '%s' "$body" > "${FAKE_CURL_BODY:?}"
cat "${FAKE_CURL_RESPONSE:?}"
STUB
chmod +x "$WORK/fakebin/curl"

# canned <name> <response-json> — run the daily cron against that response; sets $out and $digest.
canned() {
  local name="$1"
  setup_brain "$WORK/$name"
  printf '%s' "$2" > "$WORK/$name.response.json"
  out="$(PATH="$WORK/fakebin:$PATH" FAKE_CURL_RESPONSE="$WORK/$name.response.json" \
         FAKE_CURL_BODY="$WORK/$name.body.json" BRAIN_DIR="$WORK/$name" \
         ANTHROPIC_API_KEY="test-key-not-real" bash "$CRON" --daily 2>&1)"
  digest="$(cat "$WORK/$name/digests/$TODAY.md" 2>/dev/null || true)"
}

canned thinkfirst '{"content":[{"type":"thinking","thinking":""},{"type":"text","text":"Three notes captured about the release."}],"stop_reason":"end_turn"}'
assert_contains "$digest" "Three notes captured about the release." \
  "a response that opens with a thinking block still yields the summary"
assert_not_contains "$out" "summary unavailable" "and nothing is reported missing"
assert_contains "$(tr -d ' \n\r' < "$WORK/thinkfirst.body.json" 2>/dev/null || true)" '"max_tokens":16000' \
  "the request leaves room for thinking: max_tokens is 16000, not 800"

canned textonly '{"content":[{"type":"text","text":"A plain reply still works."}],"stop_reason":"end_turn"}'
assert_contains "$digest" "A plain reply still works." "a text-only response is read as before"

canned refused '{"content":[],"stop_reason":"refusal","stop_details":{"category":"reasoning_extraction"}}'
assert_contains "$out" "stop_reason: refusal" "a refusal is named on stderr"
assert_contains "$out" "reasoning_extraction" "with the category the response gave"
assert_contains "$digest" "## Files changed" "and the deterministic digest is still written"

canned cutoff '{"content":[{"type":"thinking","thinking":""},{"type":"text","text":"Half a sen"}],"stop_reason":"max_tokens"}'
assert_contains "$out" "stop_reason: max_tokens" "a reply cut off at max_tokens is named on stderr"
assert_not_contains "$digest" "Half a sen" "and its truncated text is not published as the summary"
