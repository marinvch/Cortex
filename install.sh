#!/usr/bin/env bash
# =============================================================================
#  AI OS Installer — Portable Copilot Context Engine
#  Install on any repository with: bash install.sh
#  Requires: git bash, Node.js >= 20  (or Docker as fallback)
# =============================================================================

set -euo pipefail

# ── Colors ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
RESET='\033[0m'

# ── Banner ───────────────────────────────────────────────────────────────────
echo ""
echo -e "${CYAN}${BOLD}  ╔═══════════════════════════════════╗${RESET}"
echo -e "${CYAN}${BOLD}  ║          AI OS  v0.6.0            ║${RESET}"
echo -e "${CYAN}${BOLD}  ║  Portable Copilot Context Engine  ║${RESET}"
echo -e "${CYAN}${BOLD}  ╚═══════════════════════════════════╝${RESET}"
echo ""

# ── Determine this script's location ─────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── Determine target repo root ────────────────────────────────────────────────
TARGET_DIR=""
INSTALL_SKILL_CREATOR=false
INSTALL_FIND_SKILLS=false
REFRESH_EXISTING=false
CLEAN_UPDATE=false
UNINSTALL=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --cwd)
      TARGET_DIR="${2:-}"
      shift 2
      ;;
    --cwd=*)
      TARGET_DIR="${1#--cwd=}"
      shift
      ;;
    --install-skill-creator)
      INSTALL_SKILL_CREATOR=true
      shift
      ;;
    --install-find-skills)
      INSTALL_FIND_SKILLS=true
      shift
      ;;
    --refresh-existing)
      REFRESH_EXISTING=true
      shift
      ;;
    --clean-update)
      CLEAN_UPDATE=true
      REFRESH_EXISTING=true
      shift
      ;;
    --uninstall)
      UNINSTALL=true
      shift
      ;;
    *)
      shift
      ;;
  esac
done

if [[ -z "$TARGET_DIR" ]]; then
  # Default: the current working directory (where install.sh was invoked from)
  TARGET_DIR="$(pwd)"
fi

# Normalize to absolute path
TARGET_DIR="$(cd "$TARGET_DIR" && pwd)"

echo -e "  ${BOLD}Target repository:${RESET} $TARGET_DIR"
echo ""

