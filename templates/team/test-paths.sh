#!/usr/bin/env bash
# The Tester's fence. The Tester subagent runs this before every Edit and Write, from the hook in its
# own frontmatter, and it lets the edit through only when the file is a test file inside this repo.
#
# This is an ALLOW-list, the opposite of protected-paths.sh, so it fails the other way: whatever it
# cannot prove, it refuses. Unreadable input, a path it cannot place in the repo, a `..`, a symlink,
# and an empty glob list all exit 2. Claude Code treats any other exit as a non-blocking error and
# lets the edit through, so exit 2 is the only answer that refuses anything.
set -uo pipefail

refuse() {
  echo "test-paths: $1" >&2
  echo "The Tester edits test files only. A change to the code is the Implementer's; a test location this" >&2
  echo "list does not know goes into .claude/hooks/test-paths.sh, by the developer." >&2
  exit 2
}

input=$(cat)
if command -v jq >/dev/null 2>&1; then
  path=$(printf '%s' "$input" | jq -r '.tool_input.file_path // empty' 2>/dev/null)
else
  path=$(printf '%s' "$input" | sed -n 's/.*"file_path"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1)
fi
[ -n "$path" ] || refuse "could not read a file path from the hook input, so the edit is blocked."

# Where each glob is tested: `/` plus the path from the repo root, so `*/test/*` means a test/
# directory anywhere in the repo and never one the repo happens to sit inside.
test_globs=(
{{TEST_GLOBS}}
)

# One separator (#458): on Windows Claude Code sends `C:\repo\x`, and the sed reader leaves the JSON
# `\\` doubled, so fold backslashes to `/` and then runs of `/` to one.
slashes() {
  local p=${1//\\//}
  while :; do
    case "$p" in *//*) p=${p//\/\//\/} ;; *) break ;; esac
  done
  printf '%s' "$p"
}
path=$(slashes "$path")
root=$(slashes "${CLAUDE_PROJECT_DIR:-}")
[ -n "$root" ] || refuse "CLAUDE_PROJECT_DIR is not set, so $path cannot be placed in the repo."

case "$path" in
  /* | [A-Za-z]:/*) ;;
  *) refuse "$path is not an absolute path." ;;
esac
case "/$path/" in
  */../* | */./*) refuse "$path steps through . or .., so where it lands is not what it spells." ;;
esac
[ -L "$path" ] && refuse "$path is a symlink; the edit would land wherever it points."

# The physical path: the deepest directory that exists, resolved with `pwd -P`, plus the part that
# does not exist yet. A symlinked directory is followed here, so it cannot carry an edit out of test/.
physical() {
  local dir=$1 rest=""
  while [ ! -d "$dir" ]; do
    case "$dir" in */*) ;; *) return 1 ;; esac
    rest="/${dir##*/}$rest"
    dir=${dir%/*}
    [ -n "$dir" ] || dir=/
  done
  dir=$(cd "$dir" 2>/dev/null && pwd -P) || return 1
  printf '%s%s' "${dir%/}" "$rest"
}
real=$(physical "$path") || refuse "could not resolve $path."
base=$(physical "$root") || refuse "could not resolve the project directory $root."

case "$real" in
  "$base"/*) rel=${real#"$base"/} ;;
  *) refuse "$path is outside this repo." ;;
esac

# A worktree of this repo is this repo: judge the path from the worktree's own root.
case "$rel" in
  .claude/worktrees/*/*) rel=${rel#.claude/worktrees/*/} ;;
esac
case "$rel" in
  .claude/*) refuse "$rel is Claude Code configuration, which holds this fence." ;;
esac

# An empty list is a stamp that found no test location, and here that refuses every edit. Under
# `set -u`, bash before 4.4 (macOS ships 3.2) reads "${arr[@]}" of an empty array as unset and dies
# with exit 1, which would let the edit through; the `+` forms expand to nothing instead.
[ -n "${test_globs[*]+x}" ] || refuse "no test locations are listed, so no file counts as a test."
for pattern in ${test_globs[@]+"${test_globs[@]}"}; do
  case "/$rel" in
    $pattern) exit 0 ;;
  esac
done
refuse "$rel is not a test file (${test_globs[*]})."
