#!/usr/bin/env bash
# Run the shell tests.
#
#   bash tools/test/run.sh              # everything
#   bash tools/test/run.sh cortex-cron  # only matching files
#
# The shell half of Cortex went untested long enough for two real bugs to ship in
# tools/server/cortex-cron.sh and be found by reading rather than by CI. `bash -n` and shellcheck
# catch syntax and obvious misuse; neither runs a script.
#
# Each test file runs in its own subshell with its own temp directory, so one test cannot leak state
# into the next — and every test that touches $HOME must override it (see server-setup.test.sh).
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$HERE/../.." && pwd)"
export REPO_ROOT
FILTER="${1:-}"

total_pass=0
total_fail=0
files_run=0

for f in "$HERE"/*.test.sh; do
  [ -e "$f" ] || continue
  name="$(basename "$f" .test.sh)"
  if [ -n "$FILTER" ]; then
    case "$name" in
      *"$FILTER"*) ;;
      *) continue ;;
    esac
  fi
  files_run=$((files_run + 1))
  printf '%s\n' "$name"

  # A subshell per file: an `exit` or a stray `cd` inside one test must not take the runner with it.
  out="$(
    set +e
    # $WORK before the helpers, not after: _helpers.sh refuses to load without it, which is what
    # makes running a fragment on its own stop instead of building fixtures in the current repo.
    WORK="$(mktemp -d)"
    export WORK
    cd "$WORK" || exit 1
    # shellcheck disable=SC1090
    . "$HERE/_helpers.sh"
    # shellcheck disable=SC1090
    . "$f"
    rm -rf "$WORK"
    printf 'COUNTS %s %s\n' "$CORTEX_TEST_PASS" "$CORTEX_TEST_FAIL"
  )"

  printf '%s\n' "$out" | grep -v '^COUNTS ' || true
  counts="$(printf '%s\n' "$out" | grep '^COUNTS ' | tail -1)"

  # No COUNTS line means the file died before finishing — a stray `exit`, a `set -u` on an unset
  # variable, a syntax error. Without this branch the run reported "0 passed, 0 failed" and exited
  # 0, so a suite that crashed looked exactly like a suite that passed. That is the worst failure
  # mode a test runner can have, and it is the one it shipped with.
  if [ -z "$counts" ]; then
    printf '  FAIL  <file did not finish — it exited early or crashed>\n'
    total_fail=$((total_fail + 1))
    continue
  fi

  total_pass=$((total_pass + $(printf '%s' "$counts" | awk '{print $2+0}')))
  total_fail=$((total_fail + $(printf '%s' "$counts" | awk '{print $3+0}')))
done

echo
if [ "$files_run" -eq 0 ]; then
  echo "no test files matched${FILTER:+ '$FILTER'}"
  exit 0
fi

echo "shell tests: $total_pass passed, $total_fail failed (across $files_run file(s))"
[ "$total_fail" -eq 0 ] || exit 1
