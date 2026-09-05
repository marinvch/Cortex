# This repository is public. Nothing in it names a private project.
#
# Cortex is developed by testing it against real repositories, which is the only way to know the
# product works rather than the parts. The cost is a standing temptation to write down what was
# learned in the terms it was learned in — "verified on <repo>: 160 files, one critical secrets
# finding". That sentence is a changelog entry and a disclosure at the same time: it ties a named
# account to a private codebase and says something about its security posture.
#
# The rule is: describe the SHAPE, never the SUBJECT. A fixture named acme-app carries every bit of
# the engineering meaning and none of the disclosure.
#
# THE FIRST VERSION OF THIS FILE WAS A DENYLIST, AND IT FAILED CI ON ITS OWN CONTENT.
# It held `PRIVATE_NAMES='<a real repo name>|...'` and then grepped the tree for those names, so it
# matched itself. That is not a bug in the regex — it is the instrument being wrong. A denylist of
# private names has to be published to work, which is the very disclosure it exists to prevent. It
# passed locally only because the file was still untracked when it ran, so `git grep` could not see
# it; committing is what made it true.
#
# So the check is structural instead, and asserts the SEAM rather than a list of names: a real-repo
# path arrives at runtime through CORTEX_E2E_REPO and is therefore never committable. A denylist can
# still run locally, from a gitignored file that CI does not have — see the last block.

. "$(dirname "${BASH_SOURCE[0]}")/_helpers.sh"   # $WORK or refuse — see the gate there

cd "$REPO_ROOT" || exit 1

# --- the seam: no tracked file carries an absolute path into somebody's checkout ------------------

# Matches an absolute path that walks into a named checkout: /home/x/proj, /Users/x/proj,
# /d/Projects/x, D:/Projects/x, D:\Projects\x.
#
# Excluded, each for a reason rather than to make the check pass:
#   CHANGELOG.md, docs/superpowers, docs/history — history, accurate as written.
#   */test/* — synthetic paths are what a path-parsing test is FOR (mcp/test/mode.test.js asserts
#     detectMode("/home/me/vault")). The one test that touches a REAL repo is asserted below.
#   path/to, /tmp/, example, placeholder — documentation teaching the seam.
paths="$(git grep -nIE '(^|[^a-zA-Z0-9_])((/home/|/Users/|/[a-z]/)[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+|[A-Za-z]:[\\/]+[A-Za-z0-9_.-]+[\\/]+[A-Za-z0-9_.-]+)' \
  -- . ':!CHANGELOG.md' ':!docs/superpowers' ':!docs/history' ':!*/test/*' \
  | grep -viE 'path/to|/tmp/|Temp|example|placeholder|node_modules|/usr/|/bin/|/dev/' || true)"

if [ -z "$paths" ]; then
  _pass "no tracked file hardcodes an absolute path into a checkout"
else
  _fail "no tracked file hardcodes an absolute path into a checkout" "$paths"
fi

# The real-repo pass must read its target from the environment. If a test ever inlines one, the seam
# has been routed around and the next person to test against their own repo commits its path.
if grep -q 'CORTEX_E2E_REPO' tools/test/install-on-a-project.test.sh; then
  _pass "the real-repo pass takes its target from CORTEX_E2E_REPO, not from the tree"
else
  _fail "the real-repo pass takes its target from CORTEX_E2E_REPO, not from the tree"
fi

# The fixture is built, not borrowed. A test that names a repo on disk runs on exactly one machine
# and leaks which machine that is.
if grep -q 'acme-app' tools/test/install-on-a-project.test.sh; then
  _pass "the default fixture is one this repo builds itself"
else
  _fail "the default fixture is one this repo builds itself"
fi

# --- optional local denylist, deliberately not committed ------------------------------------------
#
# Put your own project names in tools/test/private-names.local (gitignored, one extended-regex
# alternation per line). It never ships, so naming them there is not the disclosure that naming them
# in a tracked file would be. Absent — as it is in CI — this block skips.

LOCAL_LIST="$REPO_ROOT/tools/test/private-names.local"
if [ -f "$LOCAL_LIST" ]; then
  pat="$(grep -vE '^[[:space:]]*(#|$)' "$LOCAL_LIST" | paste -sd'|' -)"
  if [ -n "$pat" ]; then
    hits="$(git grep -inE "$pat" -- . || true)"
    if [ -z "$hits" ]; then
      _pass "no tracked file matches your local private-name list"
    else
      _fail "no tracked file matches your local private-name list" "$hits"
    fi
  fi
else
  printf '  skip  local private-name denylist (create tools/test/private-names.local to enable)\n'
fi
