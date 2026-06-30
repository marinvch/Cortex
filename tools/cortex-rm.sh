#!/usr/bin/env bash
# cortex-rm.sh — remove a note the Cortex way: ARCHIVE it (move, don't delete), strip inbound
# [[wikilinks]] so no dead links remain, and regenerate the viewer. Usage:
#   bash tools/cortex-rm.sh <relative/path/to/note.md>
set -u
ROOT="$(pwd)"; F="${1:-}"
[ -z "$F" ] && { echo "usage: bash tools/cortex-rm.sh <relative-md-path>"; exit 1; }
[ -f "$ROOT/$F" ] || { echo "not found: $F"; exit 1; }
SLUG="$(basename "$F" .md | tr 'A-Z' 'a-z' | sed -E 's/[^a-z0-9]+/-/g; s/^-+|-+$//g')"
STAMP="$(date +%Y%m%d-%H%M%S)"
mkdir -p archives/removed
mv "$ROOT/$F" "archives/removed/$(basename "$F" .md).$STAMP.md"
echo "✓ archived → archives/removed/$(basename "$F" .md).$STAMP.md"
# de-link inbound references (alias kept; bare link → readable text). Skip archives/.git.
touched=0
while IFS= read -r ref; do
  [ -z "$ref" ] && continue
  sed -i -E "s/\[\[$SLUG\|([^]]+)\]\]/\1/g; s/\[\[$SLUG(#[^]|]*)?\]\]/$SLUG/g" "$ref"
  echo "  · de-linked: ${ref#./}"; touched=$((touched+1))
done < <(grep -rln "\[\[$SLUG" --include=*.md . 2>/dev/null | grep -vE 'archives/|\.git/')
echo "✓ updated $touched file(s) that linked to it"
# regenerate the viewer if present
[ -f tools/cortex.sh ] && bash tools/cortex.sh >/dev/null 2>&1 && echo "✓ cortex.html regenerated"
echo "Done. (Recover from archives/removed/ if needed.)"
