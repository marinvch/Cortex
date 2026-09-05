# The contributor invariants moved out of AGENTS.md, and this is what makes that safe.
#
# Moving sixty lines behind a pointer trades context load for a risk: an agent editing this repo
# never reaches them, and breaks a rule it was never shown. The pointer is the only thing standing
# between those two outcomes, so it is asserted rather than trusted — along with the invariants
# themselves, because a file that survives while its content is quietly deleted passes a mere
# existence check.
#
# If you are splitting a document again, copy this shape. The rule is not "keep a file"; it is
# "keep the pointer, on the path the reader actually walks, and keep what it points at".

DOC="$REPO_ROOT/docs/changing-cortex.md"
ROOT_MD="$REPO_ROOT/AGENTS.md"

# --- the target exists and is not a stub -----------------------------------------------------------

if [ -f "$DOC" ]; then _pass "docs/changing-cortex.md exists"; else _fail "docs/changing-cortex.md exists"; fi
lines="$(wc -l < "$DOC" | tr -d ' ')"
if [ "$lines" -gt 40 ]; then
  _pass "and carries real content ($lines lines)"
else
  _fail "and carries real content" "only $lines lines — did a split leave a stub behind?"
fi

# --- the pointer, on the path an editor actually walks ---------------------------------------------

root="$(cat "$ROOT_MD")"
assert_contains "$root" "docs/changing-cortex.md" "AGENTS.md points at it"

# Specifically from "Where to look" — the section an agent reads before touching this repo. A pointer
# only in the rituals section would be found by someone choosing a ritual, which is the wrong reader.
where="$(sed -n '/^### Where to look/,/^## /p' "$ROOT_MD")"
assert_contains "$where" "docs/changing-cortex.md" "and does so from Where to look, on the mandatory path"

# --- the invariants themselves ---------------------------------------------------------------------

# Each key is a thing an agent must do or must not do. A rename is fine; a disappearance is not.
doc="$(cat "$DOC")"
while IFS='|' read -r key what; do
  [ -z "$key" ] && continue
  assert_contains "$doc" "$key" "it still covers: $what"
done <<'KEYS'
cortex-version.mjs|never hand-edit a version
resolve_in_root|a destructive shell tool routes through the guard
capability:|every ritual declares a floor
disable-model-invocation|the rituals that may not auto-fire
--offers|the worklist is the wizard's script
install-on-a-project.test.sh|the one test that asserts the product works
coverage.mjs|coverage has a single home
CORTEX_PROFILE|profile is declared, never detected
consent gate|cortex-install never writes before the user chooses
cortex-skill-graph.mjs|a ritual must be reachable, or declare what reaches it
A pass is weaker|and that a green graph check does not prove it — only one outbound edge is needed
KEYS

# --- and are no longer in two places ---------------------------------------------------------------

# The point of the move was one home per rule. If a bullet gets pasted back into AGENTS.md, the two
# copies drift — which is exactly what happened between the root and the leaves before this.
assert_not_contains "$root" "resolve_in_root" "AGENTS.md no longer restates the shell guard"
assert_not_contains "$root" "install-on-a-project.test.sh" "nor the product test"

# --- every link resolves FROM THE FILE'S OWN DIRECTORY ----------------------------------------------

# Relative links are why this assertion is fussy. The bullets moved out of AGENTS.md at the repo root,
# where `docs/adr/x.md` was correct; from `docs/` that same string means `docs/docs/adr/x.md`. All
# eight ADR links broke in the move, and the first version of this check resolved them from the repo
# root and called them fine. Resolve from where the file lives, or the check is theatre.
#
# It is also why the link list is extracted with grep -o and cut rather than a sed backreference:
# this file was first generated through a JS string, which ate the backslashes, and the resulting
# pattern silently matched nothing. A loop that never runs reports no dead links.
dead=""
for l in $(grep -o ']([^)]*)' "$DOC" | cut -c 3- | tr -d ')' | sort -u); do
  case "$l" in http*) continue ;; esac
  [ -e "$REPO_ROOT/docs/$l" ] || dead="$dead $l"
done
if [ -n "$dead" ]; then
  _fail "every link resolves from docs/, where the file lives" "dead:$dead"
else
  _pass "every link resolves from docs/, where the file lives"
fi

# The check above is only meaningful if it found links at all. An empty extraction passes silently,
# which is precisely the bug that shipped in the first draft.
found="$(grep -c -o ']([^)]*)' "$DOC")"
if [ "$found" -ge 8 ]; then
  _pass "and actually examined $found links rather than none"
else
  _fail "and actually examined links rather than none" "extracted only $found"
fi
