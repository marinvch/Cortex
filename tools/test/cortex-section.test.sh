# cortex-section rewrites a section of a team's CLAUDE.md — outside .cortex/, in a file the team
# writes too. So the contract is checked on a real git fixture, where "nothing else changed" is a
# git diff anyone can read (#505):
#
#   - status writes nothing, names the state, and prints the diff for an outdated or edited section;
#   - an outdated section (an earlier release's text, untouched) is replaced, and the diff touches
#     the section's changed lines and no other line of the file, in its own line endings;
#   - an edited section is refused and left exactly as it was, and so is a duplicated one;
#   - a second run writes nothing.
#
# index/test/section.test.mjs covers the reader and the replace from literals; this is the CLI's own.

. "$(dirname "${BASH_SOURCE[0]}")/_helpers.sh"   # $WORK or refuse — see the gate there

SEC="$REPO_ROOT/index/cortex-section.mjs"
NEXT="$REPO_ROOT/index/cortex-next.mjs"

# The 2.41.0 playbook, rendered the way that release appended it, from the shipped history.
old_section() { # roster
  node --input-type=module -e '
    import { pathToFileURL } from "node:url";
    const [root, roster] = process.argv.slice(1);
    const { SHIPPED_SECTIONS } = await import(pathToFileURL(root + "/index/lib/shipped-sections.mjs").href);
    const { renderTemplate } = await import(pathToFileURL(root + "/index/lib/placeholders.mjs").href);
    const e = SHIPPED_SECTIONS["team/playbook.md"].earlier.find((x) => x.version === "2.41.0");
    process.stdout.write(renderTemplate(e.text, { ROSTER: roster }) + "\n");
  ' "$REPO_ROOT" "$1"
}

field() { # json js-expression -> value, jq-free
  node -e 'const j = JSON.parse(require("fs").readFileSync(0, "utf8")); const v = (0, eval)("(j) => " + process.argv[1])(j); process.stdout.write(typeof v === "string" ? v : JSON.stringify(v));' "$2" <<< "$1"
}

# --- an outdated section, CRLF, between two sections the team wrote ------------------------------------

P="$WORK/stamped"
mkrepo "$P"
{
  printf '@AGENTS.md\r\n\r\n## Verifying your work\r\n\r\n| Test | `npm test` |\r\n\r\n'
  old_section '`architect`, `tester`' | sed 's/$/\r/'
  printf '\r\n## Our own notes\r\n\r\nKeep this.  \r\n'
} > "$P/CLAUDE.md"
git -C "$P" add -A && git -C "$P" commit -q -m "stamped by 2.41.0"

out="$(node "$SEC" "$P" 2>&1)"; rc=$?
assert_eq "0" "$rc" "status exits 0"
assert_contains "$out" "outdated: CLAUDE.md § Working as a team is Cortex 2.41.0's text" "status names the state and the release whose text it is"
assert_contains "$out" '+2. Then end your reply with the exact question "Single agent or team?" and stop' "and prints the diff"
assert_eq "" "$(git -C "$P" status --porcelain)" "status writes nothing"
json="$(node "$SEC" "$P" --json 2>&1)"
assert_eq "outdated" "$(field "$json" 'j.sections[0].state')" "--json carries the state"
assert_eq '`architect`, `tester`' "$(field "$json" 'j.sections[0].values.ROSTER')" "and the roster it read from the section"

next="$(node "$NEXT" "$P" --json 2>&1)"
assert_eq "false" "$(field "$next" 'j.steps.find((s) => s.id === "sections").optional')" "cortex-next makes the outdated section a required row"

cp "$P/CLAUDE.md" "$WORK/before.md"   # the bytes on disk: git may fold CRLF on a runner with autocrlf
out="$(node "$SEC" "$P" --replace team 2>&1)"; rc=$?
assert_eq "0" "$rc" "--replace exits 0"
assert_contains "$out" "Replaced CLAUDE.md § Working as a team" "and says what it wrote"
around="$(node -e '
  const fs = require("fs");
  const [a, b] = process.argv.slice(1).map((p) => fs.readFileSync(p, "utf8"));
  const cut = (t) => [t.slice(0, t.indexOf("## Working as a team")), t.slice(t.indexOf("\r\n\r\n## Our own notes"))];
  const [ap, as] = cut(a), [bp, bs] = cut(b);
  process.stdout.write(String(ap === bp && as === bs && a !== b));
