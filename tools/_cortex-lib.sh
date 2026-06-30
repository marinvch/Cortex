#!/usr/bin/env bash
# Shared Cortex helpers. knowledge_files <root> lists the real knowledge notes — everything NOT
# matched by <root>/.cortexignore. This is the single source of truth for "what is noise".
knowledge_files(){
  local root="${1:-.}"
  ( cd "$root" 2>/dev/null || return
    local pf; pf="$(mktemp)"
    if [ -f .cortexignore ]; then
      while IFS= read -r pat; do
        pat="${pat%%#*}"; pat="$(printf '%s' "$pat" | sed -e 's/[[:space:]]*$//' -e 's/^[[:space:]]*//')"
        [ -z "$pat" ] && continue
        case "$pat" in
          */)    d="$(printf '%s' "${pat%/}" | sed 's/\./\\./g')"; printf '(^|/)%s/\n' "$d" >> "$pf" ;;
          *\**)  g="$(printf '%s' "$pat" | sed -e 's/\./\\./g' -e 's@\*@[^/]*@g')"; printf '(^|/)%s$\n' "$g" >> "$pf" ;;
          *)     n="$(printf '%s' "$pat" | sed 's/\./\\./g')"; printf '(^|/)%s$\n' "$n" >> "$pf" ;;
        esac
      done < .cortexignore
    fi
    find . -type f -name '*.md' 2>/dev/null | sed 's#^\./##' \
      | { if [ -s "$pf" ]; then grep -vEf "$pf"; else cat; fi; } | sort
    rm -f "$pf" )
}
