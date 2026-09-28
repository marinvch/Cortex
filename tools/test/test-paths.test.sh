# test-paths.sh — the Tester's fence: Edit and Write reach test files only, and every doubt blocks.
#
# templates/team/test-paths.sh is an ALLOW-list, the opposite of protected-paths.sh. That one lets an
# edit through unless it names a protected path; this one refuses an edit unless it can prove the path
# is a test file inside this repo. So every input it cannot read, every path it cannot place, and an
# empty glob list all exit 2. Claude Code treats any other exit as a non-blocking error and lets the
# edit through, which is how protected-paths shipped once with no guard at all on a machine without jq.
#
# The fixtures are real directories, because the script resolves the path physically: a `..` or a
# symlink out of test/ must not pass a pattern that only looked at the spelling.

. "$(dirname "${BASH_SOURCE[0]}")/_helpers.sh"   # $WORK or refuse — see the gate there

SRC="$REPO_ROOT/templates/team/test-paths.sh"
F="$WORK/fence"
P="$F/proj"
mkdir -p "$P/test/unit" "$P/src/__tests__" "$P/.claude/hooks" "$P/.claude/worktrees/wt/test" \
  "$P/.claude/worktrees/wt/src" "$F/outside/test" "$F/test/proj2/src"
printf 'x\n' > "$P/src/app.js"

# Render the way /cortex will: one quoted glob per line in place of the placeholder.
fill() { # globs-with-\n
  sed "s#{{TEST_GLOBS}}#$1#" "$SRC"
}
fill '  "*/test/*"\n  "*/__tests__/*"\n  "*.test.js"' > "$F/hook-default.sh"
fill '  "*/test/*"\n  "*/__tests__/*"\n  "*.test.js"' | sed 's/if command -v jq >\/dev\/null 2>&1; then/if false; then/' > "$F/hook-nojq.sh"
fill '' > "$F/hook-empty.sh"
fill '  "*"' > "$F/hook-wide.sh"

# hook_exit <mode> <project-dir> <json>
hook_exit() { printf '%s' "$3" | CLAUDE_PROJECT_DIR="$2" bash "$F/hook-$1.sh" >/dev/null 2>&1; echo "$?"; }
edit() { printf '{"tool_name":"Edit","tool_input":{"file_path":"%s","old_string":"a","new_string":"b"}}' "$1"; }

assert_eq "" "$(grep -n '{{' "$F/hook-default.sh")" "the rendered hook holds no placeholder"

