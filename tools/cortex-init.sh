#!/usr/bin/env bash
# cortex-init.sh — install a plain-files "codebase brain" into any repo. Zero runtime deps:
# pure POSIX-ish bash (works in git-bash, zsh, WSL, Linux, macOS). No Node, no Python.
#
#   bash cortex-init.sh                         # interactive
#   bash cortex-init.sh --yes                   # accept detected defaults
#   bash cortex-init.sh --name App --purpose "..." --agents claude,gemini
#   bash cortex-init.sh --additive              # refresh skills only
#   bash cortex-init.sh --register-to-vault ~/vault
#   bash cortex-init.sh --no-plugins            # skip stamping .claude/settings.json (Core plugin bundle)
#
# Writes only inside the current repo (existing files backed up to *.bak), except
# --register-to-vault, which writes one metadata-only stub into the vault.
set -u

CWD="$(pwd)"
TODAY="$(date +%Y-%m-%d)"
STAMP="$(date +%Y%m%d-%H%M%S)"
WRITTEN=()
MADE_BACKUPS=0

# ── tiny helpers ──────────────────────────────────────────────────────────────
has(){ [ -e "$CWD/$1" ]; }
slurp(){ [ -f "$CWD/$1" ] && cat "$CWD/$1" 2>/dev/null || true; }
# json_str FILE KEY  → first "KEY": "value" string (no jq dependency)
json_str(){ slurp "$1" | tr -d '\n' | grep -oE "\"$2\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" | head -1 | sed -E "s/.*:[[:space:]]*\"([^\"]*)\".*/\1/"; }
# dep_present FILE NAME → 0 if "NAME" appears as a dependency key
dep_present(){ slurp "$1" | grep -qE -- "$2"; }
say(){ printf '%s\n' "$1"; }

backup_if_exists(){ # $1 = abs path
  if [ -e "$1" ]; then
    local bak="$1.bak"; [ -e "$bak" ] && bak="$1.bak.$STAMP"
    cp "$1" "$bak"; MADE_BACKUPS=1; printf '  (old → %s)\n' "$(basename "$bak")"
  fi
}
write_file(){ # $1 = repo-relative path, $2 = content
  local abs="$CWD/$1"; mkdir -p "$(dirname "$abs")"
  local note; note="$(backup_if_exists "$abs")"
  printf '%s' "$2" > "$abs"; WRITTEN+=("$1"); printf '  ✓ %s%s\n' "$1" "$note"
}
# write a shim only if absent or clearly ours (small + mentions AGENTS.md)
write_shim(){ local p="$CWD/$1"
  if [ -e "$p" ]; then local c; c="$(cat "$p")"
    if ! { [ "${#c}" -lt 320 ] && printf '%s' "$c" | grep -q "AGENTS.md"; }; then
      printf '  ↷ kept your %s (not overwritten)\n' "$1"; return; fi
  fi
  write_file "$1" "$2"
}

# ── 1. parse args ─────────────────────────────────────────────────────────────
A_NAME=""; A_PURPOSE=""; A_RULE=""; A_AGENTS=""; YES=0; ADDITIVE=0; REGISTER=""; NO_PLUGINS=0
while [ $# -gt 0 ]; do case "$1" in
  --name) A_NAME="${2:-}"; shift 2;;            --name=*) A_NAME="${1#*=}"; shift;;
  --purpose) A_PURPOSE="${2:-}"; shift 2;;      --purpose=*) A_PURPOSE="${1#*=}"; shift;;
  --rule) A_RULE="${2:-}"; shift 2;;            --rule=*) A_RULE="${1#*=}"; shift;;
  --agents) A_AGENTS="${2:-}"; shift 2;;        --agents=*) A_AGENTS="${1#*=}"; shift;;
  --register-to-vault) REGISTER="${2:-}"; shift 2;; --register-to-vault=*) REGISTER="${1#*=}"; shift;;
  --yes|-y) YES=1; shift;;
  --additive|--skip-instructions) ADDITIVE=1; shift;;
  --no-plugins) NO_PLUGINS=1; shift;;
  --help|-h) sed -n '2,18p' "$0" | sed 's/^# \{0,1\}//'; exit 0;;
  *) printf '  (ignoring unknown arg: %s)\n' "$1"; shift;;
esac; done

say ""; say "  cortex-init — stamping a codebase brain (bash, no runtime deps)"; say ""

