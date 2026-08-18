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

  cron)
    # The scheduler half. This used to be a section of references/living-cortex.md that a human
    # copied by hand, which is how its crontab example came to carry a live API key.
    REMOTE="${2:?usage: server-setup.sh cron <clone-url> [work-dir] [--install]}"
    WORKDIR="${3:-$HOME/cortex-work}"
    case "${3:-}" in --install) WORKDIR="$HOME/cortex-work" ;; esac
    INSTALL=0
    for a in "$@"; do [ "$a" = "--install" ] && INSTALL=1; done

    # Resolve the cron script from THIS script's own location. living-cortex.md hardcodes
    # $HOME/ai-os, which is wrong for anyone who cloned anywhere else — and a provisioning step that
    # prints a path which does not exist is worse than one that prints nothing, because it looks
    # finished.
    HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    CRON_SCRIPT="$HERE/cortex-cron.sh"
    [ -f "$CRON_SCRIPT" ] || { echo "cannot find cortex-cron.sh next to this script" >&2; exit 1; }

    if [ -d "$WORKDIR/.git" ]; then
      echo "already cloned: $WORKDIR"
    else
      git clone "$REMOTE" "$WORKDIR"
      echo "cloned working brain: $WORKDIR"
    fi

    # The key lives in a 0600 file the crontab SOURCES. Inlining it in the crontab — which is what
    # the docs used to tell people to do — means `crontab -l` prints it, it lands in any backup of
    # /var/spool/cron, and it is exposed by the one command people run to check whether cron is set
    # up. core/scrub.js refuses a memory write carrying a credential; the docs should not ask for
    # what the code refuses.
    CFG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/cortex"
    ENV_FILE="$CFG_DIR/cron.env"
    mkdir -p "$CFG_DIR"
    if [ -f "$ENV_FILE" ]; then
      echo "env file already present: $ENV_FILE (left untouched)"
    else
      # umask so the file is never briefly world-readable between creation and chmod.
      ( umask 077
        cat > "$ENV_FILE" <<'ENVTPL'
# Cortex cron environment. Sourced by the crontab lines server-setup.sh prints.
# This file holds a live credential — keep it 0600 and never commit it.
#
# Optional. Without a key, cortex-cron.sh writes a deterministic git-based digest,
# which is the boring path and always works.
#ANTHROPIC_API_KEY=

# Optional. Model ids age out; if the log says "summary unavailable", check this first.
#CORTEX_MODEL=claude-sonnet-5
ENVTPL
      )
      chmod 600 "$ENV_FILE" 2>/dev/null || true
      # Report what the filesystem actually did, not what we asked for. Some filesystems (NTFS via
      # Git Bash, some network mounts) accept chmod and umask silently without storing mode bits,
      # and printing "(0600)" there would be a security claim this script cannot back up.
      MODE="$(stat -c %a "$ENV_FILE" 2>/dev/null || echo unknown)"
      if [ "$MODE" = "600" ]; then
        echo "created env file: $ENV_FILE (0600)"
      else
        echo "created env file: $ENV_FILE"
        echo "  WARNING: could not confirm 0600 permissions (this filesystem reports '$MODE')." >&2
        echo "  It will hold an API key — check that only you can read it." >&2
      fi
    fi

    CRON_DAILY="0 6 * * * . $ENV_FILE; BRAIN_DIR=$WORKDIR bash $CRON_SCRIPT --daily"
    CRON_WEEKLY="10 6 * * 1 . $ENV_FILE; BRAIN_DIR=$WORKDIR bash $CRON_SCRIPT --weekly"
    MARKER="# cortex-cron (managed)"

    if [ "$INSTALL" -eq 1 ]; then
      # Replace the managed block; never touch anything outside it. The operator's other cron jobs
      # are not ours to rewrite.
      existing="$(crontab -l 2>/dev/null || true)"
      kept="$(printf '%s\n' "$existing" | grep -vF "$MARKER" | grep -vF "$CRON_SCRIPT" || true)"
      { [ -n "$kept" ] && printf '%s\n' "$kept"
        printf '%s\n%s\n%s\n' "$MARKER" "$CRON_DAILY" "$CRON_WEEKLY"
      } | crontab -
      echo "installed: 2 cortex-cron entries (replacing any previous managed block)"
      echo "check with: crontab -l"
    else
      # Printing is the default. A crontab is user-global, easy to clobber and annoying to rebuild;
      # a setup script that rewrites it because someone ran it to see what it would do has broken
      # something nobody asked it to touch. Same consent structure as ADR 0005/0006.
      echo
      echo "add these to your crontab (crontab -e), or re-run with --install:"
      echo
      echo "$MARKER"
      echo "$CRON_DAILY"
      echo "$CRON_WEEKLY"
      echo
      echo "for an AI summary, put your key in $ENV_FILE"
      echo "without one, the digest is still written — deterministically, from git"
    fi
    ;;

  *)
    echo "usage:"
    echo "  bash server-setup.sh server [repo-name]                                    # on the server"
    echo "  bash server-setup.sh client ssh://USER@SERVER/~/git/cortex-brain.git [slug]  # in vault root"
    echo "  bash server-setup.sh cron <clone-url> [work-dir] [--install]                # on the server"
    echo
    echo "cron mode prints the crontab lines it recommends and changes nothing;"
    echo "pass --install to write them into a managed block in your crontab."
    exit 1
    ;;
esac
