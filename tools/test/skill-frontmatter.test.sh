# Every ritual's frontmatter is something a router can read — strict, from the first commit.
#
# A `description:` written as a YAML block scalar parses to the indicator (`|`, `>-`), so the router
# sees one or two characters and never suggests the skill. It still runs when typed by name, which
# is why nobody notices. tools/cortex-frontmatter.mjs is the check; this file asserts the real
# skills pass it, and that each rule actually fires on a fixture — a validator that passes the repo
# because it rejects nothing would look identical from the outside.

. "$(dirname "${BASH_SOURCE[0]}")/_helpers.sh"   # $WORK or refuse — see the gate there

CHECK="$REPO_ROOT/tools/cortex-frontmatter.mjs"

out="$(node "$CHECK" --check 2>&1)"
assert_eq "0" "$?" "every skills/*/SKILL.md passes the strict frontmatter check"
assert_contains "$out" " 0 with frontmatter a router cannot trust" "and says how many it read"

cd "$WORK" || exit 1

GOOD_DESC="Does one clearly described thing. Use when the user asks for exactly that thing, by name."

# skill <dir> <frontmatter lines...> — write a SKILL.md into a fresh one-skill tree under $WORK/<dir>.
skill() {
  local dir="$1" name="$2"
  shift 2
  mkdir -p "$WORK/$dir/skills/$name"
  { printf -- '---\n'; printf '%s\n' "$@"; printf -- '---\n\n# body\n'; } > "$WORK/$dir/skills/$name/SKILL.md"
}

# verdict <dir> — the check's output against that tree; exit code in $rc.
verdict() {
  out="$(node "$CHECK" --check "$1/skills" 2>&1)"
  rc=$?
}

skill ok demo "name: demo" "description: $GOOD_DESC" "capability: mechanical"
verdict ok
assert_eq "0" "$rc" "a flat, plain frontmatter passes"

skill quoted demo "name: demo" "description: \"Quoted: with a colon, which is fine once quoted. Use on demo.\"" \
  "argument-hint: 'it''s single-quoted'"
verdict quoted
assert_eq "0" "$rc" "a quoted value may carry ': ' and a doubled single quote"

i=0
for header in '|' '|-' '>' '>-'; do
  i=$((i + 1))   # numbered, not named after the header: | and > are not legal in a Windows path
  skill "block$i" demo "name: demo" "description: $header" "  $GOOD_DESC"
  verdict "block$i"
  assert_eq "1" "$rc" "a block-scalar description ($header) fails"
  assert_contains "$out" "block scalar" "and says it is a block scalar ($header)"
done

skill colon demo "name: demo" "description: Two jobs: this one and that one. Use when you want either of them."
verdict colon
assert_eq "1" "$rc" "an unquoted value containing ': ' fails"
assert_contains "$out" 'contains ": "' "and names the colon"

skill at demo "name: demo" "description: @mention starts this description, which YAML reserves for itself."
verdict at
assert_eq "1" "$rc" "an unquoted value starting with @ fails"

skill tick demo "name: demo" "description: \`/demo\` starts with a backtick, which YAML reserves for later use."
verdict tick
assert_eq "1" "$rc" "an unquoted value starting with a backtick fails"

skill hash demo "name: demo" "description: Handles issue #1 fine, but a space then # starts a comment in YAML."
verdict hash
assert_eq "1" "$rc" "an unquoted ' #' fails — everything after it would be dropped as a comment"

skill noname demo "description: $GOOD_DESC"
verdict noname
assert_eq "1" "$rc" "a missing name fails"
assert_contains "$out" "no 'name:' key" "and names the missing key"

skill emptydesc demo "name: demo" "description:"
verdict emptydesc
assert_eq "1" "$rc" "an empty description fails"

skill emptyquoted demo "name: demo" 'description: ""'
verdict emptyquoted
assert_eq "1" "$rc" "a quoted-empty description fails"

skill wrongname demo "name: other" "description: $GOOD_DESC"
verdict wrongname
assert_eq "1" "$rc" "a name that does not match the directory fails"

skill dup demo "name: demo" "description: $GOOD_DESC" "description: $GOOD_DESC"
verdict dup
assert_eq "1" "$rc" "a duplicate key fails"

skill notmap demo "name: demo" "description: $GOOD_DESC" "- a list item"
verdict notmap
assert_eq "1" "$rc" "a line that is not key: value fails — the block must parse as a mapping"

skill unclosed demo "name: demo" "description: \"never closed. Use when testing the validator itself."
verdict unclosed
assert_eq "1" "$rc" "an unclosed quote fails"

mkdir -p "$WORK/nofm/skills/demo"
printf '# no frontmatter at all\n' > "$WORK/nofm/skills/demo/SKILL.md"
verdict nofm
assert_eq "1" "$rc" "a SKILL.md with no frontmatter fails"

# CRLF is how a Windows checkout may hand these files over; it must not read as a malformed line.
mkdir -p "$WORK/crlf/skills/demo"
printf -- '---\r\nname: demo\r\ndescription: %s\r\n---\r\n' "$GOOD_DESC" > "$WORK/crlf/skills/demo/SKILL.md"
verdict crlf
assert_eq "0" "$rc" "CRLF line endings pass"
