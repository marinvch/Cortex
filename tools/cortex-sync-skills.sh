#!/usr/bin/env bash
# cortex-sync-skills.sh — refresh the local .claude/skills/ mirror from the canonical skills/.
#
# `skills/` is the canonical copy and the one an installed plugin loads. `.claude/skills/` is a
# gitignored, machine-local mirror that exposes the rituals as /slash commands in THIS checkout.
# Because it is gitignored, nothing keeps it current: the documented `cp -r skills/* .claude/skills/`
# is run once, never re-run, and never removes anything. It had drifted to 24 of 31 skills with 9
# local copies differing from canonical — so five of the v2.0 rituals were simply unavailable here.
#
# This script makes the refresh one idempotent command, and --check makes the drift visible.
#
# Mirror-only skills are REPORTED, NEVER REMOVED. A directory that exists only in the mirror is
# machine-local work that exists nowhere else — deleting it would be unrecoverable, since the
# mirror is gitignored and therefore has no history to restore from.
#
#   bash tools/cortex-sync-skills.sh            # sync, then report
#   bash tools/cortex-sync-skills.sh --check    # report only; exit 1 if out of sync
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/skills"
DST="$ROOT/.claude/skills"

CHECK=0
[ "${1:-}" = "--check" ] && CHECK=1

[ -d "$SRC" ] || { echo "cortex: no skills/ at $SRC" >&2; exit 1; }

missing=(); differing=(); mirror_only=()

for path in "$SRC"/*/; do
  name="$(basename "$path")"
  if [ ! -d "$DST/$name" ]; then
    missing+=("$name")
  elif ! diff -qr "$SRC/$name" "$DST/$name" >/dev/null 2>&1; then
    differing+=("$name")
  fi
done

if [ -d "$DST" ]; then
  for path in "$DST"/*/; do
    [ -e "$path" ] || continue
    name="$(basename "$path")"
    [ -d "$SRC/$name" ] || mirror_only+=("$name")
  done
fi

report() {
  echo "canonical skills/: $(find "$SRC" -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ')"
  echo "mirrored .claude/skills/: $([ -d "$DST" ] && find "$DST" -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ' || echo 0)"
  [ ${#missing[@]} -gt 0 ]     && echo "missing from mirror (${#missing[@]}): ${missing[*]}"
  [ ${#differing[@]} -gt 0 ]   && echo "differs from canonical (${#differing[@]}): ${differing[*]}"
  # Not a defect. Named so nobody "cleans it up" and loses it.
  [ ${#mirror_only[@]} -gt 0 ] && echo "mirror-only, left untouched (${#mirror_only[@]}): ${mirror_only[*]}"
  return 0
}

if [ "$CHECK" -eq 1 ]; then
  report
  if [ ${#missing[@]} -gt 0 ] || [ ${#differing[@]} -gt 0 ]; then
    echo "OUT OF SYNC — run: bash tools/cortex-sync-skills.sh"
    exit 1
  fi
  echo "in sync"
  exit 0
fi

mkdir -p "$DST"
for path in "$SRC"/*/; do
  name="$(basename "$path")"
  rm -rf "${DST:?}/$name"      # replace wholesale, so a deleted file in canonical does not linger
  cp -r "$SRC/$name" "$DST/$name"
done

echo "synced ${#missing[@]} missing + ${#differing[@]} stale skill(s) into .claude/skills/"
[ ${#mirror_only[@]} -gt 0 ] && echo "left alone (mirror-only, exists nowhere else): ${mirror_only[*]}"
echo "restart the session (or /reload) for new /slash commands to appear"
