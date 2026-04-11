#!/usr/bin/env bash
# =============================================================================
#  AI OS Installer — Portable Copilot Context Engine
#  Install on any repository with: bash install.sh
#  Node.js >= 20 is required for the generator and MCP server.
#  If Node.js is unavailable, Docker is used as a fallback for generation
#  (MCP server will not be installed without a host Node.js binary).
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
echo -e "${CYAN}${BOLD}  ║          AI OS  v0.4.1            ║${RESET}"
echo -e "${CYAN}${BOLD}  ║  Portable Copilot Context Engine  ║${RESET}"
echo -e "${CYAN}${BOLD}  ╚═══════════════════════════════════╝${RESET}"
echo ""

# ── Git Bash / MSYS / MINGW detection on Windows ─────────────────────────────
if [[ "${OSTYPE:-}" == "msys" || "${OSTYPE:-}" == "cygwin" || -n "${MSYSTEM:-}" ]]; then
  if [[ "${MSYSTEM:-}" == "MINGW64" || "${MSYSTEM:-}" == "MINGW32" ]]; then
    # Git Bash sets MSYSTEM to MINGW64/MINGW32 — this is the expected environment
    echo -e "  ${GREEN}✓ Git Bash detected (${MSYSTEM})${RESET}"
  else
    # Running under MSYS2/Cygwin but not a standard Git Bash session — warn about path issues
    echo -e "  ${YELLOW}⚠  Windows detected: running outside Git Bash may cause path issues.${RESET}"
    echo -e "  ${YELLOW}   Open 'Git Bash' from the Start menu and re-run this script there.${RESET}"
    echo ""
  fi
fi

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

# ── Detect available JavaScript runtime (early, used by uninstall too) ───────
RUNTIME_CMD=""
RUNTIME_NAME=""
USE_BUN=false

if command -v node &>/dev/null; then
  _NODE_VER=$(node --version 2>/dev/null | sed 's/v//')
  _NODE_MAJOR=$(echo "$_NODE_VER" | cut -d. -f1)
  if [[ "$_NODE_MAJOR" -ge 20 ]]; then
    RUNTIME_CMD="node"
    RUNTIME_NAME="Node.js v$_NODE_VER"
  fi
fi

if [[ -z "$RUNTIME_CMD" ]] && command -v bun &>/dev/null; then
  _BUN_VER=$(bun --version 2>/dev/null || echo "unknown")
  RUNTIME_CMD="bun"
  RUNTIME_NAME="Bun v$_BUN_VER"
  USE_BUN=true
