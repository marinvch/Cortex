#!/usr/bin/env bash
# The runner gate, then four assertions. Deliberately four.
#
# A test framework that grows features becomes a dependency by another name, and ADR 0004 says this
# repo has none. If a test needs a fifth helper, it is usually the test that wants simplifying.
#
# Each assertion prints one line and increments a counter. Nothing exits early: a run that stops at
# the first failure tells you about one bug when it could have told you about four.

# --- the gate ----------------------------------------------------------------
#
# A *.test.sh file here is a FRAGMENT that run.sh sources, not a script you run. The runner makes a
# fresh temp dir, exports $WORK and $REPO_ROOT, and cds into $WORK; every fixture builds under
# $WORK from there. Run a fragment on its own and both are empty — `cd "$WORK/proj"` becomes
# `cd ""`, which fails, does not stop the script, and leaves the `git init`, the `> README.md` and
# the `git add -A && git commit` after it running in whatever directory you were standing in.
#
# That is not hypothetical. On 2026-09-05 an agent ran `bash tools/test/cortex-view.test.sh`
# directly from the repo root — the exact form the leaf briefs print — and the fixture rewrote the
# git identity, overwrote README.md with `# readme`, overwrote package.json and committed twice on
# master. Nothing failed; the damage was the test passing.
#
# So every fragment sources this file as its first line of code, and this is where the run stops.
if [ -z "${WORK:-}" ] || [ -z "${REPO_ROOT:-}" ] || [ ! -d "${WORK:-}" ]; then
  _frag="$(basename "${BASH_SOURCE[1]:-}" .test.sh 2>/dev/null)"
  {
    printf 'tools/test: refusing to run — $WORK and $REPO_ROOT come from tools/test/run.sh.\n'
    printf 'A *.test.sh file is a fragment the runner sources, not a script. Run alone, its\n'
    printf 'fixtures build in the current directory and commit to the repository you are in.\n'
    printf '\n  bash tools/test/run.sh %s\n' "$_frag"
  } >&2
  exit 1
fi

# --- assertions --------------------------------------------------------------
#
# Idempotent, because a fragment re-sources this file after run.sh already did. Resetting here
# would zero the counters of a fragment that sourced it twice.
CORTEX_TEST_PASS=${CORTEX_TEST_PASS:-0}
CORTEX_TEST_FAIL=${CORTEX_TEST_FAIL:-0}

_pass() { CORTEX_TEST_PASS=$((CORTEX_TEST_PASS + 1)); printf '  ok    %s\n' "$1"; }
_fail() {
  CORTEX_TEST_FAIL=$((CORTEX_TEST_FAIL + 1))
  printf '  FAIL  %s\n' "$1"
  shift
  for line in "$@"; do printf '          %s\n' "$line"; done
}

assert_eq() { # expected actual message
  if [ "$1" = "$2" ]; then _pass "$3"; else _fail "$3" "expected: $1" "actual:   $2"; fi
}

assert_contains() { # haystack needle message
  case "$1" in
    *"$2"*) _pass "$3" ;;
    *) _fail "$3" "expected to contain: $2" "actual: $(printf '%s' "$1" | head -c 300)" ;;
  esac
}

assert_not_contains() { # haystack needle message
  case "$1" in
    *"$2"*) _fail "$3" "expected NOT to contain: $2" ;;
    *) _pass "$3" ;;
  esac
}

# assert_exit <code> "message" -- command...
# Runs the command with errexit disabled so a non-zero status is data rather than an abort.
assert_exit() {
  local want="$1" msg="$2"
  shift 2
  [ "$1" = "--" ] && shift

  # Save and RESTORE errexit rather than forcing it back on. An earlier version ended with a bare
  # `set -e`, which switched on a mode the runner had deliberately switched off — so the first
  # non-zero command after any assert_exit killed the whole test file, and the run reported it as a
  # crash rather than as the passing assertions it had already made.
  local errexit_was_on=0
  case "$-" in *e*) errexit_was_on=1 ;; esac

  local got=0
  set +e
  "$@" >/dev/null 2>&1
  got=$?
  [ "$errexit_was_on" -eq 1 ] && set -e

  assert_eq "$want" "$got" "$msg"
}

# A real git repo with an identity. CI runners have no global git identity, and without this a
# commit fails for a reason that has nothing to do with what is being tested.
mkrepo() { # dir
  mkdir -p "$1"
  git -C "$1" init -q
  git -C "$1" config user.email "test@cortex.local"
  git -C "$1" config user.name "Cortex Test"
  git -C "$1" commit -q --allow-empty -m "init"
}
