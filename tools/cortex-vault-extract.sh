#!/usr/bin/env bash
# cortex-vault-extract.sh — move the personal vault out of the Cortex repo.
#
# Cortex is now a context manager for codebases; the personal second brain lives in its own
# private repo. This script copies the personal layer out and (only when told to) removes it here.
#
# DRY RUN BY DEFAULT. It prints what it would do and changes nothing until you pass --apply.
#
#   bash tools/cortex-vault-extract.sh --to ~/cortex-brain            # preview
#   bash tools/cortex-vault-extract.sh --to ~/cortex-brain --apply    # copy
#   bash tools/cortex-vault-extract.sh --to ~/cortex-brain --apply --remove-source
#
# The personal layer is gitignored here, so it exists only in your working tree. That means a
# careless delete is unrecoverable — hence copy first, verify, and remove as a separate opt-in.

set -euo pipefail

DEST=""
APPLY=0
REMOVE=0
INIT_GIT=1

# Everything gitignored as personal. Keep in step with .gitignore's personal-layer block.
PERSONAL_DIRS=(context inbox daily notes projects areas resources decisions brain)
PERSONAL_FILES=(home.md)

usage() {
  sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'
  exit "${1:-0}"
}

while [ $# -gt 0 ]; do
  case "$1" in
    --to) DEST="${2:-}"; shift 2 ;;
    --apply) APPLY=1; shift ;;
    --remove-source) REMOVE=1; shift ;;
    --no-git) INIT_GIT=0; shift ;;
    -h|--help) usage 0 ;;
    *) echo "unknown option: $1" >&2; usage 1 ;;
  esac
done

[ -n "$DEST" ] || { echo "error: --to <path> is required" >&2; usage 1; }

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

[ -f "AGENTS.md" ] || { echo "error: run this from the Cortex repo" >&2; exit 1; }

if [ "$APPLY" -eq 0 ]; then
  echo "DRY RUN — nothing will be written. Add --apply to perform the move."
  echo
fi
echo "source:      $ROOT"
echo "destination: $DEST"
echo

total=0
plan=()
for d in "${PERSONAL_DIRS[@]}"; do
  [ -d "$d" ] || continue
  # Count only real content; a directory holding just its placeholder is not worth moving.
  n=$(find "$d" -type f ! -name '.gitkeep' ! -name 'README.md' | wc -l | tr -d ' ')
  [ "$n" -eq 0 ] && continue
  plan+=("$d")
  total=$((total + n))
  printf '  %-12s %4s files\n' "$d/" "$n"
done
for f in "${PERSONAL_FILES[@]}"; do
  [ -f "$f" ] || continue
  plan+=("$f")
  total=$((total + 1))
  printf '  %-12s %4s file\n' "$f" 1
done

echo
if [ "$total" -eq 0 ]; then
  echo "Nothing to extract — no personal content found."
  exit 0
fi
echo "$total files would move."

if [ "$APPLY" -eq 0 ]; then
  echo
  echo "Re-run with --apply to copy. The source is left in place unless you also pass"
  echo "--remove-source, which is deliberately a second, separate decision."
  exit 0
fi

mkdir -p "$DEST"
for p in "${plan[@]}"; do
  echo "copying $p"
  if [ -d "$p" ]; then
    mkdir -p "$DEST/$p"
    # -a preserves timestamps so the vault's own date-based rituals keep working.
    cp -a "$p/." "$DEST/$p/"
  else
    cp -a "$p" "$DEST/$p"
  fi
done

copied=$(find "$DEST" -type f ! -path '*/.git/*' | wc -l | tr -d ' ')
echo
echo "copied $copied files into $DEST"

if [ "$INIT_GIT" -eq 1 ] && [ ! -d "$DEST/.git" ]; then
  echo "initialising a git repo in $DEST"
  git -C "$DEST" init --quiet
  cat > "$DEST/.gitignore" <<'IGNORE'
# This vault is private. Nothing here is meant to be published.
.DS_Store
*.bak
IGNORE
  echo "NOTE: $DEST has no remote. If you push it, push it to a PRIVATE repository."
fi

if [ "$REMOVE" -eq 1 ]; then
  if [ "$copied" -lt "$total" ]; then
    echo "refusing to remove the source: copied $copied but expected at least $total" >&2
    exit 1
  fi
  echo
  echo "removing the personal layer from $ROOT"
  for p in "${plan[@]}"; do
    if [ -d "$p" ]; then
      find "$p" -type f ! -name '.gitkeep' ! -name 'README.md' -delete
      find "$p" -type d -empty -delete 2>/dev/null || true
      mkdir -p "$p"
    else
      rm -f "$p"
    fi
  done
  echo "done — placeholders and tracked READMEs were kept so the repo structure still reads."
else
  echo
  echo "Source left in place. Verify $DEST, then re-run with --remove-source to clear it here."
fi