for mode in default nojq; do
  assert_eq "0" "$(hook_exit "$mode" "$P" "$(edit "$P/test/unit/a.test.js")")" "fence ($mode): a file in a nested test directory may be edited"
  assert_eq "0" "$(hook_exit "$mode" "$P" "$(edit "$P/src/__tests__/app.js")")" "fence ($mode): so may one under __tests__"
  assert_eq "0" "$(hook_exit "$mode" "$P" "$(edit "$P/src/app.test.js")")" "fence ($mode): and one named as a test beside the code"
  assert_eq "0" "$(hook_exit "$mode" "$P" "$(edit "$P/test/new/deep/b.js")")" "fence ($mode): a new test file in a directory that does not exist yet"
  assert_eq "2" "$(hook_exit "$mode" "$P" "$(edit "$P/src/app.js")")" "fence ($mode): source code is refused with exit 2"
  assert_eq "2" "$(hook_exit "$mode" "$P" "$(edit "$P/test/../src/app.js")")" "fence ($mode): a .. out of test/ is refused, whatever the spelling matches"
  # Through a directory that does not exist yet, nothing resolves the `..` — only the spelling check
  # stands between this and src/.
  assert_eq "2" "$(hook_exit "$mode" "$P" "$(edit "$P/test/new/../../src/app.js")")" "fence ($mode): a .. through a directory not yet made is refused"
  assert_eq "2" "$(hook_exit "$mode" "$P" "$(edit "$F/outside/test/a.test.js")")" "fence ($mode): a test-shaped path outside the repo is refused"
  assert_eq "2" "$(hook_exit "$mode" "$F/test/proj2" "$(edit "$F/test/proj2/src/app.js")")" \
    "fence ($mode): a repo that sits under a directory named test gains nothing from it"
  assert_eq "0" "$(hook_exit "$mode" "$P" "$(edit "$P/.claude/worktrees/wt/test/a.test.js")")" \
    "fence ($mode): a test file in one of the repo's own worktrees may be edited"
  assert_eq "2" "$(hook_exit "$mode" "$P" "$(edit "$P/.claude/worktrees/wt/src/app.js")")" "fence ($mode): source in a worktree is still refused"

  # Windows hands the hook backslash paths; jq unescapes the JSON `\\`, the sed fallback leaves it
  # doubled. Either way the separators are normalised before anything is compared (#458).
  win_test="$(printf '%s' "$P/test/unit/a.test.js" | sed 's#/#\\\\#g')"
  win_src="$(printf '%s' "$P/src/app.js" | sed 's#/#\\\\#g')"
  assert_eq "0" "$(hook_exit "$mode" "$P" "$(edit "$win_test")")" "fence ($mode): a backslash path to a test file may be edited"
  assert_eq "2" "$(hook_exit "$mode" "$P" "$(edit "$win_src")")" "fence ($mode): a backslash path to source is refused"

  # Fail closed on every input the fence cannot read.
  assert_eq "2" "$(hook_exit "$mode" "$P" '{"tool_name":"Edit","tool_input":{"command":"ls"}}')" "fence ($mode): no file_path at all is refused"
  assert_eq "2" "$(hook_exit "$mode" "$P" '{"tool_input":{"file_path":')" "fence ($mode): input that is not JSON is refused"
  assert_eq "2" "$(hook_exit "$mode" "$P" '')" "fence ($mode): empty input is refused"
  assert_eq "2" "$(hook_exit "$mode" "$P" '{"tool_input":{"file_path":42}}')" "fence ($mode): a file_path that is not a path is refused"
  assert_eq "2" "$(hook_exit "$mode" "$P" "$(edit "test/unit/a.test.js")")" "fence ($mode): a relative path is refused — Claude Code sends absolute ones"
  assert_eq "2" "$(cd "$P" || exit 1; hook_exit "$mode" "$P" "$(edit "test/unit/a.test.js")")" \
    "fence ($mode): even from inside the repo, where it would resolve"
  assert_eq "2" "$(hook_exit "$mode" "" "$(edit "$P/test/unit/a.test.js")")" "fence ($mode): with no project directory it cannot place the path, so it refuses"
done

# Drive-letter paths, where this platform has them. On Windows, Claude Code sends `C:\repo\...` and
# exports CLAUDE_PROJECT_DIR the same way, while Git Bash itself sees `/c/repo`.
if command -v cygpath >/dev/null 2>&1; then
  wroot="$(cygpath -w "$P")"
  wjson() { printf '{"tool_input":{"file_path":"%s"}}' "$(printf '%s' "$1" | sed 's#\\#\\\\#g')"; }
  assert_eq "0" "$(hook_exit default "$wroot" "$(wjson "$wroot\\test\\unit\\a.test.js")")" "fence: a drive-letter path to a test file may be edited"
  assert_eq "2" "$(hook_exit default "$wroot" "$(wjson "$wroot\\src\\app.js")")" "fence: a drive-letter path to source is refused"
  assert_eq "0" "$(hook_exit default "$P" "$(wjson "$wroot\\test\\unit\\a.test.js")")" "fence: a drive-letter path under a /c/-style project directory is placed"
else
  _pass "fence: drive-letter paths — not a Windows shell, covered by the backslash cases above"
fi

# A symlink out of test/ passes any check on the spelling. Where this platform cannot make a real
# symlink (Git Bash copies by default), a copy is genuinely inside test/ and the case does not arise.
ln -s ../src "$P/test/escape" 2>/dev/null
ln -s ../src/app.js "$P/test/link.test.js" 2>/dev/null
if [ -L "$P/test/escape" ] && [ -L "$P/test/link.test.js" ]; then
  assert_eq "2" "$(hook_exit default "$P" "$(edit "$P/test/escape/app.js")")" "fence: a symlinked directory out of test/ is refused"
  assert_eq "2" "$(hook_exit default "$P" "$(edit "$P/test/link.test.js")")" "fence: a test-named symlink to source is refused"
else
  _pass "fence: symlink escapes — this platform made copies, not links, so there is no escape to test"
