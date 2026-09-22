#!/usr/bin/env bash
# Blocks edits to generated and frozen paths. The list came from what the index actually saw —
# confirm it rather than trusting it, because a hook matching nothing is a control that reports
# success forever.
#
# A block explains itself. Exit 2 blocks the action and sends the message to Claude, so the reason
# and the route to approval have to be IN the message; a bare refusal teaches the user only that
# Claude stopped.
set -uo pipefail

# Fail CLOSED. Claude Code treats any exit other than 2 as a non-blocking error, so the first
# version — `jq` under `set -e` — let every edit through on a machine without jq: the script died
# with 127 and the guard reported nothing. jq is preferred, a sed read is the fallback, and input
# that names a file_path neither can extract is refused rather than waved on.
input=$(cat)
if command -v jq >/dev/null 2>&1; then
  path=$(printf '%s' "$input" | jq -r '.tool_input.file_path // empty' 2>/dev/null)
else
  path=$(printf '%s' "$input" | sed -n 's/.*"file_path"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1)
fi
if [ -z "$path" ]; then
  case "$input" in
    *'"file_path"'*)
      echo "protected-paths: could not read the file path from the hook input, so the edit is blocked." >&2
      echo "Install jq, or check .claude/hooks/protected-paths.sh against the current hook input format." >&2
      exit 2
      ;;
  esac
  exit 0
fi

# {{PROTECTED_LIST}}
protected=(
{{PROTECTED_PATTERNS}}
)

for pattern in "${protected[@]}"; do
  case "$path" in
    $pattern)
      echo "Refusing to edit $path — it is generated or frozen." >&2
      echo "Change the source it is generated from, or get an owner to lift the freeze." >&2
      exit 2
      ;;
  esac
done
exit 0
