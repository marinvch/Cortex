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
#   whatever .cortex/local-paths declares — see below. Upstream never ships that file, so on the
#     public repo this line of the list is empty and the check is exactly the one above it.
#
# --- .cortex/local-paths: a folder that is local to one install by design --------------------------
#
# A personal clone may carry a machine's own operational code — cron tables, watchdog scripts, a
# snapshot of one server — where an absolute path is the point, not a leak: the script runs as root
# and as the user, and $HOME differs between them. That folder never goes upstream. Without a
# supported exemption the clone's only choices were a permanently red suite (which hides every OTHER
# new failure) or a local edit to the pathspec above, which conflicts every time the line changes.
#
# So an install declares those folders in .cortex/local-paths, one repo-relative path per line (`#`
# comments and blank lines ignored). Each is appended as ':!<path>' and PRINTED on every run, so a
# skipped folder is visible rather than silent. The file is deliberately caught by this repo's
# `.cortex/` ignore rule: that rule is what stops upstream shipping one by accident on a plain
# `git add -A`. A clone that wants its CI to see the declaration commits it once with
# `git add -f .cortex/local-paths`; a tracked file is no longer subject to the ignore rule.
#
# An exemption is a weakening, so it is held to rules rather than trusted. A line FAILS the suite —
# it is not skipped quietly — when it:
#   - names the whole repo or climbs out of it: empty, `.`, `/`, an absolute path, any `.`/`..`/empty
#     segment. Written as `x`, never `./x`, so there is one spelling to read.
#   - is anything but a literal path — `*`, `?`, `[`, `:` pathspec magic, spaces, backslashes. A
#     glob exempts what it matches, not what it names, and `*` matches everything.
#   - covers no tracked file. An exemption with nothing to exempt is a blanket permission nobody
#     re-reads — the rule dormant-exemptions.test.sh applies to the secrets marker.

LOCAL_PATHS_FILE=".cortex/local-paths"