fi

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

  # Read manifest file list with available runtime
  FILES=""
  if [[ -n "$RUNTIME_CMD" ]]; then
    FILES=$($RUNTIME_CMD -e "
      const m = JSON.parse(require('fs').readFileSync('$MANIFEST', 'utf8'));
      console.log(m.files.join('\\n'));
    " 2>/dev/null || true)
  elif command -v python3 &>/dev/null; then
    FILES=$(python3 -c "import json; m=json.load(open('$MANIFEST')); print('\n'.join(m.get('files', [])))" 2>/dev/null || true)
  fi

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
    # Remove AI OS gitignore lines using sed (cross-platform)
    sed -i.bak '/^# AI OS/d; /^\.ai-os\/mcp-server\/node_modules$/d; /^\.github\/ai-os\/mcp-server\/node_modules$/d; /^\.github\/ai-os\/memory\/.memory\.lock$/d; /^\.github\/copilot\/mcp\.local\.json$/d' "$GITIGNORE"
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
# Track whether we are running in Docker-fallback mode (no host Node.js).
USE_DOCKER_FALLBACK=false

if ! command -v node &>/dev/null; then
  echo -e "  ${YELLOW}⚠ Node.js not found on this machine.${RESET}"
  echo -e "  ${YELLOW}  AI OS uses Node.js for its generator and MCP server.${RESET}"
  echo -e "  ${YELLOW}  Your project does NOT need to be a Node.js project.${RESET}"

  if command -v docker &>/dev/null; then
    echo -e "  ${CYAN}→ Docker detected — will use Docker to run the AI OS generator.${RESET}"
    echo -e "  ${YELLOW}  Note: MCP server will NOT be installed (requires a host Node.js binary).${RESET}"
    echo -e "  ${YELLOW}  Install Node.js >= 20 later to enable MCP tools: https://nodejs.org${RESET}"
    USE_DOCKER_FALLBACK=true
  else
    echo -e "  ${RED}✗ Neither Node.js nor Docker found.${RESET}"
    echo -e "  ${YELLOW}  Install Node.js >= 20: https://nodejs.org${RESET}"
    echo -e "  ${YELLOW}  Or install Docker:    https://docs.docker.com/get-docker/${RESET}"
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

  # ── Check npm ──────────────────────────────────────────────────────────────
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

# Helper: read the top-level "version" field from a JSON file without node.
# Tries python3/python as a more reliable parser; falls back to grep+sed.
_read_json_version() {
  local file="$1"
  local default="${2:-}"
  if command -v python3 &>/dev/null; then
    python3 -c "import json,sys; d=json.load(open('$file')); print(d.get('version',''))" 2>/dev/null || true
  elif command -v python &>/dev/null; then
    python -c "import json; d=json.load(open('$file')); print(d.get('version',''))" 2>/dev/null || true
  else
    grep -m1 '"version"' "$file" 2>/dev/null | sed 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/' || true
  fi
}

# Read version: use node if available, otherwise use the portable helper above
if [[ "$USE_DOCKER_FALLBACK" == "true" ]]; then
  AIOS_VERSION="$(_read_json_version "$AIOS_SRC/package.json" "0.0.0")"
else
  AIOS_VERSION="$(node -e "const fs=require('fs');const p=process.argv[1];const pkg=JSON.parse(fs.readFileSync(p,'utf8'));process.stdout.write(pkg.version||'0.0.0');" "$AIOS_SRC/package.json")"
fi

# Check new config path first (.github/ai-os/config.json), fall back to legacy (.ai-os/config.json)
_CORE_CONFIG_PATH="$TARGET_DIR/.github/ai-os/config.json"
if [[ ! -f "$_CORE_CONFIG_PATH" ]]; then
  _CORE_CONFIG_PATH="$TARGET_DIR/.ai-os/config.json"
fi
if [[ "$USE_DOCKER_FALLBACK" == "true" ]]; then
  INSTALLED_CORE_VERSION="$(_read_json_version "$_CORE_CONFIG_PATH" "")"
else
  INSTALLED_CORE_VERSION="$(node -e "const fs=require('fs');const p=process.argv[1];try{const cfg=JSON.parse(fs.readFileSync(p,'utf8'));process.stdout.write(String(cfg.version||''));}catch{process.stdout.write('');}" "$_CORE_CONFIG_PATH")"
fi

echo -e "  ${CYAN}→ Startup diagnostics:${RESET}"
echo -e "  ${CYAN}  AI OS source version:${RESET} v${AIOS_VERSION}"
if [[ -n "$INSTALLED_CORE_VERSION" ]]; then
  echo -e "  ${CYAN}  Installed target version:${RESET} v${INSTALLED_CORE_VERSION}"
else
  echo -e "  ${CYAN}  Installed target version:${RESET} none (first install or missing config.json)"
fi
echo ""

# ── Compile TypeScript (if dist/ is stale or missing) ────────────────────────
GENERATE_SCRIPT="$AIOS_SRC/src/generate.ts"
if [[ ! -f "$GENERATE_SCRIPT" ]]; then
  echo -e "  ${RED}✗ generate.ts not found at: $GENERATE_SCRIPT${RESET}"
  exit 1
fi

# ── Run the generator ────────────────────────────────────────────────────────
echo -e "  ${CYAN}→ Scanning codebase and generating context...${RESET}"
echo ""

if [[ "$USE_DOCKER_FALLBACK" == "true" ]]; then
  # Build the generator args explicitly for Docker (target repo is mounted at /target)
  DOCKER_GEN_ARGS=(--cwd /target)
  if [[ "$REFRESH_EXISTING" == "true" ]]; then
    DOCKER_GEN_ARGS+=(--refresh-existing)
  fi
  # ── Install ai-os dependencies inside Docker ───────────────────────────────
  echo -e "  ${CYAN}→ Running generator via Docker (no host Node.js)...${RESET}"
  docker run --rm \
    -v "$AIOS_SRC:/ai-os:ro" \
    -v "$TARGET_DIR:/target" \
    -e "HOME=/tmp" \
    node:20-alpine \
    sh -c "cd /ai-os && npm install --prefer-offline --no-audit --no-fund -s && node --import tsx/esm src/generate.ts $(printf '%q ' "${DOCKER_GEN_ARGS[@]}")"
  echo -e "  ${YELLOW}⚠ MCP server not installed — Node.js required on the host.${RESET}"
  echo -e "  ${YELLOW}  Install Node.js >= 20 and re-run install.sh to enable MCP tools.${RESET}"
else
  GEN_ARGS=(--cwd "$TARGET_DIR")
  if [[ "$REFRESH_EXISTING" == "true" ]]; then
    GEN_ARGS+=(--refresh-existing)
  fi

  # ── Install ai-os dependencies (into scripts/ai-os/node_modules) ────────────
  echo -e "  ${CYAN}→ Installing dependencies...${RESET}"
  (cd "$AIOS_SRC" && npm install --prefer-offline --no-audit --no-fund 2>&1 | tail -3)
  echo -e "  ${GREEN}✓ Dependencies ready${RESET}"
  echo ""

  # Detect absolute node path so mcp.local.json uses a stable path (fixes nvm/fnm/asdf on Windows/macOS)
  NODE_ABS_PATH="$(command -v node)"

  (cd "$AIOS_SRC" && AI_OS_NODE_PATH="$NODE_ABS_PATH" node --import tsx/esm src/generate.ts "${GEN_ARGS[@]}")

  # ── Write local-only MCP server config (.github/copilot/mcp.local.json) ───
  # This file is gitignored and contains the machine-specific node path so VS
  # Code's Copilot extension can spawn the MCP server.  The committed
  # mcp.json intentionally has no servers block (see src/generators/mcp.ts).
  MCP_LOCAL_DIR="$TARGET_DIR/.github/copilot"
  MCP_LOCAL_PATH="$MCP_LOCAL_DIR/mcp.local.json"
  mkdir -p "$MCP_LOCAL_DIR"
  cat > "$MCP_LOCAL_PATH" << EOF
{
  "version": 1,
  "servers": {
    "ai-os": {
      "type": "stdio",
      "command": "$NODE_ABS_PATH",
      "args": [".ai-os/mcp-server/index.js"],
      "env": {
        "AI_OS_ROOT": "."
      }
    }
  }
}
EOF
  echo -e "  ${GREEN}✓ Local MCP config written (.github/copilot/mcp.local.json)${RESET}"
fi

# ── Copy MCP server to target repo ──────────────────────────────────────────
# Skipped when running via Docker fallback (no host Node.js to run the server).
if [[ "$USE_DOCKER_FALLBACK" == "false" ]]; then
MCP_SERVER_SRC="$AIOS_SRC/src/mcp-server"
MCP_SERVER_DEST="$TARGET_DIR/.ai-os/mcp-server"
MCP_RUNTIME_MANIFEST="$MCP_SERVER_DEST/runtime-manifest.json"

MCP_INSTALL_REQUIRED=true
INSTALLED_MCP_VERSION=""
MCP_SKIP_REASON=""

if [[ -f "$MCP_RUNTIME_MANIFEST" ]]; then
  INSTALLED_MCP_VERSION="$($RUNTIME_CMD -e "const fs=require('fs');const p=process.argv[1];try{const m=JSON.parse(fs.readFileSync(p,'utf8'));process.stdout.write(String(m.sourceVersion||''));}catch{process.stdout.write('');}" "$MCP_RUNTIME_MANIFEST")"

  if [[ "$INSTALLED_MCP_VERSION" == "$AIOS_VERSION" && "$REFRESH_EXISTING" != "true" && -f "$MCP_SERVER_DEST/index.js" ]]; then
    MCP_INSTALL_REQUIRED=false
    MCP_SKIP_REASON="runtime-manifest.json matches source version and index.js is present"
  fi
fi

if [[ "$MCP_INSTALL_REQUIRED" == "true" && -n "$INSTALLED_MCP_VERSION" && "$REFRESH_EXISTING" == "true" ]]; then
  MCP_SKIP_REASON="refresh mode requested"
fi

if [[ "$MCP_INSTALL_REQUIRED" == "true" && -n "$INSTALLED_MCP_VERSION" && "$REFRESH_EXISTING" != "true" && "$INSTALLED_MCP_VERSION" != "$AIOS_VERSION" ]]; then
  MCP_SKIP_REASON="runtime version mismatch"
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

  # Prefer bundled single-file server (Phase F) if available; fall back to source+tsx launcher
  BUNDLED_SERVER="$AIOS_SRC/dist/server.js"
  if [[ -f "$BUNDLED_SERVER" ]]; then
    echo -e "  ${CYAN}  Using pre-bundled server (no node_modules required)${RESET}"
    cp "$BUNDLED_SERVER" "$MCP_SERVER_DEST/index.js"
    chmod +x "$MCP_SERVER_DEST/index.js"
  else
    # Fall back: copy MCP server source files + install deps
    cp -r "$MCP_SERVER_SRC"/* "$MCP_SERVER_DEST/"

    # Create a runtime package.json for the MCP server in the target repo
    cat > "$MCP_SERVER_DEST/package.json" << 'EOF'
{
  "name": "ai-os-mcp-server",
  "version": "0.1.0",
  "type": "module",
  "main": "index.js",
  "dependencies": {
    "@github/copilot-sdk": "^0.1.8",
    "tsx": "^4.19.0"
  }
}
EOF

    # Install MCP server dependencies
    if [[ "$USE_BUN" == "true" ]]; then
      (cd "$MCP_SERVER_DEST" && bun install 2>&1 | tail -3)
    else
      (cd "$MCP_SERVER_DEST" && npm install --prefer-offline --no-audit --no-fund 2>&1 | tail -3)
    fi

    # Create a portable runtime launcher
    cat > "$MCP_SERVER_DEST/index.js" << 'EOF'
#!/usr/bin/env node
// AI OS MCP Server — auto-generated entry point
// This file is generated by ai-os install. Do not edit manually.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const currentFile = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFile);
const indexTs = path.join(currentDir, 'index.ts');

const result = spawnSync(process.execPath, ['--import', 'tsx/esm', indexTs, ...process.argv.slice(2)], {
  cwd: currentDir,
  stdio: 'inherit',
  env: { ...process.env, AI_OS_ROOT: process.env.AI_OS_ROOT ?? process.cwd() },
});

if (result.error) {
  console.error('[ai-os:mcp] Failed to launch TypeScript runtime:', result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
EOF
  fi

  cat > "$MCP_RUNTIME_MANIFEST" << EOF
{
  "name": "ai-os-mcp-server",
  "runtime": "$([ -f "$BUNDLED_SERVER" ] && echo "bundled" || echo "tsx")",
  "sourceVersion": "$AIOS_VERSION",
  "installedAt": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
}
EOF

  if AI_OS_ROOT="$TARGET_DIR" $RUNTIME_CMD "$MCP_SERVER_DEST/index.js" --healthcheck >/dev/null 2>&1; then
    echo -e "  ${GREEN}✓ MCP server installed and healthy${RESET}"
  else
    echo -e "  ${RED}✗ MCP server healthcheck failed after install.${RESET}"
    echo -e "  ${YELLOW}  Run with diagnostics:${RESET} AI_OS_MCP_DEBUG=1 $RUNTIME_CMD .ai-os/mcp-server/index.js --healthcheck"
    exit 1
  fi
else
  echo -e "  ${GREEN}✓ MCP server already up-to-date (v${AIOS_VERSION})${RESET}"
  echo -e "  ${CYAN}  Skip reason:${RESET} ${MCP_SKIP_REASON}"
fi
fi # end USE_DOCKER_FALLBACK == false
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

# ── Add .ai-os to .gitignore (optional) ───────────────────────────────────────
GITIGNORE="$TARGET_DIR/.gitignore"
if [[ -f "$GITIGNORE" ]]; then
  if ! grep -q "^\.ai-os/mcp-server/node_modules$" "$GITIGNORE" 2>/dev/null; then
    echo "" >> "$GITIGNORE"
    echo "# AI OS (generated — safe to commit except node_modules and local MCP config)" >> "$GITIGNORE"
    echo ".ai-os/mcp-server/node_modules" >> "$GITIGNORE"
    echo -e "  ${GREEN}✓ Updated .gitignore${RESET}"
  fi
  if ! grep -q "^\.github/ai-os/mcp-server/node_modules$" "$GITIGNORE" 2>/dev/null; then
    echo ".github/ai-os/mcp-server/node_modules" >> "$GITIGNORE"
  fi
  # #10 — ignore the memory lock file so it never appears as an untracked change
  if ! grep -q "^\.github/ai-os/memory/\.memory\.lock$" "$GITIGNORE" 2>/dev/null; then
    echo ".github/ai-os/memory/.memory.lock" >> "$GITIGNORE"
  fi
  # mcp.local.json contains a machine-specific node path — must not be committed
  if ! grep -q "^\.github/copilot/mcp\.local\.json$" "$GITIGNORE" 2>/dev/null; then
    echo ".github/copilot/mcp.local.json" >> "$GITIGNORE"
  fi
fi

# ── Done ────────────────────────────────────────────────────────────────────
echo ""
echo -e "  ${GREEN}${BOLD}✅ AI OS installed successfully!${RESET}"
echo ""
echo -e "  ${BOLD}Next steps:${RESET}"
echo -e "  1. Open this repo in VS Code with GitHub Copilot extension installed"
echo -e "  2. Copilot will use ${CYAN}.github/copilot-instructions.md${RESET} automatically"
if [[ "$USE_DOCKER_FALLBACK" == "true" ]]; then
  echo -e "  3. ${YELLOW}MCP tools unavailable${RESET} — install Node.js >= 20 and re-run install.sh"
else
  echo -e "  3. MCP tools are active via ${CYAN}.github/copilot/mcp.local.json${RESET} (local, gitignored)"
fi
echo -e "  4. Project context is in ${CYAN}.github/ai-os/context/${RESET}"
echo -e "  5. AI OS skills are generated in ${CYAN}.github/copilot/skills/${RESET} with ai-os-* naming"
echo ""
echo -e "  ${YELLOW}Tip:${RESET} Re-run install.sh anytime to refresh context after major refactors."
echo ""