' "$WORK/before.md" "$P/CLAUDE.md")"
assert_eq "true" "$around" "every byte before and after the section is the one that was there"
assert_not_contains "$(git -C "$P" diff -U0 -- CLAUDE.md)" "Keep this." "the team's own section is not in the diff"
assert_not_contains "$(git -C "$P" diff -U0 -- CLAUDE.md)" "Verifying your work" "nor is the verification block"
crlf="$(node -e 'const t = require("fs").readFileSync(process.argv[1], "utf8"); process.stdout.write(String(t.split("\n").length - 1 === t.split("\r\n").length - 1))' "$P/CLAUDE.md")"
assert_eq "true" "$crlf" "every line keeps the file's CRLF"
assert_eq "current" "$(field "$(node "$SEC" "$P" --json 2>&1)" 'j.sections[0].state')" "after which it reads current"
assert_contains "$(cat "$P/CLAUDE.md")" '`architect`, `tester`' "with the roster it had"
git -C "$P" add -A && git -C "$P" commit -q -m "refreshed"
out="$(node "$SEC" "$P" --replace team 2>&1)"; rc=$?
assert_eq "0" "$rc" "a second run is not an error"
assert_eq "" "$(git -C "$P" status --porcelain)" "and writes nothing"

# --- an edited section: shown, never written ----------------------------------------------------------

E="$WORK/edited"
mkrepo "$E"
{ printf '@AGENTS.md\n\n'; old_section '`tester`' | sed 's/The developer decides./The tech lead decides./'; } > "$E/CLAUDE.md"
git -C "$E" add -A && git -C "$E" commit -q -m "the team edited it"
out="$(node "$SEC" "$E" 2>&1)"
assert_contains "$out" "edited: CLAUDE.md § Working as a team was edited here" "an edited section reads edited"
assert_contains "$out" "-   The tech lead decides." "and the diff shows their line"
out="$(node "$SEC" "$E" --replace team 2>&1)"; rc=$?
assert_eq "1" "$rc" "--replace refuses it"
assert_contains "$out" "edited here" "saying why"
assert_eq "" "$(git -C "$E" status --porcelain)" "and the file is exactly as it was"

# --- two sections: refused -----------------------------------------------------------------------------

D="$WORK/duplicated"
mkrepo "$D"
{ old_section '`tester`'; printf '\n'; old_section '`tester`'; } > "$D/CLAUDE.md"
git -C "$D" add -A && git -C "$D" commit -q -m "appended twice"
out="$(node "$SEC" "$D" --replace team 2>&1)"; rc=$?
assert_eq "2" "$rc" "two sections are refused"
assert_contains "$out" "2 sections headed" "with a sentence naming them"
assert_eq "" "$(git -C "$D" status --porcelain)" "and nothing is written"

out="$(node "$SEC" "$D" --replace nope 2>&1)"; rc=$?
assert_eq "1" "$rc" "an unknown section id is refused"

# --- --append: a block takes the file's own line endings (#548) ------------------------------------
#
# On a core.autocrlf checkout CLAUDE.md is CRLF on disk and the templates are LF. Appending the
# playbook as-is left one file with both. A real checkout with autocrlf on, so git itself wrote the
# CRLF: the file must end with no bare LF, and git must see added lines only.
A="$WORK/append-crlf"
mkrepo "$A"
git -C "$A" config core.autocrlf true
printf '@AGENTS.md\n\n## Verifying your work\n\nRun the tests.\n' > "$A/CLAUDE.md"
printf '# demo\n' > "$A/AGENTS.md"
git -C "$A" add -A 2>/dev/null && git -C "$A" commit -q -m first
rm "$A/CLAUDE.md" && git -C "$A" checkout -q -- CLAUDE.md    # checked out again, now CRLF on disk
bare_lf() { node -e 'const t = require("fs").readFileSync(process.argv[1], "utf8"); process.stdout.write(String((t.match(/(?<!\r)\n/g) || []).length) + " " + String((t.match(/\r\n/g) || []).length > 0));' "$1"; }
assert_eq "0 true" "$(bare_lf "$A/CLAUDE.md")" "append: the fixture's CLAUDE.md is CRLF on disk"
node "$REPO_ROOT/index/cortex-stamps.mjs" render team/playbook.md --value 'ROSTER=`tester`' > "$WORK/playbook.block"
out="$(node "$SEC" "$A" --append CLAUDE.md --from "$WORK/playbook.block" 2>&1)"; rc=$?
assert_eq "0" "$rc" "append: the playbook is appended"
assert_contains "$out" "with its own line endings (CRLF)" "and the report names the endings it used"
assert_eq "0 true" "$(bare_lf "$A/CLAUDE.md")" "append: no LF line is left in the CRLF file"
assert_eq "" "$(git -C "$A" diff --numstat -- CLAUDE.md | awk '$2 != 0')" "append: git sees added lines and no changed or removed one"
assert_contains "$(node "$SEC" "$A" 2>&1)" "current: CLAUDE.md § Working as a team" "append: and the section reads as this release's text"
out="$(node "$SEC" "$A" --append CLAUDE.md --from "$WORK/playbook.block" 2>&1)"; rc=$?
assert_eq "2" "$rc" "append: a second append of the same block is refused"
out="$(node "$SEC" "$A" --append src/app.js --from "$WORK/playbook.block" 2>&1)"; rc=$?
assert_eq "1" "$rc" "append: a file that is not markdown is refused"
assert_eq " M CLAUDE.md" "$(git -C "$A" status --porcelain)" "append: and CLAUDE.md is the one file that changed"