# ── 2. scan the repo ──────────────────────────────────────────────────────────
NAME="$(json_str package.json name)"; [ -z "$NAME" ] && NAME="$(basename "$CWD")"
PURPOSE_DEF="$(slurp README.md | grep -vE '^\s*#|^\s*$' | head -1 | sed -E 's/^[>*-]+\s*//')"
LANG="JavaScript"; has tsconfig.json && LANG="TypeScript"
PM="npm"; has pnpm-lock.yaml && PM="pnpm"; has yarn.lock && PM="yarn"; has bun.lockb && PM="bun"
FW=""
dep_present package.json '"next"' && FW="Next.js"
[ -z "$FW" ] && dep_present package.json '"nuxt"' && FW="Nuxt"
[ -z "$FW" ] && dep_present package.json '"@remix-run' && FW="Remix"
[ -z "$FW" ] && dep_present package.json '"vue"' && FW="Vue"
[ -z "$FW" ] && dep_present package.json '"svelte"' && FW="Svelte"
[ -z "$FW" ] && dep_present package.json '"react"' && FW="React"
[ -z "$FW" ] && dep_present package.json '"express"' && FW="Express"
[ -z "$FW" ] && FW="(generic)"
DEV="$(json_str package.json dev)"; [ -n "$(slurp package.json | grep -oE '"dev"[[:space:]]*:')" ] && DEV="$PM run dev"
BUILD=""; slurp package.json | grep -qE '"build"[[:space:]]*:' && BUILD="$PM run build"
TEST=""; slurp package.json | grep -qE '"test"[[:space:]]*:' && TEST="$PM test"
LINT=""; slurp package.json | grep -qE '"lint"[[:space:]]*:' && LINT="$PM run lint"
TSSTRICT=0; slurp tsconfig.json | grep -qE '"strict"[[:space:]]*:[[:space:]]*true' && TSSTRICT=1
ALIAS="$(slurp tsconfig.json | tr -d '\n ' | grep -oE '"@/\*":\[[^]]*\]' | head -1)"
ESLINT=0; { has .eslintrc.json || has .eslintrc.js || has eslint.config.mjs || has eslint.config.js; } && ESLINT=1
PRETTIER=0; { has .prettierrc || has .prettierrc.json || has prettier.config.js; } && PRETTIER=1
CI=0; { [ -d "$CWD/.github/workflows" ] || has .gitlab-ci.yml; } && CI=1
ARCH=""; for d in src app lib pages components server api routes; do [ -d "$CWD/$d" ] && ARCH="$ARCH $d"; done
ARCH="$(printf '%s' "$ARCH" | sed 's/^ //')"

say "  Detected:"
say "    name: $NAME · $FW · $LANG · $PM"
say "    run:  dev='${DEV:-?}' build='${BUILD:-?}' test='${TEST:-?}' lint='${LINT:-?}'"
TOOL=""; [ $TSSTRICT -eq 1 ] && TOOL="strict TS"; [ -n "$ALIAS" ] && TOOL="$TOOL, alias @/*"
[ $ESLINT -eq 1 ] && TOOL="$TOOL, ESLint"; [ $PRETTIER -eq 1 ] && TOOL="$TOOL, Prettier"; [ $CI -eq 1 ] && TOOL="$TOOL, CI"
say "    tooling: $(printf '%s' "${TOOL:- (none)}")"
say "    dirs: ${ARCH:-(none found)}"; say ""

# ── 2b. detect a pre-existing OLD engine-based AI OS ──────────────────────────
detect_engine(){ local m=()
  has .ai-os && m+=(".ai-os/ (engine MCP server)")
  has .github/ai-os && m+=(".github/ai-os/ (engine context + memory store)")
  has .github/agents && m+=(".github/agents/ (engine-generated agents)")
  has .github/COPILOT_CONTEXT.md && m+=(".github/COPILOT_CONTEXT.md")
  { slurp .mcp.json; slurp .vscode/mcp.json; } | grep -qE 'ai-os|AI_OS_ROOT' && m+=("ai-os MCP entry")
  slurp .github/copilot-instructions.md | grep -qiE 'get_session_context|AI OS' && m+=(".github/copilot-instructions.md (engine-style)")
  printf '%s\n' "${m[@]}"; }
