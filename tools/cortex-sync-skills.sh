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
# Mirror-only skills are REPORTED, NEVER REMOVED BY DEFAULT. A directory that exists only in the
# mirror may be machine-local work that exists nowhere else — deleting it would be unrecoverable,
# since the mirror is gitignored and therefore has no history to restore from.
#
# But two mirror-only directories are not the same thing, and until the ledger below they were
# indistinguishable: one this tool wrote and canonical has since deleted (recoverable — the
# deletion is in git), and one a person or a parallel session created here and nowhere else
# (unrecoverable). `.claude/skills/.cortex-sync-state` records what THIS tool mirrored, with a
# content digest, so the report can tell them apart. The default stays "not mine, leave it":
# no state file, an unreadable one, or a digest that no longer matches all mean "not mine".
#
#   bash tools/cortex-sync-skills.sh                     # sync, then report
#   bash tools/cortex-sync-skills.sh --check             # report only; exit 1 if out of sync
#   bash tools/cortex-sync-skills.sh --prune-mirrored    # sync, then remove ONLY the directories
#                                                        # this tool wrote that canonical deleted
#                                                        # and that still match their digest
#
set -euo pipefail

LIB="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_cortex-lib.sh"
# shellcheck source=/dev/null
. "$LIB" || { echo "cortex: cannot load $LIB" >&2; exit 1; }

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/skills"
MIRROR_REL=".claude/skills"
DST="$ROOT/$MIRROR_REL"
STATE="$DST/.cortex-sync-state"
STATE_VERSION="cortex-sync-state v1"

CHECK=0
PRUNE=0
for arg in "$@"; do
  case "$arg" in
    "")               ;;                # an empty positional from a caller's "${2:-}" is not a flag
    --check)          CHECK=1 ;;
    --prune-mirrored) PRUNE=1 ;;
    -h|--help)        sed -n '2,28p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option: $arg" >&2; exit 1 ;;
  esac
done

# --check is read-only, and a flag that deletes is not. Refusing the combination is clearer than
# silently letting one win.
if [ "$CHECK" -eq 1 ] && [ "$PRUNE" -eq 1 ]; then
  echo "cortex: --check is read-only; it cannot be combined with --prune-mirrored" >&2
  exit 1
fi

[ -d "$SRC" ] || { echo "cortex: no skills/ at $SRC" >&2; exit 1; }

# A cheap content digest of one mirrored skill directory: every file's relative path and its cksum,
# hashed again. `cksum` is POSIX and present wherever bash is; sha256sum is not (macOS ships
# `shasum`). This detects a directory that has been edited since we wrote it, which is all the
# ledger claims — it is not a tamper seal, and nothing here treats it as one.
dir_digest(){ # dir
  ( cd "$1" 2>/dev/null || return 1
    find . -type f | LC_ALL=C sort | while IFS= read -r f; do
      printf '%s ' "$f"; cksum < "$f"
    done | cksum | tr -d ' \n' )
}

# --- the ledger --------------------------------------------------------------
#
# Read it only if the header line is exactly right, and keep only lines that are two tab-separated
# fields whose name is a single path component. Anything else — missing file, wrong header, a
# truncated write, a name carrying a traversal — leaves that entry unknown, and unknown means "not
# mine, never touch it". The failure mode to design against is the opposite one: a peer harness's
# install ledger claimed ownership of a file it had not written and its uninstall deleted the
# user's work.
STATE_BODY=""
state_ok=0
if [ -f "$STATE" ] && [ "$(head -n 1 "$STATE" 2>/dev/null)" = "$STATE_VERSION" ]; then
  STATE_BODY="$(tail -n +2 "$STATE" | awk -F'\t' 'NF == 2 && $1 != "" && $2 != "" && $2 !~ /\// && $2 != "." && $2 != ".." { print }')"
  state_ok=1
fi

state_digest_of(){ # name -> the digest we recorded, or nothing
  [ "$state_ok" -eq 1 ] || return 0
  printf '%s\n' "$STATE_BODY" | awk -F'\t' -v n="$1" '$2 == n { print $1; exit }'
}

# --- survey ------------------------------------------------------------------

missing=(); differing=()
mirror_ours=()      # we wrote it, canonical has since deleted it, and it still matches
mirror_drifted=()   # we wrote it, but it has been edited here since — not ours to remove
mirror_unknown=()   # nothing recorded — assume a person put it here

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
    [ -d "$SRC/$name" ] && continue
    recorded="$(state_digest_of "$name")"
    if [ -z "$recorded" ]; then
      mirror_unknown+=("$name")
    elif [ "$recorded" = "$(dir_digest "$DST/$name")" ]; then
      mirror_ours+=("$name")
    else
      mirror_drifted+=("$name")
    fi
  done
fi

