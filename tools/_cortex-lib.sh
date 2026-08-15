#!/usr/bin/env bash
# Shared Cortex helpers, sourced by the vault-root tools (cortex.sh, cortex-rm.sh,
# cortex-scan-projects.sh). cortex-init.sh deliberately does NOT source this — it is a standalone
# installer with zero runtime deps — so it keeps its own copy of the slug rule, pinned by
# mcp/test/slug-parity.test.js.

# The canonical Cortex slug rule: lowercase, every run of non-alphanumerics becomes one `-`, and
# leading/trailing `-` are trimmed. Must stay behaviourally identical to mcp/lib/slug.js; the
# parity test above pins them together. Do not "improve" one copy alone.
slugify(){ printf '%s' "$1" | tr 'A-Z' 'a-z' | sed -E 's/[^a-z0-9]+/-/g; s/^-+|-+$//g'; }

# A note id is a slug of a filename with a trailing `.md` dropped first, so `Note.MD`, `note.md`
# and a bare `[[note]]` wikilink all resolve to the same graph node. The viewer emits an identical
# slug() into the generated HTML — that copy is pinned by the same parity test.
note_id(){ printf '%s' "$1" | tr 'A-Z' 'a-z' | sed -E 's/\.md$//; s/[^a-z0-9]+/-/g; s/^-+|-+$//g'; }

# knowledge_files <root> lists the real knowledge notes — everything NOT matched by
# <root>/.cortexignore. This is the single source of truth for "what is noise".
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
