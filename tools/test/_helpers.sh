#!/usr/bin/env bash
# Assertions for the shell tests. Four of them, deliberately.
#
# A test framework that grows features becomes a dependency by another name, and ADR 0004 says this
# repo has none. If a test needs a fifth helper, it is usually the test that wants simplifying.
#
# Each assertion prints one line and increments a counter. Nothing exits early: a run that stops at
# the first failure tells you about one bug when it could have told you about four.

CORTEX_TEST_PASS=0
CORTEX_TEST_FAIL=0

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
  local got=0
  set +e
  "$@" >/dev/null 2>&1
  got=$?
  set -e
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