report() {
  echo "canonical skills/: $(find "$SRC" -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ')"
  echo "mirrored .claude/skills/: $([ -d "$DST" ] && find "$DST" -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ' || echo 0)"
  [ ${#missing[@]} -gt 0 ]   && echo "missing from mirror (${#missing[@]}): ${missing[*]}"
  [ ${#differing[@]} -gt 0 ] && echo "differs from canonical (${#differing[@]}): ${differing[*]}"
  # None of the three is a defect. All are named so nobody "cleans up" the wrong one.
  [ ${#mirror_ours[@]} -gt 0 ] && \
    echo "mirror-only, mirrored by this tool; canonical deleted it (${#mirror_ours[@]}): ${mirror_ours[*]} — removable with --prune-mirrored"
  [ ${#mirror_drifted[@]} -gt 0 ] && \
    echo "mirror-only, mirrored then edited here — left alone (${#mirror_drifted[@]}): ${mirror_drifted[*]}"
  [ ${#mirror_unknown[@]} -gt 0 ] && \
    echo "mirror-only, not mirrored by this tool — left alone (${#mirror_unknown[@]}): ${mirror_unknown[*]}"
  [ "$state_ok" -eq 1 ] || echo "no sync ledger yet — every mirror-only directory is treated as yours"
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

# --- write -------------------------------------------------------------------

mkdir -p "$DST"

# The deletion below is the destructive act this tool performs, so its target goes through the
# shared root guard (ADR 0010) rather than through `${DST:?}` alone. That expansion only proves the
# variable is non-empty; it resolves nothing. If `.claude/skills` is a symlink pointing out of the
# repo — or becomes one — every `rm -rf` in this loop lands outside the root, and a string-prefix
# comparison would not notice.
new_state=""
for path in "$SRC"/*/; do
  name="$(basename "$path")"
  target="$(resolve_in_root "$ROOT" "$MIRROR_REL/$name")" || {
    echo "refusing: $MIRROR_REL/$name resolves outside the repo root ($ROOT)" >&2
    echo "the mirror, or a path component of it, points somewhere this tool must not delete." >&2
    exit 1
  }
  rm -rf "${target:?}"      # replace wholesale, so a deleted file in canonical does not linger
  cp -r "$SRC/$name" "$DST/$name"
  new_state="$new_state$(dir_digest "$DST/$name")	$name
"
done

if [ "$PRUNE" -eq 1 ] && [ ${#mirror_ours[@]} -gt 0 ]; then
  for name in "${mirror_ours[@]}"; do
    target="$(resolve_in_root "$ROOT" "$MIRROR_REL/$name")" || {
      echo "refusing to prune: $MIRROR_REL/$name resolves outside the repo root ($ROOT)" >&2
      exit 1
    }
    rm -rf "${target:?}"
    echo "pruned (we wrote it, canonical deleted it): $name"
  done
fi

# Carry forward what we already recorded for directories canonical no longer has, so a skill
# deleted upstream stays recognisable as ours on the next run instead of reverting to "not mine".
# Entries whose directory is gone from the mirror are dropped — including anything just pruned.
if [ "$state_ok" -eq 1 ]; then
  while IFS=$'\t' read -r d n; do
    [ -n "${n:-}" ] || continue
    [ -d "$SRC/$n" ] && continue
    [ -d "$DST/$n" ] || continue
    new_state="$new_state$d	$n
"
  done <<EOF
$STATE_BODY
EOF
fi

state_tmp="$(mktemp "$DST/.cortex-sync-state.XXXXXX")"
{
  printf '%s\n' "$STATE_VERSION"
  printf '# Written by tools/cortex-sync-skills.sh: what this tool mirrored, and a cksum digest of\n'
  printf '# what it wrote. Gitignored on purpose. Delete this file and every mirror-only directory\n'
  printf '# is treated as yours again — the safe answer, since nothing here is ever removed by\n'
  printf '# default. Format: <digest>\\t<skill-name>, one per line.\n'
  printf '%s' "$new_state"
} > "$state_tmp"
mv "$state_tmp" "$STATE"

echo "synced ${#missing[@]} missing + ${#differing[@]} stale skill(s) into .claude/skills/"
[ ${#mirror_drifted[@]} -gt 0 ] && \
  echo "left alone (mirrored then edited here): ${mirror_drifted[*]}"
[ ${#mirror_unknown[@]} -gt 0 ] && \
  echo "left alone (mirror-only, not mirrored by this tool): ${mirror_unknown[*]}"
[ ${#mirror_ours[@]} -gt 0 ] && [ "$PRUNE" -eq 0 ] && \
  echo "left alone (mirrored by this tool, canonical deleted it — --prune-mirrored removes these): ${mirror_ours[*]}"
echo "restart the session (or /reload) for new /slash commands to appear"
