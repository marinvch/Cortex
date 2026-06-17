#!/usr/bin/env bash
# package_skill.sh — Package a skill folder into a distributable .skill ZIP.
#
# Usage: package_skill.sh <skill-folder> [output-dir]
#
# Validates the skill, then creates <skill-name>.skill (ZIP) containing all
# skill files (excluding __pycache__, node_modules, *.pyc, .DS_Store, and
# the top-level evals/ directory).
#
# If output-dir is omitted, the archive is written to the current directory.
#
# Dependencies: zip, jq (for quick_validate.sh)

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── Argument parsing ──────────────────────────────────────────────────────────
if [[ $# -lt 1 ]]; then
  echo "Usage: package_skill.sh <skill-folder> [output-dir]" >&2
  exit 1
fi
skill_input="$1"
output_dir="${2:-$PWD}"

# ── Resolve skill path ────────────────────────────────────────────────────────
skill_path="$(cd "$skill_input" 2>/dev/null && pwd)" || {
  echo "Error: skill folder not found: $skill_input" >&2
  exit 1
}
skill_md="$skill_path/SKILL.md"
[[ -f "$skill_md" ]] || { echo "Error: SKILL.md not found in $skill_path" >&2; exit 1; }

skill_name=$(basename "$skill_path")
skill_parent=$(dirname "$skill_path")

# ── Validate ──────────────────────────────────────────────────────────────────
# Source quick_validate.sh to obtain validate_skill() without running the script
# shellcheck source=quick_validate.sh
source "$SCRIPT_DIR/quick_validate.sh"
validate_skill "$skill_path" || { echo "Error: skill validation failed" >&2; exit 1; }

# ── Prepare output ────────────────────────────────────────────────────────────
[[ -d "$output_dir" ]] || mkdir -p "$output_dir"
output_dir="$(cd "$output_dir" && pwd)"  # absolute
output_file="$output_dir/${skill_name}.skill"
rm -f "$output_file"

# ── Build file list (exclusions mirror package_skill.py) ─────────────────────
# ROOT_EXCLUDE_DIRS = {"evals"} → only exclude direct child "evals/" of skill root
mapfile -d '' file_list < <(
  find "$skill_path" -type f \
    -not -path "*/__pycache__/*" \
    -not -path "*/node_modules/*" \
    -not -name "*.pyc" \
    -not -name ".DS_Store" \
    -not -path "${skill_path}/evals/*" \
    -print0 | sort -z
)

[[ ${#file_list[@]} -gt 0 ]] || {
  echo "Error: no files to package in $skill_path" >&2
  exit 1
}

# ── Create ZIP from skill parent so arcnames are skill-name/file.ext ──────────
(
  cd "$skill_parent"
  for abs_file in "${file_list[@]}"; do
    rel_file="${abs_file#${skill_parent}/}"
    echo "  Adding: $rel_file" >&2
    zip -q "$output_file" "$rel_file"
  done
)

echo "Created: $output_file ($(unzip -z "$output_file" 2>/dev/null | tail -1 || echo '?') files)" >&2
echo "$output_file"
