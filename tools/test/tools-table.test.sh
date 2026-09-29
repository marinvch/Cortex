# The README's Tools table lists every script in tools/ and nothing else (#501).
#
# The README is the public site's source for /cli (skills/site-sync/PAGES.md). The two tables had
# drifted apart: the site listed cortex-claude-docs.mjs, the README did not, and the README listed a
# sourced library the site had dropped. Nothing noticed, because a table that is one row short reads
# exactly like a complete one. The rule the README states is the rule checked here: every script in
# tools/ and tools/server/ that is run directly is a row, and a library (a name starting with `_`,
# only ever sourced) and the test harness are not.

. "$(dirname "${BASH_SOURCE[0]}")/_helpers.sh"   # $WORK or refuse — see the gate there

README="$REPO_ROOT/README.md"
# The rows of the table under "## Tools (`tools/`)", up to the next heading.
table="$(awk '/^## Tools \(`tools\/`\)/{on=1; next} on && /^## /{exit} on' "$README")"
rows="$(printf '%s\n' "$table" | sed -n 's/^| `\([^`]*\)` |.*/\1/p' | grep -v '^Script$' | sort)"

# What tools/ actually holds, by the same rule.
actual="$(cd "$REPO_ROOT/tools" && ls ./*.sh ./*.mjs server/*.sh 2>/dev/null | sed 's#^\./##' | grep -v '^_' | sort)"

assert_eq "" "$( [ -n "$rows" ] || echo empty)" "the README Tools table was found and has rows"
for f in $actual; do
  case "$(printf '%s\n' "$rows")" in
    *"$f"*) _pass "README Tools table lists $f" ;;
    *) _fail "README Tools table lists $f" "add a row for tools/$f, or rename it with a leading _ if it is only sourced" ;;
  esac
done
for r in $rows; do
  if [ -f "$REPO_ROOT/tools/$r" ]; then
    _pass "row $r names a script in tools/"
  else
    _fail "row $r names a script in tools/" "tools/$r does not exist"
  fi
  case "$r" in
    _*) _fail "row $r is a tool, not a library" "a sourced library is described in the prose above the table, not listed" ;;
  esac
done
assert_eq "$actual" "$rows" "the table and tools/ list the same scripts"
