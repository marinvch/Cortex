#!/usr/bin/env bash
# server-setup.sh — wire the living Cortex brain in one command.
#
# Two modes (run each on the right machine):
#   ON THE SERVER (creates the private bare repo):
#     bash server-setup.sh server [repo-name]
#   ON EACH MACHINE, from your VAULT ROOT (clones into team/<slug> where the MCP expects it):
#     bash server-setup.sh client ssh://USER@SERVER/~/git/cortex-brain.git [slug]
#
# No secrets are read or stored. SSH auth is your existing key — this script never handles it.
set -euo pipefail

MODE="${1:-}"
case "$MODE" in
  server)
    NAME="${2:-cortex-brain}"
    mkdir -p "$HOME/git"
    if [ -d "$HOME/git/$NAME.git" ]; then
      echo "already exists: $HOME/git/$NAME.git"
    else
      git init --bare "$HOME/git/$NAME.git"
      echo "created bare repo: $HOME/git/$NAME.git"
    fi
    echo "clone URL for your machines:"
    echo "  ssh://$USER@$(hostname -f 2>/dev/null || hostname)/~/git/$NAME.git"
    ;;

  client)
    REMOTE="${2:?usage: server-setup.sh client ssh://USER@SERVER/~/git/cortex-brain.git [slug]}"
    SLUG="${3:-cortex}"
    [ -f mcp/server.js ] || { echo "run this from your VAULT ROOT (where mcp/ lives)"; exit 1; }
    mkdir -p team
    if [ -d "team/$SLUG/.git" ]; then
      echo "clone already present: team/$SLUG"
    else
      git clone "$REMOTE" "team/$SLUG"
    fi
    ( cd "team/$SLUG"
      # ensure a branch + upstream exist so the MCP's pull/push work
      git commit --allow-empty -q -m "init cortex-brain" 2>/dev/null || true
      git push -u origin HEAD -q 2>/dev/null || true
    )
    echo "ready: team/$SLUG  ->  $REMOTE"
    echo "next: register the MCP, then in a Claude session try  capture(team:\"$SLUG\", content:\"hello\")"
    ;;

  *)
    echo "usage:"
    echo "  bash server-setup.sh server [repo-name]                                    # on the server"
    echo "  bash server-setup.sh client ssh://USER@SERVER/~/git/cortex-brain.git [slug]  # in vault root"
    exit 1
    ;;
esac