fi

# The fence guards itself. With a glob that allows everything, the agent still cannot rewrite the
# hook, its own definition, or the settings that load them.
assert_eq "0" "$(hook_exit wide "$P" "$(edit "$P/src/app.js")")" "fence (wide globs): the glob list is what decides"
assert_eq "2" "$(hook_exit wide "$P" "$(edit "$P/.claude/hooks/test-paths.sh")")" "fence (wide globs): the hook itself is never editable"
assert_eq "2" "$(hook_exit wide "$P" "$(edit "$P/.claude/agents/tester.md")")" "fence (wide globs): nor the agent file that declares it"
assert_eq "2" "$(hook_exit wide "$P" "$(edit "$P/.claude/worktrees/wt/.claude/hooks/test-paths.sh")")" "fence (wide globs): nor a worktree's copy"

# An empty list is a stamp with no detected test location. Unlike protected-paths, that blocks.
assert_eq "2" "$(hook_exit empty "$P" "$(edit "$P/test/unit/a.test.js")")" "fence (no globs): nothing is a test file, so nothing is editable"
empty_msg="$(printf '%s' "$(edit "$P/test/unit/a.test.js")" | CLAUDE_PROJECT_DIR="$P" bash "$F/hook-empty.sh" 2>&1 >/dev/null)"
assert_contains "$empty_msg" "no test locations" "fence (no globs): the block says the list is empty, not that the file is wrong"

# bash 3.2 (macOS) reads "${arr[@]}" of an empty array as unset under `set -u` and dies — with exit 1,
# which would let the edit through. This bash cannot reproduce that, so the guard is on the form.
if grep -qE '(^|[^+])"\$\{test_globs\[@\]\}"' "$SRC"; then
  _fail "fence: the glob loop survives an empty list on bash 3.2" 'use ${test_globs[@]+"${test_globs[@]}"}'
else
  _pass "fence: the glob loop survives an empty list on bash 3.2"
fi

msg="$(printf '%s' "$(edit "$P/src/app.js")" | CLAUDE_PROJECT_DIR="$P" bash "$F/hook-default.sh" 2>&1 >/dev/null)"
assert_contains "$msg" "src/app.js" "fence: a block names the file"
assert_contains "$msg" "Implementer" "fence: and says whose change it is"

# The command the Tester's frontmatter runs, run as Claude Code runs it (`sh -c`). `|| exit 2` is what
# makes a missing or crashing script block: without it, bash exits 127 and the edit goes through.
cmd="$(sed -n "s/^ *command: '\(.*\)'$/\1/p" "$REPO_ROOT/templates/team/tester.md")"
assert_contains "$cmd" '.claude/hooks/test-paths.sh' "tester.md: the frontmatter hook runs the stamped fence"
cp "$F/hook-default.sh" "$P/.claude/hooks/test-paths.sh"
fm_exit() { printf '%s' "$2" | CLAUDE_PROJECT_DIR="$1" sh -c "$cmd" >/dev/null 2>&1; echo "$?"; }
assert_eq "0" "$(fm_exit "$P" "$(edit "$P/test/unit/a.test.js")")" "tester.md: the command lets a test edit through"
assert_eq "2" "$(fm_exit "$P" "$(edit "$P/src/app.js")")" "tester.md: the command blocks a source edit"
rm "$P/.claude/hooks/test-paths.sh"
assert_eq "2" "$(fm_exit "$P" "$(edit "$P/test/unit/a.test.js")")" "tester.md: with the script missing, every edit is blocked"

# The hook-input reader is copied, not shared: each hook is stamped alone into a repo that has no
# Cortex library to source. So the copies are pinned — the six lines from `input=$(cat)` to `fi`.
reader() { sed -n '/^input=\$(cat)$/,/^fi$/p' "$1"; }
ref="$(reader "$REPO_ROOT/templates/loop/protected-paths.sh")"
assert_contains "$ref" "jq -r '.tool_input.file_path // empty'" "parity: the reference reader was found"
for t in templates/loop/format-changed.sh templates/team/test-paths.sh; do
  assert_eq "$ref" "$(reader "$REPO_ROOT/$t")" "parity: $t reads the hook input exactly as protected-paths.sh does"
done
