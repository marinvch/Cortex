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

declare -A SEEN
MOC_PERSONAL=""; MOC_BRAIN=""; MOC_OTHER=""; COUNT=0; SKIP=0

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

  cat > "$VAULT/projects/$slug.md" <<EOF
---
type: project
title: $name
status: active
domain: personal
created: $TODAY
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
type: moc
title: Projects Map
created: $TODAY
tags: [moc, projects]
---
# 🗂️ Projects Map

Every code project Cortex knows about, auto-registered from \`$ROOT\`.
Refresh with \`bash tools/cortex-scan-projects.sh\`. Linked from [[home]].

## With a codebase brain
$MOC_BRAIN
## Personal projects
$MOC_PERSONAL
## Other / work
$MOC_OTHER
EOF

# Link the MOC from home.md so it's reachable (append once)
if [ -f "$VAULT/home.md" ] && ! grep -q '\[\[projects-map\]\]' "$VAULT/home.md" 2>/dev/null; then
  printf '\n## Projects\n- [[projects-map]] — all code projects Cortex knows (auto-registered).\n' >> "$VAULT/home.md"
fi

echo "✓ registered/refreshed $COUNT project(s), skipped $SKIP (vault/SDK/dups) from $ROOT"
echo "  → projects/*.md + projects/projects-map.md (linked from home.md)"
