#!/usr/bin/env bash
# Formats the one file Claude just edited, with the formatter this repo declares. The list came from
# config files the index found — a formatter nobody configured rewrites every touched file in a
# style nobody chose, so where nothing was detected there are no case lines and this does nothing.
#
# A PostToolUse hook runs after the edit has already happened, so there is nothing left to block:
# every path through this script exits 0, including input it cannot read and a formatter that fails
# or is not installed. Formatting is a courtesy here; the lint command at commit time is the check.
set -uo pipefail

input=$(cat)
if command -v jq >/dev/null 2>&1; then
  path=$(printf '%s' "$input" | jq -r '.tool_input.file_path // empty' 2>/dev/null)
else
  path=$(printf '%s' "$input" | sed -n 's/.*"file_path"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1)
fi
[ -n "$path" ] && [ -f "$path" ] || exit 0

# One line per detected formatter, in the order loop.mjs lists them — for example
#   *.go) gofmt -w "$path" >/dev/null 2>&1 ;;
case "$path" in
{{FORMAT_CASES}}
esac
exit 0
