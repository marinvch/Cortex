#!/usr/bin/env bash
# cortex-rm.sh — remove a note the Cortex way: ARCHIVE it (move, don't delete), strip inbound
# [[wikilinks]] so no dead links remain, and regenerate the viewer. Usage:
#   bash tools/cortex-rm.sh <relative/path/to/note.md>
set -u
LIB="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_cortex-lib.sh"
# shellcheck source=/dev/null
. "$LIB" || { echo "cortex: cannot load $LIB" >&2; exit 1; }
ROOT="$(pwd)"; F="${1:-}"
[ -z "$F" ] && { echo "usage: bash tools/cortex-rm.sh <relative-md-path>"; exit 1; }
# The target must sit inside the vault. Without this, `cortex-rm.sh ../outside/secret.md` moved a
# file from outside the vault into archives/removed/ — and the tool's whole promise is recovery
# ("archive, don't delete"), which it cannot keep for a file whose original location it has just
# erased from the record. Same invariant as ADR 0007, which the bash half never got.
ABS="$(resolve_in_root "$ROOT" "$F")" || {
  echo "refusing: '$F' resolves outside the vault root ($ROOT)" >&2
  echo "cortex-rm only archives notes inside the vault — it cannot recover anything else." >&2
  exit 1
}
[ -f "$ABS" ] || { echo "not found: $F"; exit 1; }
# Same note id the viewer's graph uses, so the de-link pass below finds every inbound [[wikilink]].
SLUG="$(note_id "$(basename "$F")")"
STAMP="$(date +%Y%m%d-%H%M%S)"
mkdir -p archives/removed
mv "$ABS" "archives/removed/$(basename "$F" .md).$STAMP.md"
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
