# archives/ holds one lifecycle: your vault's personal removals, ignored in full.
#
# It used to hold two. The product's own retired pieces — the Node installer, the engine-era
# framework docs, the old view scripts — sat in archives/ next to personal content, so the ignore
# rules needed six lines and two negations to say which half was shareable. Every negation is a
# chance to get it backwards, and getting it backwards in THIS folder means committing something
# that was archived to keep it private.
#
# The product half is its git log and CHANGELOG.md now, so this folder has one lifecycle again.
# This pins it.

. "$(dirname "${BASH_SOURCE[0]}")/_helpers.sh"   # $WORK or refuse — see the gate there

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

# --- product docs are NOT loaded as knowledge ---------------------------------------------------

# .cortexignore is the single source of truth for "not knowledge". Product docs must not be indexed
# as vault knowledge — recalling an ADR or a changelog line as a note would hand an agent product
# instructions as if they were the user's own.
assert_contains "$(cat "$REPO_ROOT/.cortexignore")" "docs/" "docs/ is excluded from the knowledge graph"

# Nothing may point at the old locations.
stale="$(git grep -ln 'archives/retired-views\|archives/stale-engine\|archives/cortex-init.mjs.legacy\|archives/alive-os-framework\|archives/getting-started\|archives/quick-reference' -- ':!CHANGELOG.md' ':!tools/test/*' || true)"
assert_eq "" "$stale" "no file still points at the pre-move archive paths"

# --- pages the retired generators wrote stay ignored ---------------------------------------------
#
# cortex-brain.sh and cortex-nav.sh are gone, but what they wrote lists the vault's note titles and
# an old checkout still has it on disk. An audit read the matching ignore rules as dead because the
# generators were retired, removed them, and three such pages already on disk went untracked in the
# same commit (#420). Deleting the generator does not delete its output.

for p in brain.html navigator.html cortex-graph.html; do
  if git check-ignore -q "$p"; then _pass "generated view $p is ignored"; else _fail "generated view $p is ignored" "it is NOT ignored — a page of personal note titles is committable"; fi
done
