#!/usr/bin/env bash
# cortex-cron.sh — server-side autonomy for the living Cortex brain.
#
# Pulls the brain, gathers what changed, writes a digest (daily) or audit (weekly), commits + pushes.
# AI summary is OPTIONAL: only used when ANTHROPIC_API_KEY is set — otherwise a plain, deterministic
# git-based digest is written (boring is beautiful; it always works).
#
# Usage (from cron):
#   BRAIN_DIR=$HOME/cortex-work bash cortex-cron.sh --daily
#   BRAIN_DIR=$HOME/cortex-work ANTHROPIC_API_KEY=sk-... bash cortex-cron.sh --weekly
#
# Env:
#   BRAIN_DIR           path to a git clone of the brain repo (required)
#   ANTHROPIC_API_KEY   optional; enables an AI summary of the changes
#   CORTEX_MODEL        optional; Claude model id (default below) — check the current id
set -euo pipefail

MODE="${1:---daily}"
BRAIN_DIR="${BRAIN_DIR:?set BRAIN_DIR to your brain clone}"
MODEL="${CORTEX_MODEL:-claude-sonnet-4-6}"
cd "$BRAIN_DIR"

# 1. sync
git pull --ff-only -q || { echo "pull failed"; exit 1; }

today="$(date +%F)"
if [ "$MODE" = "--weekly" ]; then SINCE="7 days ago"; OUT="audits/${today}.md"; TITLE="Weekly audit";
else SINCE="24 hours ago"; OUT="digests/${today}.md"; TITLE="Daily digest"; fi

# 2. gather what changed (note files only; ignore generated/backup noise)
changed="$(git log --since="$SINCE" --name-only --pretty=format: -- '*.md' \
  | grep -Ev '(^$|\.bak|\.generated\.|digests/|audits/)' | sort -u || true)"

# recent note bodies as raw material (bounded, so cron stays cheap)
material="$(git log --since="$SINCE" -p --pretty='commit %h %ad' --date=short -- '*.md' \
  | head -c 60000 || true)"

mkdir -p "$(dirname "$OUT")"

# 3a. AI summary if a key is present
summary=""
if [ -n "${ANTHROPIC_API_KEY:-}" ] && [ -n "$material" ]; then
  prompt="You are Cortex, a personal knowledge assistant. Summarize what changed in the brain over the last period as a short, useful ${TITLE,,}: 3-6 bullets of what was captured/decided, and 1-2 follow-ups worth doing. Be concise and concrete. Raw material follows:\n\n${material}"
  # build JSON safely with a heredoc + jq if available; else minimal escaping
  if command -v jq >/dev/null 2>&1; then
    body="$(jq -n --arg m "$MODEL" --arg p "$prompt" \
      '{model:$m, max_tokens:800, messages:[{role:"user", content:$p}]}')"
  else
    esc="$(printf '%s' "$prompt" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))' 2>/dev/null || printf '""')"
    body="{\"model\":\"$MODEL\",\"max_tokens\":800,\"messages\":[{\"role\":\"user\",\"content\":$esc}]}"
  fi
  resp="$(curl -sS https://api.anthropic.com/v1/messages \
    -H "x-api-key: ${ANTHROPIC_API_KEY}" \
    -H "anthropic-version: 2023-06-01" \
    -H "content-type: application/json" \
    -d "$body" 2>/dev/null || true)"
  if command -v jq >/dev/null 2>&1; then
    summary="$(printf '%s' "$resp" | jq -r '.content[0].text // empty' 2>/dev/null || true)"
  fi
fi

# 3b. write the report (AI summary if we got one, plus the deterministic change list)
{
  echo "---"
  echo "type: $([ "$MODE" = "--weekly" ] && echo audit || echo digest)"
  echo "date: $today"
  echo "tags: [cadence, auto]"
  echo "---"
  echo
  echo "# $TITLE — $today"
  echo
  if [ -n "$summary" ]; then echo "$summary"; echo; fi
  echo "## Files changed (last: ${SINCE})"
  if [ -n "$changed" ]; then printf '%s\n' "$changed" | sed 's/^/- /'; else echo "- (nothing changed)"; fi
} > "$OUT"

# 4. commit + push (skip cleanly if nothing to commit)
git add "$OUT"
if git diff --cached --quiet; then echo "no changes to commit"; exit 0; fi
git commit -q -m "cron: $TITLE $today"
git push -q && echo "pushed $OUT"
