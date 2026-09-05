# The ritual list has exactly one complete copy, and the README says so in checkable numbers.
#
# README carried a second table that read as *the* list of rituals. Ten skills were missing from it.
# Nothing caught that for months, because a partial copy and a complete one are indistinguishable
# until someone counts — there is no error state, just a reader who never learns that
# /cortex-impact exists.
#
# The fix was not "sync the two tables". Two maintained copies drift again; that is what they do.
# README now carries a DECLARED subset with its own size and the total spelled out in numerals, so
# both halves of the sentence are assertions rather than prose. AGENTS.md holds the complete table
# and is the only place a new ritual has to be added.

. "$(dirname "${BASH_SOURCE[0]}")/_helpers.sh"   # $WORK or refuse — see the gate there

ROOT_MD="$REPO_ROOT/AGENTS.md"
READ_ME="$REPO_ROOT/README.md"

# --- one row per skill, and one skill per row ------------------------------------------------------

skills=0
for d in "$REPO_ROOT"/skills/*/; do
  [ -f "$d/SKILL.md" ] && skills=$((skills + 1))
done
rows="$(grep -c '^| `/' "$ROOT_MD")"

if [ "$skills" -gt 30 ]; then
  _pass "found the skills directory ($skills skills with a SKILL.md)"
else
  _fail "found the skills directory" "only $skills — did the glob break?"
fi

if [ "$rows" -eq "$skills" ]; then
  _pass "AGENTS.md lists every ritual ($rows rows = $skills skills)"
else
  _fail "AGENTS.md lists every ritual" "$rows rows vs $skills skills — add the row, or the table is lying by omission"
fi

# Not just the count: each row must name a skill that exists. Equal totals with one row renamed and
# one skill added would otherwise pass.
missing=""
for name in $(grep -o '^| `/[a-z-]*`' "$ROOT_MD" | tr -d '|` ' | sed 's|^/||'); do
  [ -f "$REPO_ROOT/skills/$name/SKILL.md" ] || missing="$missing $name"
done
if [ -n "$missing" ]; then
  _fail "every AGENTS.md row names a real skill" "no skills/<name>/SKILL.md for:$missing"
else
  _pass "every AGENTS.md row names a real skill"
fi

# --- README declares a subset, and the declaration is true -----------------------------------------

readme="$(cat "$READ_ME")"
subset="$(grep -c '^| `/' "$READ_ME")"

assert_contains "$readme" "That is $subset of $skills." \
  "README says how many of how many, in numerals a test can check"

# The guard against the original bug: if this table ever grows back toward the full list, it has
# stopped being a subset and started being a second copy.
if [ "$subset" -le 10 ]; then
  _pass "and keeps the subset small enough to stay obviously partial ($subset rows)"
else
  _fail "and keeps the subset small" "$subset rows — that is a second table, not a taste"
fi

for name in $(grep -o '^| `/[a-z-]*`' "$READ_ME" | tr -d '|` ' | sed 's|^/||'); do
  [ -f "$REPO_ROOT/skills/$name/SKILL.md" ] || _fail "README subset row /$name" "no such skill"
done
_pass "and every row in it names a real skill"

assert_contains "$readme" "AGENTS.md#the-rituals" "and points at the complete table"

# --- a committed file never wikilinks to a gitignored one ------------------------------------------

# connections.md linked [[home]], and home.md is a personal file this repo gitignores. The link was
# dead in every fork and in the graph the viewer draws. General rule, checked at the one place it
# has already been broken.
#
# Link LINES only, not prose: the note explaining the fix quotes the broken link on purpose, and a
# check that cannot tell a link from a mention of one forces you to delete the explanation.
if grep -q '^- .*\[\[home\]\]' "$REPO_ROOT/connections.md"; then
  _fail "connections.md does not link the gitignored home.md" "a list item still links [[home]]"
else
  _pass "connections.md does not link the gitignored home.md"
fi