# _local_path_exemptions <root> — reads <root>/.cortex/local-paths and sets globals rather than
# printing, so it can be called without a subshell: LP_EXCLUDE (array of ':!<path>'), and LP_APPLIED,
# LP_REJECTED, LP_DORMANT (newline lists for the report).
_local_path_exemptions() {
  local root="$1" raw p reason
  LP_EXCLUDE=()
  LP_APPLIED=""
  LP_REJECTED=""
  LP_DORMANT=""
  [ -f "$root/$LOCAL_PATHS_FILE" ] || return 0
  while IFS= read -r raw || [ -n "$raw" ]; do
    p="${raw%$'\r'}"
    p="$(printf '%s' "$p" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
    case "$p" in '#'*) continue ;; esac
    [ -z "$p" ] && continue
    reason=""
    case "$p" in
      '' | . | ./ | / ) reason="names the whole repository" ;;
      /* | [A-Za-z]:*) reason="is absolute; write it relative to the repo root" ;;
      *[!A-Za-z0-9._/-]*) reason="is not a literal path (globs and pathspec magic exempt what they match, not what they name)" ;;
    esac
    if [ -z "$reason" ]; then
      p="${p%/}"
      case "/$p/" in
        *//* | */./* | */../*) reason="has an empty, '.' or '..' segment" ;;
      esac
    fi
    if [ -n "$reason" ]; then
      LP_REJECTED="$LP_REJECTED$raw — $reason
"
      continue
    fi
    if [ -z "$(git -C "$root" ls-files -- "$p" | head -n 1)" ]; then
      LP_DORMANT="$LP_DORMANT$p
"
      continue
    fi
    LP_EXCLUDE+=(":!$p")
    LP_APPLIED="$LP_APPLIED$p
"
  done < "$root/$LOCAL_PATHS_FILE"
}

# _abs_path_hits <root> — sets ABS_HITS to every offending line under <root>, after the exemptions.
_abs_path_hits() {
  _local_path_exemptions "$1"
  ABS_HITS="$(git -C "$1" grep -nIE '(^|[^a-zA-Z0-9_])((/home/|/Users/|/[a-z]/)[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+|[A-Za-z]:[\\/]+[A-Za-z0-9_.-]+[\\/]+[A-Za-z0-9_.-]+)' \
    -- . ':!CHANGELOG.md' ':!docs/superpowers' ':!docs/history' ':!*/test/*' ${LP_EXCLUDE[@]+"${LP_EXCLUDE[@]}"} \
    | grep -viE 'path/to|/tmp/|Temp|example|placeholder|node_modules|/usr/|/bin/|/dev/' || true)"
}

_abs_path_hits "$REPO_ROOT"

printf '%s' "$LP_APPLIED" | while IFS= read -r p; do
  [ -n "$p" ] && printf '  note  %s exempts %s from the absolute-path check\n' "$LOCAL_PATHS_FILE" "$p"
done

if [ -z "$ABS_HITS" ]; then
  _pass "no tracked file hardcodes an absolute path into a checkout"
else
  _fail "no tracked file hardcodes an absolute path into a checkout" "$ABS_HITS"
fi

if [ -f "$REPO_ROOT/$LOCAL_PATHS_FILE" ]; then
  if [ -z "$LP_REJECTED" ]; then
    _pass "every $LOCAL_PATHS_FILE line is a literal path inside the repo"
  else
    _fail "every $LOCAL_PATHS_FILE line is a literal path inside the repo" "${LP_REJECTED%$'\n'}"
  fi
  if [ -z "$LP_DORMANT" ]; then
    _pass "every $LOCAL_PATHS_FILE exemption covers a tracked file"
  else
    _fail "every $LOCAL_PATHS_FILE exemption covers a tracked file — delete the dead line" "${LP_DORMANT%$'\n'}"
  fi
fi

# Upstream never ships the declaration, and the ignore rule is what makes that a default rather than
# a hope. --no-index so a clone that force-added its own copy still sees the rule, not the index.
if git -C "$REPO_ROOT" check-ignore -q --no-index "$LOCAL_PATHS_FILE"; then
  _pass "$LOCAL_PATHS_FILE is ignored by default, so a plain 'git add -A' cannot ship one upstream"
else
  _fail "$LOCAL_PATHS_FILE is ignored by default, so a plain 'git add -A' cannot ship one upstream"
fi

# --- the exemption mechanism, against a fixture -----------------------------------------------------

LP="$WORK/local-paths"
mkrepo "$LP"
mkdir -p "$LP/homelab/cron" "$LP/src"
printf 'CFG=/home/alice/.config/watchdog\n' > "$LP/homelab/cron/watchdog.sh"
printf 'const p = "/home/bob/proj/leak";\n' > "$LP/src/app.js"
git -C "$LP" add -A
git -C "$LP" commit -q -m fixture

_abs_path_hits "$LP"
assert_contains "$ABS_HITS" "homelab/cron/watchdog.sh" "local-paths: with no declaration, a local folder's absolute path is caught"
assert_eq "0" "${#LP_EXCLUDE[@]}" "local-paths: with no declaration, nothing is exempted"

mkdir -p "$LP/.cortex"
printf '# the machine-local folder\n\nhomelab/\r\n' > "$LP/.cortex/local-paths"
_abs_path_hits "$LP"
assert_not_contains "$ABS_HITS" "homelab/" "local-paths: a declared folder is exempted (comments, blanks, CRLF and a trailing slash tolerated)"
assert_contains "$ABS_HITS" "src/app.js" "local-paths: the exemption covers only the folder it names"
assert_eq "homelab" "$(printf '%s' "$LP_APPLIED" | tr -d '\n')" "local-paths: the applied exemption is reported by name"

printf '%s\n' . ./ / '*' 'src/*.js' '../homelab' 'homelab/../src' './homelab' '/home/alice' 'C:/x' ':(top)src' 'home lab' '**' > "$LP/.cortex/local-paths"
_abs_path_hits "$LP"
assert_eq "0" "${#LP_EXCLUDE[@]}" "local-paths: '.', '/', globs, '..', './', absolute, magic and spaces are all rejected"
assert_eq "13" "$(printf '%s' "$LP_REJECTED" | grep -c .)" "local-paths: each rejected line is reported, none dropped silently"
assert_contains "$ABS_HITS" "src/app.js" "local-paths: a rejected line exempts nothing"

printf 'gone-folder\n' > "$LP/.cortex/local-paths"
_abs_path_hits "$LP"
assert_eq "gone-folder" "$(printf '%s' "$LP_DORMANT" | tr -d '\n')" "local-paths: an exemption covering no tracked file is reported as dead"

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
