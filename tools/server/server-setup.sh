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
    # $USER is not guaranteed to be exported. It is absent under cron (which strips the environment),
    # in minimal containers, and in Git Bash on Windows — and with `set -u` that killed this script
    # one line before it printed the clone URL, which is the entire reason anyone runs it. It had
    # already created the repo by then, so the operator saw a failure after a success.
    WHO="${USER:-${USERNAME:-$(id -un 2>/dev/null || echo user)}}"
    echo "clone URL for your machines:"
    echo "  ssh://$WHO@$(hostname -f 2>/dev/null || hostname)/~/git/$NAME.git"
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

    # Both commands above are `|| true`, and on a machine with no git identity configured — a fresh
    # server or container, exactly where this script runs — the commit fails, so no branch exists,
    # so the push fails too. The clone is then left with no upstream and this script used to print
    # "ready" anyway. The MCP's pull/push would fail later for a reason nobody could trace back here.
    if ! git -C "team/$SLUG" rev-parse --abbrev-ref '@{u}' >/dev/null 2>&1; then
      echo "server-setup: WARNING — team/$SLUG has no upstream branch, so the MCP cannot push to it." >&2
      echo "server-setup: the usual cause is no git identity on this machine. Fix with:" >&2
      echo "    git config --global user.email you@example.com && git config --global user.name 'Your Name'" >&2
      echo "server-setup: then re-run this command." >&2
      exit 1
    fi

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
