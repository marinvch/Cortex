#!/usr/bin/env bash
# update-projects.sh — Update AI OS in one or more repositories
#
# Usage:
#   bash scripts/update-projects.sh [OPTIONS] [DIR...]
#
# Options:
#   --search-dir DIR   Root directory to recursively scan for AI OS installs (default: $HOME)
#   --dry-run          Print matching repos without updating
#   --depth N          Max search depth (default: 5)
#   --help             Show this help message
#
# Examples:
#   # Update a single project
#   bash scripts/update-projects.sh /path/to/my-project
#
#   # Find and update all AI OS repos under ~/Projects
#   bash scripts/update-projects.sh --search-dir ~/Projects
#
#   # Preview what would be updated (no changes)
#   bash scripts/update-projects.sh --search-dir ~/Projects --dry-run
#
# What it does:
#   For each repo with .github/ai-os/manifest.json the script runs:
#     npx -y github:marinvch/ai-os --update --cwd <repo>
#   which performs a full AI OS refresh: regenerates context docs, updates the
#   MCP server bundle, and bumps the manifest version.

set -euo pipefail

# ── Defaults ──────────────────────────────────────────────────────────────────
SEARCH_DIR=""
DRY_RUN=false
MAX_DEPTH=5
EXPLICIT_DIRS=()

# ── Parse arguments ────────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --search-dir)
      SEARCH_DIR="${2:?'--search-dir requires a value'}"
      shift 2
      ;;
    --depth)
      MAX_DEPTH="${2:?'--depth requires a value'}"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    --help|-h)
      head -n 30 "$0" | grep '^#' | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    -*)
      echo "Unknown option: $1" >&2
      exit 1
      ;;
    *)
      EXPLICIT_DIRS+=("$1")
      shift
      ;;
  esac
done

# ── Helper: check node ─────────────────────────────────────────────────────────
if ! command -v node &>/dev/null; then
  echo "Error: Node.js is required but not found in PATH." >&2
  exit 1
fi

NODE_MAJOR=$(node -e "process.stdout.write(process.versions.node.split('.')[0])")
if [[ "$NODE_MAJOR" -lt 20 ]]; then
  echo "Error: Node.js >= 20 required (found $NODE_MAJOR)." >&2
  exit 1
fi

# ── Resolve repos to update ────────────────────────────────────────────────────
REPOS=()

if [[ ${#EXPLICIT_DIRS[@]} -gt 0 ]]; then
  # Explicit paths: verify each has an AI OS manifest
  for dir in "${EXPLICIT_DIRS[@]}"; do
    abs_dir="$(cd "$dir" && pwd)"
    if [[ -f "$abs_dir/.github/ai-os/manifest.json" ]]; then
      REPOS+=("$abs_dir")
    else
      echo "Warning: $abs_dir does not have .github/ai-os/manifest.json — skipping." >&2
    fi
  done
else
  # Recursive search
  SCAN_ROOT="${SEARCH_DIR:-$HOME}"
  echo "Scanning for AI OS repositories under: $SCAN_ROOT (depth: $MAX_DEPTH)"
  echo ""

  while IFS= read -r manifest; do
    repo_dir="$(dirname "$(dirname "$(dirname "$manifest")")")"
    REPOS+=("$repo_dir")
  done < <(find "$SCAN_ROOT" -maxdepth "$MAX_DEPTH" \
      -name "manifest.json" \
      -path "*/.github/ai-os/manifest.json" \
      2>/dev/null | sort)
fi

# ── Summary ────────────────────────────────────────────────────────────────────
if [[ ${#REPOS[@]} -eq 0 ]]; then
  echo "No AI OS repositories found."
  exit 0
fi

echo "Found ${#REPOS[@]} AI OS repository/repositories:"
for repo in "${REPOS[@]}"; do
  installed_ver=""
  if [[ -f "$repo/.github/ai-os/manifest.json" ]]; then
    installed_ver=$(node -e "try{const m=require('$repo/.github/ai-os/manifest.json');process.stdout.write(m.version||'')}catch{}" 2>/dev/null || true)
  fi
  echo "  • $repo${installed_ver:+  (v$installed_ver)}"
done
echo ""

if $DRY_RUN; then
  echo "(dry-run) No updates applied."
  exit 0
fi

# ── Update each repo ──────────────────────────────────────────────────────────
SUCCESS=0
FAILED=0

for repo in "${REPOS[@]}"; do
  echo "───────────────────────────────────────────────────────────"
  echo "Updating: $repo"
  echo ""

  if npx -y github:marinvch/ai-os --update --cwd "$repo"; then
    SUCCESS=$((SUCCESS + 1))
  else
    echo "Warning: Update failed for $repo" >&2
    FAILED=$((FAILED + 1))
  fi

  echo ""
done

echo "═══════════════════════════════════════════════════════════"
echo "Update complete: $SUCCESS succeeded, $FAILED failed."
if [[ $FAILED -gt 0 ]]; then
  exit 1
fi
