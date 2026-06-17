#!/usr/bin/env bash
# =============================================================================
#  AI OS Bootstrap
#  Run from any target repository to fetch and execute AI OS installer.
# =============================================================================

set -euo pipefail

REPO_URL="${AI_OS_REPO_URL:-https://github.com/marinvch/ai-os.git}"
TARGET_PWD="$(pwd)"

# Use mktemp for a safe, unique temp directory (no PID collision risk)
TMPDIR_AI_OS="$(mktemp -d)"
cleanup() { rm -rf "$TMPDIR_AI_OS"; }
trap cleanup EXIT

# ── Auto-install Node.js via nvm if not present ───────────────────────────────
ensure_node() {
  if command -v node &>/dev/null; then
    return 0
  fi

  echo "→ Node.js not found. Auto-installing via nvm..."
  NVM_DIR="${NVM_DIR:-$HOME/.nvm}"

  if [[ ! -f "$NVM_DIR/nvm.sh" ]]; then
    curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
  fi

  # shellcheck source=/dev/null
  source "$NVM_DIR/nvm.sh"
  nvm install --lts
  nvm use --lts
  echo "→ Node.js $(node --version) ready"
}

ensure_node

echo "→ Fetching AI OS from ${REPO_URL}"
git clone --depth 1 "$REPO_URL" "$TMPDIR_AI_OS/ai-os" >/dev/null 2>&1

HAS_CWD=false
for arg in "$@"; do
  if [[ "$arg" == "--cwd" || "$arg" == --cwd=* ]]; then
    HAS_CWD=true
    break
  fi
done

if [[ "$HAS_CWD" == "true" ]]; then
  bash "$TMPDIR_AI_OS/ai-os/install.sh" "$@"
else
  bash "$TMPDIR_AI_OS/ai-os/install.sh" --cwd "$TARGET_PWD" "$@"
fi
