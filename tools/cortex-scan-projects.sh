#!/usr/bin/env bash
# cortex-scan-projects.sh — register + auto-refresh the vault's knowledge of your code projects.
#
# Walks a code root (default: the parent of the vault, or $1), finds every git repo, and writes a
# metadata + last-commit stub to projects/<slug>.md — then wires them all into a Projects MOC so
# they're connected in the graph. Re-run any time (or on a schedule) to auto-update from the latest
# commit. Metadata + git log only — never opens source files (privacy firewall).
#
# Usage: bash tools/cortex-scan-projects.sh [CODE_ROOT]
set -uo pipefail

VAULT="$(cd "$(dirname "$0")/.." && pwd)"
ROOT="${1:-$(cd "$VAULT/.." && pwd)}"          # default: folder containing the vault (e.g. D:/Projects/Personal)
# If the vault sits under D:/Projects/Personal, scan the whole D:/Projects tree:
case "$ROOT" in */Personal|*/personal) ROOT="$(cd "$ROOT/.." && pwd)";; esac
TODAY="$(date +%Y-%m-%d 2>/dev/null || echo 2026-07-01)"
mkdir -p "$VAULT/projects"

slugify() { echo "$1" | tr '[:upper:]' '[:lower:]' | tr ' _' '--' | sed 's/[^a-z0-9-]//g'; }

# Repos with no commit in this many days are collapsed into a Projects Map row instead of
# getting their own stub page. Override: DORMANT_DAYS=365 bash tools/cortex-scan-projects.sh
DORMANT_DAYS="${DORMANT_DAYS:-180}"
NOW_EPOCH="$(date +%s 2>/dev/null || echo 0)"

declare -A SEEN
MOC_PERSONAL=""; MOC_BRAIN=""; MOC_OTHER=""; MOC_DORMANT=""; COUNT=0; SKIP=0; DORMANT=0; WORKSKIP=0

detect_stack() {
  local repo="$1" fw="" lang="app"
  if [ -f "$repo/package.json" ]; then
    local dep; dep="$(cat "$repo/package.json")"
    case "$dep" in
      *'"next"'*) fw="Next.js";; *'"react-native"'*) fw="React Native";;
      *'"expo"'*) fw="Expo";; *'"@remix-run'*) fw="Remix";;
      *'"vue"'*) fw="Vue";; *'"svelte"'*) fw="Svelte";;
      *'"express"'*) fw="Express";; *'"react"'*) fw="React";; *) fw="Node";;
    esac
    { [ -f "$repo/tsconfig.json" ] || case "$dep" in *'"typescript"'*) true;; *) false;; esac; } && lang="TypeScript" || lang="JavaScript"
  elif [ -f "$repo/pubspec.yaml" ]; then fw="Flutter"; lang="Dart"
  elif [ -f "$repo/requirements.txt" ] || [ -f "$repo/pyproject.toml" ]; then fw="Python"; lang="Python"
  elif [ -f "$repo/go.mod" ]; then fw="Go"; lang="Go"
  else fw="—"; lang="—"; fi
  echo "$fw · $lang"
}

while IFS= read -r gitdir; do
  repo="$(dirname "$gitdir")"
  # skip the vault itself and the Flutter SDK clone
  [ "$repo" = "$VAULT" ] && continue
  url="$(git -C "$repo" remote get-url origin 2>/dev/null || echo '')"
  case "$url" in *flutter/flutter*) SKIP=$((SKIP+1)); continue;; esac
  # ── Employer firewall (AGENTS.md) ────────────────────────────────────────
  # A personal vault never registers work repos — not even name/path metadata.
  # Override the folder list with: WORK_DIRS='Work|Employer|ClientX'
  WORK_DIRS="${WORK_DIRS:-Work|work|Employer|employer|Clients|clients}"
  if echo "$repo" | grep -qE "/($WORK_DIRS)/"; then
    SKIP=$((SKIP+1)); WORKSKIP=$((WORKSKIP+1))
    rm -f "$VAULT/projects/$(slugify "$(basename "$repo")").md"   # purge any prior registration
    continue
  fi
  name="$(basename "$repo")"; slug="$(slugify "$name")"
  [ -z "$slug" ] && continue
  if [ -n "${SEEN[$slug]:-}" ]; then SKIP=$((SKIP+1)); continue; fi   # dedup by slug (first wins)
  SEEN[$slug]=1
  [ -z "$url" ] && url="—"
  brain="no"; { [ -f "$repo/AGENTS.md" ] || [ -d "$repo/.claude/skills/plan-feature" ]; } && brain="yes"
  stack="$(detect_stack "$repo")"
  recent="$(git -C "$repo" log -5 --format='- %ad `%h` %s' --date=short 2>/dev/null | cut -c1-100)"
  last1="$(git -C "$repo" log -1 --format='%ad · %s' --date=short 2>/dev/null | cut -c1-70)"
  tags="[project, codebase]"; [ "$brain" = "yes" ] && tags="[project, codebase, brain]"

  # ── Dormancy gate ────────────────────────────────────────────────────────
  # A repo untouched for DORMANT_DAYS gets a ROW in the Projects Map, not a page of its own.
  # Empty stub pages are pure graph noise: one node + one edge, zero knowledge. Rows keep the
  # metadata discoverable at a fraction of the cost. Reactivate simply by committing to the repo.
  lastepoch="$(git -C "$repo" log -1 --format='%at' 2>/dev/null || echo 0)"
  age_days=$(( ( NOW_EPOCH - ${lastepoch:-0} ) / 86400 ))
  if [ "${lastepoch:-0}" -gt 0 ] && [ "$age_days" -gt "$DORMANT_DAYS" ]; then
    MOC_DORMANT="$MOC_DORMANT| $name | $stack | ${last1%% ·*} | ${age_days}d | \`$repo\` |"$'\n'
    rm -f "$VAULT/projects/$slug.md"      # collapse a previously-generated stub
    DORMANT=$((DORMANT+1)); continue
  fi

  cat > "$VAULT/projects/$slug.md" <<EOF