# ── Uninstall mode (#12) ─────────────────────────────────────────────────────
if [[ "$UNINSTALL" == "true" ]]; then
  MANIFEST="$TARGET_DIR/.github/ai-os/manifest.json"
  if [[ ! -f "$MANIFEST" ]]; then
    echo -e "  ${YELLOW}⚠ No AI OS manifest found at $MANIFEST${RESET}"
    echo -e "  ${YELLOW}  Nothing to uninstall (or files were removed manually).${RESET}"
    exit 0
  fi

  echo -e "  ${YELLOW}${BOLD}AI OS Uninstall${RESET}"
  echo -e "  This will remove all files tracked in the AI OS manifest:"
  echo -e "  ${CYAN}$MANIFEST${RESET}"
  echo ""

  # Read manifest file list with node (guaranteed to be available at this point)
  FILES=$(node -e "
    const m = JSON.parse(require('fs').readFileSync('$MANIFEST', 'utf8'));
    console.log(m.files.join('\\n'));
  " 2>/dev/null || true)

  if [[ -z "$FILES" ]]; then
    echo -e "  ${YELLOW}  Manifest is empty or unreadable — nothing to remove.${RESET}"
    exit 0
  fi

  echo -e "  ${BOLD}Files to remove:${RESET}"
  echo "$FILES" | while IFS= read -r f; do
    [[ -n "$f" ]] && echo -e "    - $f"
  done
  echo ""

  read -rp "  Confirm removal? [y/N] " CONFIRM
  if [[ "$CONFIRM" != "y" && "$CONFIRM" != "Y" ]]; then
    echo -e "  ${YELLOW}Aborted. No files were removed.${RESET}"
    exit 0
  fi

  REMOVED=0
  echo "$FILES" | while IFS= read -r f; do
    if [[ -n "$f" ]]; then
      FULL="$TARGET_DIR/$f"
      if [[ -f "$FULL" ]]; then
        rm -f "$FULL"
        echo -e "  ${GREEN}✓ Removed:${RESET} $f"
        REMOVED=$((REMOVED + 1))
      fi
    fi
  done

  # Remove .memory.lock gitignore entry if present
  GITIGNORE="$TARGET_DIR/.gitignore"
  if [[ -f "$GITIGNORE" ]]; then
  # Remove legacy AI OS gitignore lines using sed (cross-platform)
  sed -i.bak '/^# AI OS/d; /^\.ai-os\/mcp-server\/node_modules$/d; /^\.github\/ai-os\/mcp-server\/node_modules$/d; /^\.github\/ai-os\/memory\/.memory\.lock$/d; /^# AI OS — memory lock/d' "$GITIGNORE"
    rm -f "$GITIGNORE.bak"
    echo -e "  ${GREEN}✓ Cleaned AI OS entries from .gitignore${RESET}"
  fi

  echo ""
  echo -e "  ${GREEN}${BOLD}AI OS uninstalled.${RESET} MCP runtime (.ai-os/mcp-server/) was not removed."
  echo -e "  ${YELLOW}Tip:${RESET} Remove .ai-os/mcp-server/ manually if no longer needed."
  exit 0
fi

# ── Verify it's a git repo ────────────────────────────────────────────────────
if ! git -C "$TARGET_DIR" rev-parse --is-inside-work-tree &>/dev/null; then
  echo -e "  ${RED}✗ Not a git repository: $TARGET_DIR${RESET}"
  echo -e "  ${YELLOW}  Run 'git init' first, or cd into a git repository.${RESET}"
  exit 1
fi

echo -e "  ${GREEN}✓ Git repository detected${RESET}"

# ── Check Node.js version ────────────────────────────────────────────────────
USE_DOCKER=false

if ! command -v node &>/dev/null; then
  echo -e "  ${YELLOW}⚠ Node.js not found — checking for Docker fallback...${RESET}"

  if command -v docker &>/dev/null && docker info &>/dev/null 2>&1; then
    USE_DOCKER=true
    echo -e "  ${GREEN}✓ Docker detected — will use Docker to run the AI OS generator${RESET}"
    echo -e "  ${CYAN}  (Your project does NOT need Node.js or Docker after install)${RESET}"
  else
    echo -e "  ${RED}✗ Node.js not found and Docker is not available either.${RESET}"
    echo -e "  ${YELLOW}  AI OS requires Node.js >= 20 (or Docker) for its generator and MCP server.${RESET}"
    echo -e "  ${YELLOW}  Your project does NOT need Node.js after install.${RESET}"
    echo -e "  ${YELLOW}  Options:${RESET}"
    echo -e "  ${YELLOW}    Install Node.js: https://nodejs.org${RESET}"
    echo -e "  ${YELLOW}    Install Docker:  https://docs.docker.com/get-docker/${RESET}"
    exit 1
  fi
else
  NODE_VERSION=$(node --version | sed 's/v//')
  NODE_MAJOR=$(echo "$NODE_VERSION" | cut -d. -f1)

  if [[ "$NODE_MAJOR" -lt 20 ]]; then
    echo -e "  ${RED}✗ Node.js $NODE_VERSION is too old. Need >= 20.${RESET}"
    echo -e "  ${YELLOW}  AI OS uses Node.js for its generator and MCP server (not your project).${RESET}"
    echo -e "  ${YELLOW}  Update: https://nodejs.org${RESET}"
    exit 1
  fi

  echo -e "  ${GREEN}✓ Node.js v$NODE_VERSION${RESET}"

  # ── Check npm ────────────────────────────────────────────────────────────────
  if ! command -v npm &>/dev/null; then
    echo -e "  ${RED}✗ npm not found. Install Node.js from https://nodejs.org${RESET}"
    exit 1
  fi

  echo -e "  ${GREEN}✓ npm $(npm --version)${RESET}"
fi
echo ""

# ── Optional: install anthropics skill-creator via Skills CLI ───────────────
if [[ "$INSTALL_SKILL_CREATOR" == "true" ]]; then
  echo -e "  ${CYAN}→ Installing skill: anthropics/skills@skill-creator...${RESET}"

  if ! command -v npx &>/dev/null; then
    echo -e "  ${YELLOW}⚠ npx not found. Skipping skill installation.${RESET}"
    echo -e "  ${YELLOW}  You can run later:${RESET} npx -y skills add https://github.com/anthropics/skills --skill skill-creator -g -a github-copilot -y"
  elif npx -y skills add https://github.com/anthropics/skills --skill skill-creator -g -a github-copilot -y; then
    echo -e "  ${GREEN}✓ skill-creator installed globally${RESET}"
  else
    echo -e "  ${YELLOW}⚠ skill-creator install failed. Continuing AI OS install.${RESET}"
    echo -e "  ${YELLOW}  Retry later:${RESET} npx -y skills add https://github.com/anthropics/skills --skill skill-creator -g -a github-copilot -y"
  fi

  echo ""
fi

# ── Optional: install find-skills via Skills CLI ────────────────────────────
if [[ "$INSTALL_FIND_SKILLS" == "true" ]]; then
  echo -e "  ${CYAN}→ Installing skill: vercel-labs/skills@find-skills...${RESET}"

  if ! command -v npx &>/dev/null; then
    echo -e "  ${YELLOW}⚠ npx not found. Skipping skill installation.${RESET}"
    echo -e "  ${YELLOW}  You can run later:${RESET} npx -y skills add https://github.com/vercel-labs/skills --skill find-skills -g -a github-copilot -y"
  elif npx -y skills add https://github.com/vercel-labs/skills --skill find-skills -g -a github-copilot -y; then
    echo -e "  ${GREEN}✓ find-skills installed globally${RESET}"
  else
    echo -e "  ${YELLOW}⚠ find-skills install failed. Continuing AI OS install.${RESET}"
    echo -e "  ${YELLOW}  Retry later:${RESET} npx -y skills add https://github.com/vercel-labs/skills --skill find-skills -g -a github-copilot -y"
  fi

  echo ""
fi

# ── Locate ai-os source ───────────────────────────────────────────────────────
AIOS_SRC="$SCRIPT_DIR"
if [[ ! -f "$AIOS_SRC/package.json" ]]; then
  echo -e "  ${RED}✗ Cannot find ai-os package at: $AIOS_SRC${RESET}"
  exit 1
fi

# Helper: read a JSON field — uses node if available, python as fallback, grep as last resort
_read_json_field() {
  local file="$1" field="$2"
  if command -v node &>/dev/null; then
    node -e "const fs=require('fs');try{const o=JSON.parse(fs.readFileSync('$file','utf8'));process.stdout.write(String(o['$field']||''));}catch{process.stdout.write('');}"
  elif command -v python3 &>/dev/null; then
    python3 -c "import json,sys; d=json.load(open('$file')); print(d.get('$field',''),end='')" 2>/dev/null || true
  elif command -v python &>/dev/null; then
    python -c "import json,sys; d=json.load(open('$file')); print(d.get('$field',''),end='')" 2>/dev/null || true
  else
    grep -oP '"'"$field"'"\s*:\s*"\K[^"]+' "$file" 2>/dev/null | head -1 || true
  fi
}

if [[ "$USE_DOCKER" == "true" ]]; then
  AIOS_VERSION="$(grep -oP '"version"\s*:\s*"\K[^"]+' "$AIOS_SRC/package.json" | head -1)"
else
  AIOS_VERSION="$(_read_json_field "$AIOS_SRC/package.json" "version")"
fi
AIOS_VERSION="${AIOS_VERSION:-0.0.0}"

# Check new config path first (.github/ai-os/config.json), fall back to legacy (.ai-os/config.json)
_CORE_CONFIG_PATH="$TARGET_DIR/.github/ai-os/config.json"
if [[ ! -f "$_CORE_CONFIG_PATH" ]]; then
  _CORE_CONFIG_PATH="$TARGET_DIR/.ai-os/config.json"
fi
INSTALLED_CORE_VERSION="$(_read_json_field "$_CORE_CONFIG_PATH" "version" 2>/dev/null || true)"

echo -e "  ${CYAN}→ Startup diagnostics:${RESET}"
echo -e "  ${CYAN}  AI OS source version:${RESET} v${AIOS_VERSION}"
if [[ -n "$INSTALLED_CORE_VERSION" ]]; then
  echo -e "  ${CYAN}  Installed target version:${RESET} v${INSTALLED_CORE_VERSION}"
else
  echo -e "  ${CYAN}  Installed target version:${RESET} none (first install or missing config.json)"
fi
echo ""

# ── Docker mode: build image and run generator ───────────────────────────────
if [[ "$USE_DOCKER" == "true" ]]; then
  DOCKER_IMAGE="ai-os:${AIOS_VERSION}"
  echo -e "  ${CYAN}→ Building Docker image ${DOCKER_IMAGE}...${RESET}"
  docker build -t "$DOCKER_IMAGE" "$AIOS_SRC" >/dev/null 2>&1 || {
    echo -e "  ${RED}✗ Docker build failed. Check that Docker daemon is running.${RESET}"
    exit 1
  }
  echo -e "  ${GREEN}✓ Docker image ready${RESET}"
  echo ""

  echo -e "  ${CYAN}→ Scanning codebase and generating context (via Docker)...${RESET}"
  echo ""

  GEN_ARGS=(--cwd /repo)
  if [[ "$REFRESH_EXISTING" == "true" ]]; then
    GEN_ARGS+=(--refresh-existing)
  fi

  docker run --rm -v "$TARGET_DIR:/repo" "$DOCKER_IMAGE" "${GEN_ARGS[@]}"

  # Copy bundled MCP server (from image's pre-built dist/server.js)
  MCP_SERVER_DEST="$TARGET_DIR/.ai-os/mcp-server"
  mkdir -p "$MCP_SERVER_DEST"
  docker run --rm -v "$MCP_SERVER_DEST:/out" --entrypoint sh "$DOCKER_IMAGE" \
    -c "cp /app/dist/server.js /out/index.js && chmod +x /out/index.js"

  # Write runtime manifest (Docker mode — no hash check possible without node)
  cat > "$MCP_SERVER_DEST/runtime-manifest.json" << EOF
{
  "name": "ai-os-mcp-server",
  "runtime": "bundled",
  "sourceVersion": "$AIOS_VERSION",
  "installedVia": "docker",
  "installedAt": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
}
EOF

  echo -e "  ${GREEN}✓ MCP server installed (via Docker)${RESET}"
  echo -e "  ${YELLOW}  Note: To run the MCP server, Node.js >= 20 is required on PATH.${RESET}"
  echo -e "  ${YELLOW}        The bundled server (.ai-os/mcp-server/index.js) has no npm dependencies.${RESET}"
  echo ""

  # Skip the Node.js-dependent sections below
  echo -e "  ${GREEN}${BOLD}✅ AI OS installed successfully (Docker mode)!${RESET}"
  echo ""
  echo -e "  ${BOLD}Next steps:${RESET}"
  echo -e "  1. Open this repo in VS Code with GitHub Copilot extension installed"
  echo -e "  2. Copilot will use ${CYAN}.github/copilot-instructions.md${RESET} automatically"
  echo -e "  3. MCP tools are registered in ${CYAN}.github/copilot/mcp.json${RESET}"
  echo -e "  4. Project context is in ${CYAN}.github/ai-os/context/${RESET}"
  echo -e "  5. Install Node.js >= 20 to enable the MCP server: ${CYAN}https://nodejs.org${RESET}"
  echo ""
  echo -e "  ${YELLOW}Tip:${RESET} Re-run install.sh anytime to refresh context after major refactors."
  echo ""
  exit 0
fi

# ── Install ai-os dependencies (into scripts/ai-os/node_modules) ─────────────
echo -e "  ${CYAN}→ Installing dependencies...${RESET}"
(cd "$AIOS_SRC" && npm install --prefer-offline --no-audit --no-fund 2>&1 | tail -3)
echo -e "  ${GREEN}✓ Dependencies ready${RESET}"
echo ""

# ── Ensure bundled MCP server exists (build if missing) ──────────────────────
BUNDLED_SERVER="$AIOS_SRC/dist/server.js"
if [[ ! -f "$BUNDLED_SERVER" ]]; then
  echo -e "  ${CYAN}→ Pre-built dist/server.js not found — building bundle now...${RESET}"
  (cd "$AIOS_SRC" && node scripts/bundle.mjs 2>&1 | tail -4)
  if [[ ! -f "$BUNDLED_SERVER" ]]; then
    echo -e "  ${RED}✗ Bundle build failed. Cannot continue.${RESET}"
    exit 1
  fi
  echo -e "  ${GREEN}✓ Bundle built${RESET}"
  echo ""
fi

# ── Compile TypeScript (if dist/ is stale or missing) ────────────────────────
GENERATE_SCRIPT="$AIOS_SRC/src/generate.ts"
if [[ ! -f "$GENERATE_SCRIPT" ]]; then
  echo -e "  ${RED}✗ generate.ts not found at: $GENERATE_SCRIPT${RESET}"
  exit 1
fi

# ── Run the generator ────────────────────────────────────────────────────────
echo -e "  ${CYAN}→ Scanning codebase and generating context...${RESET}"
echo ""

GEN_ARGS=(--cwd "$TARGET_DIR")
if [[ "$REFRESH_EXISTING" == "true" ]]; then
  GEN_ARGS+=(--refresh-existing)
fi

# Detect absolute node path so mcp.json uses a stable path (fixes nvm/fnm/asdf on Windows/macOS)
NODE_ABS_PATH="$(command -v node)"

(cd "$AIOS_SRC" && AI_OS_NODE_PATH="$NODE_ABS_PATH" node --import tsx/esm src/generate.ts "${GEN_ARGS[@]}")

# ── Copy MCP server to target repo ──────────────────────────────────────────
MCP_SERVER_DEST="$TARGET_DIR/.ai-os/mcp-server"
MCP_RUNTIME_MANIFEST="$MCP_SERVER_DEST/runtime-manifest.json"

# Compute SHA-256 hash of dist/server.js for integrity check
# Uses sha256sum (Linux) or shasum -a 256 (macOS)
_compute_sha256() {
  local file="$1"
  if command -v sha256sum &>/dev/null; then
    sha256sum "$file" | cut -d' ' -f1
  elif command -v shasum &>/dev/null; then
    shasum -a 256 "$file" | cut -d' ' -f1
  else
    # Fallback: use node (already confirmed available at this point)
    node -e "const c=require('crypto'),fs=require('fs');process.stdout.write(c.createHash('sha256').update(fs.readFileSync('$file')).digest('hex'));"
  fi
}

BUNDLE_HASH="$(_compute_sha256 "$BUNDLED_SERVER")"

MCP_INSTALL_REQUIRED=true
INSTALLED_MCP_VERSION=""
INSTALLED_BUNDLE_HASH=""
MCP_SKIP_REASON=""

if [[ -f "$MCP_RUNTIME_MANIFEST" ]]; then
  INSTALLED_MCP_VERSION="$(_read_json_field "$MCP_RUNTIME_MANIFEST" "sourceVersion")"
  INSTALLED_BUNDLE_HASH="$(_read_json_field "$MCP_RUNTIME_MANIFEST" "bundleHash")"

  if [[ "$INSTALLED_MCP_VERSION" == "$AIOS_VERSION" \
     && "$INSTALLED_BUNDLE_HASH" == "$BUNDLE_HASH" \
     && "$REFRESH_EXISTING" != "true" \
     && -f "$MCP_SERVER_DEST/index.js" ]]; then
    MCP_INSTALL_REQUIRED=false
    MCP_SKIP_REASON="bundle hash matches (${BUNDLE_HASH:0:12}…) and index.js is present"
  fi
fi

if [[ "$MCP_INSTALL_REQUIRED" == "true" && -n "$INSTALLED_MCP_VERSION" && "$REFRESH_EXISTING" == "true" ]]; then
  MCP_SKIP_REASON="refresh mode requested"
fi

if [[ "$MCP_INSTALL_REQUIRED" == "true" && -n "$INSTALLED_MCP_VERSION" && "$REFRESH_EXISTING" != "true" && "$INSTALLED_MCP_VERSION" != "$AIOS_VERSION" ]]; then
  MCP_SKIP_REASON="runtime version mismatch (installed: $INSTALLED_MCP_VERSION)"
fi

if [[ "$MCP_INSTALL_REQUIRED" == "true" && -n "$INSTALLED_MCP_VERSION" && "$REFRESH_EXISTING" != "true" && "$INSTALLED_BUNDLE_HASH" != "$BUNDLE_HASH" ]]; then
  MCP_SKIP_REASON="bundle hash changed — updating server"
fi

if [[ "$MCP_INSTALL_REQUIRED" == "true" && -z "$INSTALLED_MCP_VERSION" ]]; then
  MCP_SKIP_REASON="runtime manifest missing or unreadable"
fi

if [[ "$MCP_INSTALL_REQUIRED" == "true" ]]; then
  mkdir -p "$MCP_SERVER_DEST"

  echo -e "  ${CYAN}→ Installing MCP server to .ai-os/mcp-server/...${RESET}"
  echo -e "  ${CYAN}  Reason:${RESET} ${MCP_SKIP_REASON}"
  if [[ -n "$INSTALLED_MCP_VERSION" ]]; then
    echo -e "  ${CYAN}  Runtime refresh:${RESET} v${INSTALLED_MCP_VERSION} -> v${AIOS_VERSION}"
  else
    echo -e "  ${CYAN}  Runtime install:${RESET} v${AIOS_VERSION}"
  fi

  # Copy pre-built single-file bundle — no node_modules needed in target repo
  echo -e "  ${CYAN}  Using pre-bundled server (no node_modules required)${RESET}"
  cp "$BUNDLED_SERVER" "$MCP_SERVER_DEST/index.js"
  chmod +x "$MCP_SERVER_DEST/index.js"

  cat > "$MCP_RUNTIME_MANIFEST" << EOF
{
  "name": "ai-os-mcp-server",
  "runtime": "bundled",
  "sourceVersion": "$AIOS_VERSION",
  "bundleHash": "$BUNDLE_HASH",
  "installedAt": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
}
EOF

  if AI_OS_ROOT="$TARGET_DIR" node "$MCP_SERVER_DEST/index.js" --healthcheck >/dev/null 2>&1; then
    echo -e "  ${GREEN}✓ MCP server installed and healthy${RESET}"
  else
    echo -e "  ${RED}✗ MCP server healthcheck failed after install.${RESET}"
    echo -e "  ${YELLOW}  Run with diagnostics:${RESET} AI_OS_MCP_DEBUG=1 node .ai-os/mcp-server/index.js --healthcheck"
    exit 1
  fi
else
  echo -e "  ${GREEN}✓ MCP server already up-to-date (v${AIOS_VERSION})${RESET}"
  echo -e "  ${CYAN}  Skip reason:${RESET} ${MCP_SKIP_REASON}"
fi
echo ""

# ── Clean up legacy v0.2.0 artifacts (--clean-update) ────────────────────────
if [[ "$CLEAN_UPDATE" == "true" ]]; then
  LEGACY_CONFIG="$TARGET_DIR/.ai-os/config.json"
  LEGACY_TOOLS="$TARGET_DIR/.ai-os/tools.json"
  LEGACY_CONTEXT_DIR="$TARGET_DIR/.ai-os/context"
  LEGACY_MEMORY_DIR="$TARGET_DIR/.ai-os/memory"

  LEGACY_FOUND=false
  for artifact in "$LEGACY_CONFIG" "$LEGACY_TOOLS" "$LEGACY_CONTEXT_DIR" "$LEGACY_MEMORY_DIR"; do
    if [[ -e "$artifact" ]]; then
      LEGACY_FOUND=true
      break
    fi
  done

  if [[ "$LEGACY_FOUND" == "true" ]]; then
    echo -e "  ${CYAN}→ Removing legacy v0.2.0 .ai-os/ artifacts...${RESET}"
    for artifact in "$LEGACY_CONFIG" "$LEGACY_TOOLS"; do
      if [[ -f "$artifact" ]]; then
        rm -f "$artifact"
        echo -e "  ${GREEN}✓ Removed:${RESET} ${artifact#"$TARGET_DIR/"}"
      fi
    done
    for dir in "$LEGACY_CONTEXT_DIR" "$LEGACY_MEMORY_DIR"; do
      if [[ -d "$dir" ]]; then
        rm -rf "$dir"
        echo -e "  ${GREEN}✓ Removed:${RESET} ${dir#"$TARGET_DIR/"}/"
      fi
    done
    echo -e "  ${GREEN}✓ Legacy cleanup complete. Canonical context is now at .github/ai-os/${RESET}"
  else
    echo -e "  ${GREEN}✓ No legacy v0.2.0 artifacts found — already clean${RESET}"
  fi
  echo ""
fi

# ── Add .github/ai-os/memory to .gitignore (optional) ────────────────────────
GITIGNORE="$TARGET_DIR/.gitignore"
if [[ -f "$GITIGNORE" ]]; then
  # Remove legacy node_modules entries if present (no longer needed in v0.6+)
  sed -i.bak '/^\.ai-os\/mcp-server\/node_modules$/d; /^\.github\/ai-os\/mcp-server\/node_modules$/d' "$GITIGNORE" 2>/dev/null || true
  rm -f "$GITIGNORE.bak"

  # Ensure memory lock file is ignored (it's an implementation detail, not content)
  if ! grep -q "^\.github/ai-os/memory/\.memory\.lock$" "$GITIGNORE" 2>/dev/null; then
    echo "" >> "$GITIGNORE"
    echo "# AI OS — memory lock file (implementation detail, not content)" >> "$GITIGNORE"
    echo ".github/ai-os/memory/.memory.lock" >> "$GITIGNORE"
    echo -e "  ${GREEN}✓ Updated .gitignore${RESET}"
  fi
fi

# ── Done ────────────────────────────────────────────────────────────────────
echo ""
echo -e "  ${GREEN}${BOLD}✅ AI OS installed successfully!${RESET}"
echo ""
echo -e "  ${BOLD}Next steps:${RESET}"
echo -e "  1. Open this repo in VS Code with GitHub Copilot extension installed"
echo -e "  2. Copilot will use ${CYAN}.github/copilot-instructions.md${RESET} automatically"
echo -e "  3. MCP tools are registered in ${CYAN}.github/copilot/mcp.json${RESET}"
  echo -e "  4. Project context is in ${CYAN}.github/ai-os/context/${RESET}"
echo -e "  5. AI OS skills are generated in ${CYAN}.github/copilot/skills/${RESET} with ai-os-* naming"
echo ""
echo -e "  ${YELLOW}Tip:${RESET} Re-run install.sh anytime to refresh context after major refactors."
echo ""
