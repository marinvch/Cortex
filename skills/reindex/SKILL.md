---
name: reindex
description: Keep the vault navigable as it grows. Regenerate the visual navigator (graph + search), nominate topics that need a Map of Content, and resolve dead links. Use periodically or when the vault feels hard to navigate. Triggers — "reindex", "rebuild the graph/navigator", "find dead links", "what needs a MOC", "tidy the vault".
capability: mechanical
---

# /reindex — keep navigation healthy as the brain grows

Plain files scale only if navigation keeps up. This ritual refreshes the views, surfaces where the
vault is outgrowing its structure, and fixes broken links. No engine — bash + judgement.

## Step 1 — Regenerate the views
Run the generators so the visual map reflects reality:
- `bash tools/cortex.sh` → `cortex.html` (Obsidian-style force graph + type-to-find search).
- `bash tools/cortex.sh` → `cortex.html` (repos + vault dashboard).
Report the counts (notes, links, dead, orphans).

## Step 2 — Nominate Maps of Content (the "levels" that scale)
Cortex navigates by **MOCs**, not deep folders (folders fight `[[wikilinks]]`). Scan for clusters:
- Group `notes/` by shared `tags:` and by what links to what. **Any topic with ~7+ related notes
  that has no `type: moc` note is a MOC candidate.**
- For each candidate, offer to create one from `templates/moc.md`, fill it with the cluster's notes,
  and link it from `home.md` under "Maps of Content". This is how the vault grows in navigable levels.

## Step 3 — Resolve dead links (genuine ones only)
The generator already ignores placeholders (examples, templates, archives, commented/code links).
For each remaining dead `[[target]]`, pick with the user:
- **Create** — it should exist → make the note from a template (promote the link to a real note).
- **Fix** — it's a typo/rename → correct the link to the right note.
- **Remove** — it was never meant to be a link → unlink it, or wrap example syntax in backticks
  (`` `[[like-this]]` ``) so it's never counted again.

## Step 4 — Structure health (light-touch)
- **`daily/` getting big?** Suggest foldering by year (`daily/2026/`) — the one place chronological
  volume needs levels. Offer to move past years; never restructure `notes/` into deep folders.
- **Orphans** (notes with no links): list them; a note with no links is a dead end — suggest linking
  each into a MOC or the relevant note.
- Make sure new MOCs are linked from `home.md` so nothing is stranded.

## Step 5 — Close
Summarise: views regenerated, MOCs created/suggested, dead links resolved, orphans flagged. Suggest
re-running `/reindex` on a cadence (e.g. with `/weekly-review`).

## Rules
- Navigate by MOCs + links, not folder depth. One filename idioms; keep it boring.
- Never bulk-move `notes/`. Time-foldering `daily/` is the only physical restructure offered.
- The AI is the semantic layer: well-tagged, MOC-linked notes let any agent retrieve the right
  context cheaply. Structure feeds retrieval — that's the "semantic index", no embeddings needed.
