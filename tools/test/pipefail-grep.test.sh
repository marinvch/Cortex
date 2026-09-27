# Under pipefail, nothing pipes into `grep -q` — the pattern behind issue #433.
#
# `grep -q` exits at its first match and closes the pipe. A writer with output still to flush then
# takes SIGPIPE, and with `set -o pipefail` the pipeline reports the writer's 141 instead of grep's
# 0 — so a match that is there reads as absent. Whether the writer had finished first is up to the
# scheduler, which is the worst kind of bug a check can have: destructive-guard.test.sh failed once
# on a loaded CI runner for a file nobody had touched, passed on rerun, and taught the reader to
# rerun instead of read.
#
# Two places carry the risk. Every fragment here runs under the pipefail run.sh sets — invisible
# from inside the fragment, which is why the pattern was written five times without anyone seeing
# it. And any shipped tool that sets pipefail itself. The fix is to capture the input first and hand
# it over with a here-string, `grep -q PAT <<<"$(producer)"`: no pipe, no race.
#
# The pattern string is built by concatenation, so this file does not match itself.

. "$(dirname "${BASH_SOURCE[0]}")/_helpers.sh"   # $WORK or refuse — see the gate there

cd "$REPO_ROOT" || exit 1

PIPE_Q='\|[[:space:]]*grep[[:space:]]+(-[A-Za-z]*q|--quiet)'

offenders_in() { # file -> numbered code lines that pipe into grep -q, or nothing
  local code
  code="$(sed -e 's/^[[:space:]]*#.*$//' "$1")"
  grep -nE "$PIPE_Q" <<<"$code" || true
}

# --- the canary: prove the detector fires before trusting its silence ---------------------------
printf '%s\n' '#!/usr/bin/env bash' 'set -o pipefail' "sed p \"\$1\" |"' grep -q x && echo found' > "$WORK/bad.sh"
assert_contains "$(offenders_in "$WORK/bad.sh")" "grep -q" "the detector finds a pipe into grep -q"
printf '%s\n' '#!/usr/bin/env bash' "# sed p \"\$1\" |"' grep -q x is how not to do it' \
  'grep -q x <<<"$(sed p "$1")"' > "$WORK/good.sh"
assert_eq "" "$(offenders_in "$WORK/good.sh")" "a here-string is not a pipe, and a comment is not code"

# The behaviour itself — a real match reported missing — is pinned where it bit: the long-file
# canary in destructive-guard.test.sh. This file only keeps the pattern from coming back.

# --- the property -------------------------------------------------------------------------------
found=""
scanned=0
for f in tools/test/*.sh tools/*.sh tools/server/*.sh; do
  [ -f "$f" ] || continue
  case "$f" in
    tools/test/*) ;;                                   # run.sh sets pipefail for every fragment
    *) grep -q pipefail "$f" || continue ;;           # a tool without it is not exposed
  esac
  scanned=$((scanned + 1))
  hits="$(offenders_in "$f")"
  [ -n "$hits" ] && found="$found$f
$(printf '%s\n' "$hits" | sed 's/^/      /')
"
done

assert_eq 1 "$([ "$scanned" -ge 10 ] && echo 1 || echo 0)" "the scan reached the fragments and the pipefail tools ($scanned files)"
if [ -z "$found" ]; then
  _pass "nothing under pipefail pipes into grep -q"
else
  _fail "nothing under pipefail pipes into grep -q" \
    "$(printf 'these can report a real match as missing (#433):\n%s' "$found")" \
    "capture the input and pass it as a here-string: grep -q PAT <<<\"\$(producer)\""
fi