ENGINE_FOUND=0; ENGINE_LIST="$(detect_engine | grep -v '^$' || true)"
if [ -n "$ENGINE_LIST" ]; then ENGINE_FOUND=1
  say "  ⚠ Old engine-based AI OS detected in this repo:"
  printf '%s\n' "$ENGINE_LIST" | sed 's/^/     - /'
  say "    To avoid LOSING the engine's accumulated memory, migrate before relying on AGENTS.md:"
  say "      → Open this repo in Claude Code / Cowork and run  /migrate-engine"
  say "    (harvests the memory store into AGENTS.md, then removes the old files)."; say ""
fi

# ── 2c. suggest skills for the detected stack ─────────────────────────────────
SUGGEST=()
case "$FW" in Next.js|React|Remix) SUGGEST+=("vercel-react-best-practices — React/Next patterns & perf");; esac
dep_present package.json '"@modelcontextprotocol' && SUGGEST+=("mcp-builder — you have an MCP SDK dep")
{ has prisma || dep_present package.json '"prisma"'; } && SUGGEST+=("investigate-bug — DB/Prisma flows benefit from root-cause discipline")
[ -z "$TEST" ] && SUGGEST+=("(no test script found) — consider adding vitest/playwright before trusting CI")
if [ ${#SUGGEST[@]} -gt 0 ]; then
  say "  Suggested skills for this stack:"; printf '%s\n' "${SUGGEST[@]}" | sed 's/^/     • /'
  say "    Enable with: cp -r <vault>/skills/* .claude/skills/   (or say \"run my <skill> skill\")"; say ""
fi

# ── 3. gather inputs (flags > interactive > defaults) ─────────────────────────
NAME="${A_NAME:-$NAME}"
if [ $YES -eq 0 ] && [ -t 0 ] && [ -z "$A_NAME$A_PURPOSE$A_RULE$A_AGENTS" ]; then
  printf '  Project name [%s]: ' "$NAME"; read -r r; [ -n "$r" ] && NAME="$r"
  printf '  One line — what does this project do? [%s]: ' "$PURPOSE_DEF"; read -r r; PURPOSE="${r:-$PURPOSE_DEF}"
  printf '  Any key rule the AI must follow? (optional): '; read -r RULE
  printf '  Shims for which agents? (claude,gemini,copilot,cursor or all) [all]: '; read -r AG; AGENTS="${AG:-all}"
else
  PURPOSE="${A_PURPOSE:-$PURPOSE_DEF}"; RULE="$A_RULE"; AGENTS="${A_AGENTS:-all}"
  say "  Non-interactive: using flags/detected defaults."; say ""
fi
AGENTS="$(printf '%s' "$AGENTS" | tr 'A-Z' 'a-z')"
want(){ [ "$AGENTS" = "all" ] || printf '%s' "$AGENTS" | grep -q "$1"; }

# ── 4. compose AGENTS.md ──────────────────────────────────────────────────────
RUN_LINES="- install: \`$PM install\`"
[ -n "$DEV" ]   && RUN_LINES="$RUN_LINES"$'\n'"- dev: \`$DEV\`"
[ -n "$BUILD" ] && RUN_LINES="$RUN_LINES"$'\n'"- build: \`$BUILD\`"
[ -n "$TEST" ]  && RUN_LINES="$RUN_LINES"$'\n'"- test: \`$TEST\`" || RUN_LINES="$RUN_LINES"$'\n'"- test: (none configured — add one before trusting CI)"
[ -n "$LINT" ]  && RUN_LINES="$RUN_LINES"$'\n'"- lint: \`$LINT\`"
ARCH_LINES=""; for d in $ARCH; do ARCH_LINES="$ARCH_LINES- \`$d/\` — <what lives here>"$'\n'; done
[ -z "$ARCH_LINES" ] && ARCH_LINES="- <map the key directories here>"$'\n'
RULE_LINE=""; [ -n "$RULE" ] && RULE_LINE="- **Project rule:** $RULE"$'\n'

AGENTS_MD="# $NAME — Project Brain (codebase-scoped)
<!-- Generated by cortex-init. Single source of truth; agent shims just point here. -->

## What this is
${PURPOSE:-<one paragraph: what this app does, who uses it>}

## Stack & tooling
- Framework: $FW · Language: $LANG · Pkg mgr: $PM
- Tooling: $(printf '%s' "${TOOL:- (none detected)}")

## Run it
$RUN_LINES

## Architecture (key directories)
$ARCH_LINES
## Area map (scoped briefs - load the brief for the part you touch)
_None yet. Run /cortex-brief <dir> on a critical area (auth, billing, a pipeline) to add a deep AGENTS.md leaf, then list it here._

## Conventions
$RULE_LINE- Validate external inputs at the boundary; keep business logic out of UI components.
- Match existing file/naming conventions; prefer early returns; async/await over .then().
- Never commit secrets. Standard to hold: clear, maintainable, scalable code.

## Development cycle (the hard rule)
1. **Plan before implementing.** No code until there's a written plan (use \`/plan-feature\`).
2. Break the plan into small, reviewable steps; run lint/tests after each.
3. Self-review against the conventions above before opening a PR.
For bugs: find root cause before proposing a fix (use \`/investigate-bug\`).

## Gotchas / tribal knowledge
- <quirks, flaky areas, build traps — grows over time>

## Glossary
- <domain terms specific to this codebase>
"

# ── 5. write the brain ────────────────────────────────────────────────────────
say "  Writing the brain..."
if [ $ADDITIVE -eq 0 ]; then
  if has AGENTS.md && ! slurp AGENTS.md | grep -q 'Generated by cortex-init'; then
    write_file AGENTS.generated.md "$AGENTS_MD"
    say "  ↷ kept your curated AGENTS.md — wrote AGENTS.generated.md to diff"
  else write_file AGENTS.md "$AGENTS_MD"; fi
  want claude  && write_shim CLAUDE.md "@AGENTS.md"$'\n'
  want gemini  && write_shim GEMINI.md "See AGENTS.md at the repo root for all project context, architecture, and conventions."$'\n'
  want copilot && write_shim .github/copilot-instructions.md "All project context and conventions live in \`AGENTS.md\` at the repo root. Read and follow it."$'\n'
  want cursor  && write_shim .cursor/rules/project.mdc "---"$'\n'"alwaysApply: true"$'\n'"---"$'\n'"Read AGENTS.md at the repo root for architecture, conventions, and the development cycle."$'\n'
else say "  (--additive: leaving AGENTS.md + shims untouched; refreshing skills only)"; fi

write_file .claude/skills/plan-feature/SKILL.md "---
name: plan-feature
description: Write an implementation plan for a feature/ticket in THIS repo before any code. Enforces plan-before-implementing.
---
# /plan-feature
Read AGENTS.md for stack + conventions. Produce a plan ONLY (no code):
1. Restate the requirement + acceptance criteria; ask for missing ones.
2. List files/components this touches (search the repo to confirm).
3. Design: data flow, states (loading/empty/error), edge cases.
4. Break into small ordered steps, each independently testable.
5. Risks + a test plan. End by asking the user to approve before implementing.
"
write_file .claude/skills/investigate-bug/SKILL.md "---
name: investigate-bug
description: Systematically investigate a bug in THIS repo. Find root cause before proposing a fix.
---
# /investigate-bug
1. Reproduce: expected vs actual; find where it's triggered.
2. Trace the data/render path; form a root-cause hypothesis (don't patch symptoms).
3. Confirm root cause with evidence.
4. Propose the smallest correct fix + how to verify. Plan before editing.
"
has docs/decisions.md || write_file docs/decisions.md "# Decision Log — $NAME

Append-only. Newest on top. Record why a technical call was made so it isn't re-litigated.
"

# ── 5b. stamp Claude Code plugin settings (Core tier) ─────────────────────────
# Mirrors plugins/cortex-core-plugins.json → tiers.core. Kept hardcoded here (not parsed via
# jq from that manifest) so this installer keeps running with zero required deps.
CORE_PLUGINS=(superpowers skill-creator claude-md-management claude-code-setup feature-dev code-review code-simplifier context7)
PLUGIN_MARKETPLACE="claude-plugins-official"
PLUGIN_MARKETPLACE_REPO="anthropics/claude-plugins-official"

PLUGIN_STAMPED=0
stamp_plugin_settings(){
  local rel=".claude/settings.json" abs="$CWD/.claude/settings.json" content=""
  if command -v jq >/dev/null 2>&1; then
    local plugins_json marketplace_json
    plugins_json="$(printf '%s\n' "${CORE_PLUGINS[@]}" | jq -R -s -c --arg mp "$PLUGIN_MARKETPLACE" \
      'split("\n") | map(select(length > 0)) | map({(. + "@" + $mp): true}) | add')"
    marketplace_json="$(jq -n --arg name "$PLUGIN_MARKETPLACE" --arg repo "$PLUGIN_MARKETPLACE_REPO" \
      '{($name): {source: {source: "github", repo: $repo}}}')"
    if [ -f "$abs" ]; then
      content="$(jq --argjson mk "$marketplace_json" --argjson pl "$plugins_json" \
        '.extraKnownMarketplaces = ((.extraKnownMarketplaces // {}) * $mk)
         | .enabledPlugins = ((.enabledPlugins // {}) * $pl)' \
        "$abs" 2>/dev/null)"
      if [ -z "$content" ]; then
        say "  ⚠ .claude/settings.json exists but isn't valid JSON — left untouched (merge skipped)"
        return
      fi
    else
      content="$(jq -n --argjson mk "$marketplace_json" --argjson pl "$plugins_json" \
        '{extraKnownMarketplaces: $mk, enabledPlugins: $pl}')"
    fi
    write_file "$rel" "$content"$'\n'
  else
    if [ -f "$abs" ]; then
      say "  ↷ .claude/settings.json exists and jq isn't installed — left untouched"
      say "    (add the Core plugin bundle manually; see references/cortex-plugins.md)"
      return
    fi
    local pairs=() p
    for p in "${CORE_PLUGINS[@]}"; do pairs+=("    \"$p@$PLUGIN_MARKETPLACE\": true"); done
    local enabled_lines; enabled_lines="$(printf '%s,\n' "${pairs[@]}")"; enabled_lines="${enabled_lines%,}"
    content="{
  \"extraKnownMarketplaces\": {
    \"$PLUGIN_MARKETPLACE\": { \"source\": { \"source\": \"github\", \"repo\": \"$PLUGIN_MARKETPLACE_REPO\" } }
  },
  \"enabledPlugins\": {
$enabled_lines
  }
}"
    write_file "$rel" "$content"$'\n'
  fi
  PLUGIN_STAMPED=1
}
if [ $NO_PLUGINS -eq 0 ]; then
  stamp_plugin_settings
else
  say "  (--no-plugins: skipping .claude/settings.json plugin bundle stamp)"
fi

# ── 6. gitignore awareness ────────────────────────────────────────────────────
if command -v git >/dev/null 2>&1 && git -C "$CWD" rev-parse >/dev/null 2>&1; then
  IGN="$(git -C "$CWD" check-ignore "${WRITTEN[@]}" 2>/dev/null || true)"
  if [ -n "$IGN" ]; then
    say ""; say "  ⚠ These generated files are gitignored — teammates won't get them on clone:"
    printf '%s\n' "$IGN" | sed 's/^/     - /'
    say "     Remove the ignore rule, or commit with: git add -f"
  fi
fi

# ── 7. optional vault registration (metadata only) ────────────────────────────
if [ -n "$REGISTER" ]; then
  VROOT="${REGISTER/#\~/$HOME}"
  if [ -d "$VROOT" ]; then
    SLUG="$(printf '%s' "$NAME" | tr 'A-Z' 'a-z' | sed -E 's/[^a-z0-9]+/-/g; s/^-+|-+$//g')"; [ -z "$SLUG" ] && SLUG=project
    mkdir -p "$VROOT/projects"
    printf -- "---\ntype: project\ntitle: %s\nstatus: active\nstack: %s, %s, %s\npath: %s\ncreated: %s\ntags: [project, registered]\n---\n\n> Metadata-only stub registered by cortex-init on %s. No code, secrets, or client data.\n" \
      "$NAME" "$FW" "$LANG" "$PM" "$CWD" "$TODAY" "$TODAY" > "$VROOT/projects/$SLUG.md"
    say ""; say "  ✓ registered (metadata only) → $VROOT/projects/$SLUG.md"
  else say ""; say "  ⚠ --register-to-vault: vault not found at $VROOT (skipped)."; fi
fi

# ── 8. done ───────────────────────────────────────────────────────────────────
say ""; say "  ✅ Done. This repo now has a brain."
say "  For a deep, AI-driven pass that fills Architecture/Conventions/Gotchas from the"
say "  actual code, open this repo in Claude Code and run /install-project."
  say "  For critical parts (auth, billing, a pipeline), run /cortex-brief to give them a deep brief."
if [ $PLUGIN_STAMPED -eq 1 ]; then
  say "  Stamped the Core plugin bundle into .claude/settings.json (superpowers, skill-creator,"
  say "  claude-md-management, claude-code-setup, feature-dev, code-review, code-simplifier, context7)."
fi
if [ $ENGINE_FOUND -eq 1 ]; then
  say ""; say "  ⚠ Reminder: an old engine is still here. Run /migrate-engine to rescue its"
  say "    memory into AGENTS.md before removing it — otherwise that knowledge is lost."
fi
say ""
