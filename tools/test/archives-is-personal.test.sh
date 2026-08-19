# archives/ holds one lifecycle: your vault's personal removals, ignored in full.
#
# It used to hold two. The product's own retired pieces — the Node installer, the engine-era
# framework docs, the old view scripts — sat in archives/ next to personal content, so the ignore
# rules needed six lines and two negations to say which half was shareable. Every negation is a
# chance to get it backwards, and getting it backwards in THIS folder means committing something
# that was archived to keep it private.
#
# The product half is docs/history/ now. This pins both halves.

cd "$REPO_ROOT" || exit 1

# --- the personal half is ignored, with exactly one exception -----------------------------------

for p in archives/removed/a-note.md archives/work-stuff-2026-08-03/leak.md archives/anything.md; do
  if git check-ignore -q "$p"; then _pass "archives/ ignores $p"; else _fail "archives/ ignores $p" "it is NOT ignored — anything archived here would be committable"; fi
done

if git check-ignore -q archives/README.md; then
  _fail "archives/README.md stays tracked" "it is ignored, so the folder ships with no explanation"
else
  _pass "archives/README.md stays tracked"
fi

# The whole promise of the folder. If a tracked file ever appears here again, the rule has rotted
# back to two lifecycles and the negation dance is about to come back with it.
tracked="$(git ls-files archives | grep -v '^archives/README.md$' || true)"
assert_eq "" "$tracked" "nothing but the README is tracked under archives/"

# --- the product half is tracked and is NOT loaded as knowledge ---------------------------------

[ -f docs/history/README.md ] && _pass "docs/history/ explains itself" || _fail "docs/history/ explains itself"

count="$(git ls-files docs/history | wc -l | tr -d ' ')"
if [ "$count" -gt 1 ]; then _pass "docs/history/ is tracked ($count files)"; else _fail "docs/history/ is tracked" "only $count file(s)"; fi

# .cortexignore is the single source of truth for "not knowledge". Product history must not be
# indexed as vault knowledge — it describes a Cortex that no longer exists, so recalling it would
# hand an agent retired instructions as if they were current.
assert_contains "$(cat "$REPO_ROOT/.cortexignore")" "docs/" "docs/ is excluded from the knowledge graph"

# Nothing may point at the old locations.
stale="$(git grep -ln 'archives/retired-views\|archives/stale-engine\|archives/cortex-init.mjs.legacy\|archives/alive-os-framework\|archives/getting-started\|archives/quick-reference' -- ':!CHANGELOG.md' ':!*/plans/*' ':!*/specs/*' ':!docs/history/*' ':!tools/test/*' || true)"
assert_eq "" "$stale" "no file still points at the pre-move archive paths"