---
id: $slug
title: $name
type: project
status: active
domain: personal
created: $TODAY
updated: $TODAY
last_compiled: $TODAY
tags: $tags
---
# $name

- **Local path:** \`$repo\`
- **Repo:** $url
- **Stack:** $stack
- **Codebase brain:** $brain
- **Last commit:** $last1

## Recent activity (auto — refreshed from last commits)
$recent

_Auto-managed by \`tools/cortex-scan-projects.sh\` — re-run to update from the latest commit._

## Outcome / notes
_Auto-generated stub — regenerated on each refresh. Keep durable per-project knowledge in the repo's own \`AGENTS.md\`, or \`capture\` it into the vault._

Part of [[projects-map]].
EOF

  line="- [[$slug]] — $stack — _${last1}_"
  if [ "$brain" = "yes" ]; then MOC_BRAIN="$MOC_BRAIN$line"$'\n'
  elif case "$repo" in */Personal/*) true;; *) false;; esac; then MOC_PERSONAL="$MOC_PERSONAL$line"$'\n'
  else MOC_OTHER="$MOC_OTHER$line"$'\n'; fi
  COUNT=$((COUNT+1))
done < <(find "$ROOT" -maxdepth 3 -type d -name .git -not -path '*/node_modules/*' 2>/dev/null | sort)

# Projects Map of Content — connects every project stub into the graph
cat > "$VAULT/projects/projects-map.md" <<EOF
---
id: projects-map
title: Projects Map
type: hub
created: $TODAY
updated: $TODAY
last_compiled: $TODAY
tags: [moc, projects]
---
# 🗂️ Projects Map

## Executive Context
Every personal code project Cortex tracks, auto-registered from \`$ROOT\` (metadata + git log only —
never source). Active repos get a page; repos dormant >${DORMANT_DAYS}d are rows here instead.

## High-Density Knowledge
- Refresh with \`bash tools/cortex-scan-projects.sh\`. Tune with \`DORMANT_DAYS=365\`.
- Active: $COUNT · Dormant: $DORMANT · Skipped (vault/SDK/dups): $SKIP.
- Work repos are **never** registered here — see the employer firewall in \`AGENTS.md\`.

## With a codebase brain
$MOC_BRAIN
## Personal projects
$MOC_PERSONAL
## Other
$MOC_OTHER
## Dormant (>${DORMANT_DAYS}d — collapsed, no page)

| Project | Stack | Last commit | Age | Path |
|---|---|---|---|---|
$MOC_DORMANT
> Commit to any of these and the next scan restores its page automatically.

## Downstream Connections
- [[home]] · [[about-business]] — what these projects are for
EOF

# Link the MOC from home.md so it's reachable (append once)
if [ -f "$VAULT/home.md" ] && ! grep -q '\[\[projects-map\]\]' "$VAULT/home.md" 2>/dev/null; then
  printf '\n## Projects\n- [[projects-map]] — all code projects Cortex knows (auto-registered).\n' >> "$VAULT/home.md"
fi

echo "✓ registered/refreshed $COUNT project(s), $DORMANT dormant (rows only), skipped $SKIP (vault/SDK/dups${WORKSKIP:+, $WORKSKIP work-firewalled}) from $ROOT"
echo "  → projects/*.md + projects/projects-map.md (linked from home.md)"
