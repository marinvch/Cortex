# This repository is public. Nothing in it names a private project.
#
# Cortex is developed by testing it against real repositories, which is the only way to know the
# product works rather than the parts. The cost of that is a standing temptation to write down what
# was learned in the terms it was learned in — "verified on <repo>: 160 files, one critical secrets
# finding". That sentence is a changelog entry and a disclosure at the same time: it ties a named
# account to a private codebase and says something about its security posture.
#
# The rule is simple and this file is what keeps it: describe the SHAPE, never the SUBJECT. A
# fixture named acme-app carries every bit of the engineering meaning and none of the disclosure.
#
# When you test against a real repo, put its name nowhere: not in a commit message, not in the
# changelog, not in a PR body. The CORTEX_E2E_REPO mode exists so the path is supplied at runtime
# and never committed.

cd "$REPO_ROOT" || exit 1

# Add a repo here only to make the check fail for it — this list is the thing being forbidden.
PRIVATE_NAMES='ai_saas|ai-saas|nextjs-task-app'

hits="$(git grep -inE "$PRIVATE_NAMES" -- . || true)"
if [ -z "$hits" ]; then
  _pass "no tracked file names a private project"
else
  _fail "no tracked file names a private project" "$hits"
fi

# The env var is the seam: a path supplied at runtime cannot be committed by accident. If a test
# ever hardcodes one instead, this rule has been routed around rather than followed.
hard="$(git grep -nE '^[^#]*(/d/|D:/|/home/|/Users/)[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+' -- tools/test || true)"
if [ -z "$hard" ]; then
  _pass "no test hardcodes an absolute path to somebody's repo"
else
  _fail "no test hardcodes an absolute path to somebody's repo" "$hard"
fi
