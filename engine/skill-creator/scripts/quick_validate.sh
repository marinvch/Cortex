#!/usr/bin/env bash
# quick_validate.sh — Validates a skill directory's SKILL.md.
# Usage: bash quick_validate.sh <skill_dir>
# Exit 0 = valid, exit 1 = invalid.
# Also sourceable: provides validate_skill() function.

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/utils.sh"

# validate_skill <skill_dir>
# Returns 0 if valid, 1 if invalid (prints reason to stderr).
validate_skill() {
  local skill_dir="$1"
  local skill_file="$skill_dir/SKILL.md"

  # 1. SKILL.md must exist
  if [[ ! -f "$skill_file" ]]; then
    echo "INVALID: SKILL.md not found in $skill_dir" >&2
    return 1
  fi

  # 2. Parse frontmatter
  if ! parse_skill_md "$skill_dir"; then
    return 1
  fi

  # 3. Check only allowed keys appear in frontmatter
  local allowed_keys=("name" "description" "license" "allowed-tools" "metadata" "compatibility")
  local frontmatter
  frontmatter="$(awk '
    BEGIN { in_fm=0; found_start=0 }
    /^---[[:space:]]*$/ {
      if (!found_start) { found_start=1; in_fm=1; next }
      else if (in_fm) { in_fm=0; exit }
    }
    in_fm { print }
  ' "$skill_file")"

  # Extract top-level keys (lines starting with a word character followed by colon)
  while IFS= read -r key; do
    [[ -z "$key" ]] && continue
    local is_allowed=false
    for allowed in "${allowed_keys[@]}"; do
      if [[ "$key" == "$allowed" ]]; then
        is_allowed=true
        break
      fi
    done
    if [[ "$is_allowed" == false ]]; then
      echo "INVALID: Unknown frontmatter key: '$key'" >&2
      return 1
    fi
  done < <(echo "$frontmatter" | grep -E '^[a-zA-Z][a-zA-Z0-9_-]*:' | sed 's/:.*//')

  # 4. Validate name: kebab-case [a-z0-9-]+, no leading/trailing/double hyphens, max 64 chars
  local name="$SKILL_NAME"

  if [[ ${#name} -gt 64 ]]; then
    echo "INVALID: 'name' exceeds 64 characters: '$name'" >&2
    return 1
  fi

  if ! echo "$name" | grep -qE '^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$'; then
    echo "INVALID: 'name' must be kebab-case [a-z0-9-] with no leading/trailing hyphens: '$name'" >&2
    return 1
  fi

  if echo "$name" | grep -q '\-\-'; then
    echo "INVALID: 'name' must not contain consecutive hyphens: '$name'" >&2
    return 1
  fi

  # 5. Validate description: no angle brackets, max 1024 chars
  local desc="$SKILL_DESCRIPTION"

  if [[ ${#desc} -gt 1024 ]]; then
    echo "INVALID: 'description' exceeds 1024 characters (${#desc} chars)" >&2
    return 1
  fi

  if echo "$desc" | grep -q '[<>]'; then
    echo "INVALID: 'description' must not contain angle brackets (< >)" >&2
    return 1
  fi

  echo "VALID: $name" >&2
  return 0
}

# Run as standalone script if not being sourced
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  if [[ $# -lt 1 ]]; then
    echo "Usage: $0 <skill_dir>" >&2
    exit 1
  fi

  if validate_skill "$1"; then
    exit 0
  else
    exit 1
  fi
fi
