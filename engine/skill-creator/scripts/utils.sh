#!/usr/bin/env bash
# utils.sh — Shared library for skill-creator bash scripts.
# Source this file; it provides parse_skill_md() which sets globals:
#   SKILL_NAME, SKILL_DESCRIPTION, SKILL_CONTENT

set -euo pipefail

# parse_skill_md <skill_dir>
# Reads SKILL.md from <skill_dir>, parses YAML frontmatter, and sets:
#   SKILL_NAME        — value of "name:" key
#   SKILL_DESCRIPTION — value of "description:" key (handles block scalars)
#   SKILL_CONTENT     — full file content
parse_skill_md() {
  local skill_dir="$1"
  local skill_file="$skill_dir/SKILL.md"

  if [[ ! -f "$skill_file" ]]; then
    echo "ERROR: SKILL.md not found in $skill_dir" >&2
    return 1
  fi

  SKILL_CONTENT="$(cat "$skill_file")"

  # Use awk to extract YAML frontmatter between first pair of --- delimiters
  local frontmatter
  frontmatter="$(awk '
    BEGIN { in_fm=0; found_start=0 }
    /^---[[:space:]]*$/ {
      if (!found_start) { found_start=1; in_fm=1; next }
      else if (in_fm) { in_fm=0; exit }
    }
    in_fm { print }
  ' "$skill_file")"

  if [[ -z "$frontmatter" ]]; then
    echo "ERROR: No YAML frontmatter found in $skill_file" >&2
    return 1
  fi

  # Extract "name:" — always a simple inline value
  SKILL_NAME="$(echo "$frontmatter" | awk '/^name:/ { match($0, /^name:[[:space:]]*(.+)/, a); print a[1]; exit }')"
  # Trim surrounding quotes if present
  SKILL_NAME="${SKILL_NAME%\"}"
  SKILL_NAME="${SKILL_NAME#\"}"
  SKILL_NAME="${SKILL_NAME%\'}"
  SKILL_NAME="${SKILL_NAME#\'}"
  SKILL_NAME="${SKILL_NAME// /}"

  # Extract "description:" — may be inline or a block scalar (>, |, >-, |-)
  # Strategy: grab the line, then collect indented continuation lines
  SKILL_DESCRIPTION="$(echo "$frontmatter" | awk '
    BEGIN { in_desc=0; desc=""; first=1 }
    /^description:[[:space:]]*/ {
      in_desc=1
      # Get inline portion after "description:"
      val=$0
      sub(/^description:[[:space:]]*/, "", val)
      # If empty or a block indicator, value continues on next lines
      if (val == "" || val == ">" || val == "|" || val == ">-" || val == "|-" || val == ">+" || val == "|+") {
        # block scalar — accumulate next indented lines
        next
      }
      # Strip surrounding quotes
      gsub(/^["'"'"']|["'"'"']$/, "", val)
      desc=val
      in_desc=2  # done — inline value captured
      next
    }
    in_desc == 1 {
      # Collect indented continuation lines (block scalar body)
      if (/^[[:space:]]+/) {
        line=$0
        sub(/^[[:space:]]+/, "", line)
        if (first) { desc=line; first=0 }
        else { desc=desc " " line }
      } else {
        # Non-indented line ends the block
        in_desc=2
      }
      next
    }
    END { print desc }
  ')"

  # Trim surrounding whitespace from description
  SKILL_DESCRIPTION="${SKILL_DESCRIPTION#"${SKILL_DESCRIPTION%%[![:space:]]*}"}"
  SKILL_DESCRIPTION="${SKILL_DESCRIPTION%"${SKILL_DESCRIPTION##*[![:space:]]}"}"

  if [[ -z "$SKILL_NAME" ]]; then
    echo "ERROR: Could not parse 'name' from SKILL.md frontmatter" >&2
    return 1
  fi

  if [[ -z "$SKILL_DESCRIPTION" ]]; then
    echo "ERROR: Could not parse 'description' from SKILL.md frontmatter" >&2
    return 1
  fi
}
