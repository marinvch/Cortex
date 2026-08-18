# tools/server/cortex-cron.sh — run for real against a local bare remote.
#
# No network anywhere in this file. A bare repo on disk is a complete git remote, so push and pull
# are exercised honestly rather than stubbed. The one test that involves the Anthropic API points at
# a closed local port on purpose (see the silent-failure case).

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

# --- BRAIN_DIR / AI_OS_ROOT precedence (regression for the 2026-08-18 fix) ---

setup_brain "$WORK/viaroot"
out="$(AI_OS_ROOT="$WORK/viaroot" bash "$CRON" --daily 2>&1)"
assert_eq "0" "$?" "AI_OS_ROOT is accepted when BRAIN_DIR is unset"
assert_exit 0 "and the digest lands in that directory" -- test -f "$WORK/viaroot/digests/$TODAY.md"

setup_brain "$WORK/wins"
setup_brain "$WORK/loses"
AI_OS_ROOT="$WORK/loses" BRAIN_DIR="$WORK/wins" bash "$CRON" --daily >/dev/null 2>&1
assert_exit 0 "BRAIN_DIR wins when both are set" -- test -f "$WORK/wins/digests/$TODAY.md"
assert_exit 1 "and AI_OS_ROOT is then ignored" -- test -f "$WORK/loses/digests/$TODAY.md"

err="$(env -u BRAIN_DIR -u AI_OS_ROOT bash "$CRON" --daily 2>&1)"
assert_exit 1 "neither set is a hard failure" -- env -u BRAIN_DIR -u AI_OS_ROOT bash "$CRON" --daily
assert_contains "$err" "BRAIN_DIR" "the error names BRAIN_DIR"
assert_contains "$err" "AI_OS_ROOT" "and names AI_OS_ROOT, so either fix is discoverable"

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
