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

# resolve_in_root <root> <path> — echo the absolute path, or exit non-zero if it escapes <root>.
#
# The shell counterpart of core/paths.js. ADR 0007 made mcp/lib/vault.js the only door onto a vault
# root because a caller-supplied path can escape it; the bash tools kept a bare `$(pwd)` and would
# happily archive a file they were never pointed at. This lives here, not in cortex-rm.sh, so the
# next destructive tool inherits it instead of re-deriving it — "five modules had to remember" is
# the exact failure ADR 0007 was written about.
#
# No `realpath`: it is not present on macOS by default. `cd` + `pwd -P` is POSIX and resolves
# symlinks, which a string-prefix comparison does not — `<root>/link/x` where `link` points outside
# passes any prefix check and is still an escape.
resolve_in_root(){
  local root="$1" rel="$2" rroot parent base cand rparent abs
  rroot="$(cd "$root" 2>/dev/null && pwd -P)" || return 1
  case "$rel" in
    /*) cand="$rel" ;;
    *)  cand="$rroot/$rel" ;;
  esac
  # Walk up to the deepest ancestor that exists, so a target that does not exist yet still resolves
  # — the guard runs before a create, not only before a read.
  parent="$(dirname "$cand")"; base="$(basename "$cand")"
  while [ ! -d "$parent" ] && [ "$parent" != "/" ] && [ "$parent" != "." ]; do
    base="$(basename "$parent")/$base"
    parent="$(dirname "$parent")"
  done
  rparent="$(cd "$parent" 2>/dev/null && pwd -P)" || return 1
  abs="$rparent/$base"
  case "$abs" in
    "$rroot"|"$rroot"/*) printf '%s\n' "$abs" ;;
    *) return 1 ;;
  esac
}

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
