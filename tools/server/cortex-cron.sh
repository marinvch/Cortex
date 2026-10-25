#!/usr/bin/env bash
# cortex-cron.sh — server-side autonomy for the living Cortex brain.
#
# Pulls the brain, gathers what changed, writes a digest (daily) or audit (weekly), commits + pushes.
# AI summary is OPTIONAL: only used when ANTHROPIC_API_KEY is set — otherwise a plain, deterministic
# git-based digest is written (boring is beautiful; it always works).
#
# Usage (from cron — `server-setup.sh cron` writes these lines for you):
#   BRAIN_DIR=$HOME/cortex-work bash cortex-cron.sh --daily
#   . ~/.config/cortex/cron.env; BRAIN_DIR=$HOME/cortex-work bash cortex-cron.sh --weekly
#
# The key is SOURCED from a 0600 env file, never written inline. A key on the command line lands in
# shell history, in `ps` for the life of the process, and — if copied into a crontab — in the output
# of `crontab -l`, which is the one command people run to check their schedule.
#
# Env:
#   BRAIN_DIR           path to a git clone of the brain repo. Falls back to CORTEX_ROOT, which is
#                       what the rest of Cortex uses — the two halves of server mode should not
#                       need two different variable names to say the same thing. BRAIN_DIR still
#                       wins when it is set, so existing crontabs keep working.
#   CORTEX_ROOT         used when BRAIN_DIR is unset (see above)
#   AI_OS_ROOT          the older name for CORTEX_ROOT, still read. CORTEX_ROOT wins when both are
#                       set, and the script says so once when they differ.
#   ANTHROPIC_API_KEY   optional; enables an AI summary of the changes
#   CORTEX_MODEL        optional; Claude model id. Model ids age out — when the log says "summary
#                       unavailable", this default is the first thing to check.
#   CORTEX_API_URL      optional; the messages endpoint. Overridable so the failure path is
#                       testable — a hardcoded URL cannot be exercised without the network.
#   CORTEX_SCRUB        optional; the scrubber, default tools/cortex-scrub.mjs beside this
#                       directory. It runs core/gate.js — credentials, the employer denylist on a
#                       home profile, personal data under CORTEX_PII — over what leaves this machine.
#   CORTEX_DEST_CHECK   optional; the destination checker, default tools/cortex-destinations.mjs
#                       beside this directory. It runs core/destinations.js for CORTEX_PROFILE.
#   CORTEX_PROFILE      home (default), work or lab. On work, the API URL and every remote must be
#                       on the approved list (CORTEX_DESTINATIONS, else ~/.cortex/allowed-destinations).
#
# Where things go is checked as well as what they hold (docs/adr/0030). Before the pull, the API
# call and the push, the destination goes through the checker. An API URL it refuses means no API
# call and the deterministic digest. A remote it refuses means the digest is committed locally and
# not pushed, exit 4. With no checker, only a home profile goes on unchecked; any other sends nothing.
#
# Two things leave the server, and both pass the scrubber first. The diff, before it is sent to the
# API: a finding aborts the run, exit 3, with nothing sent, written or pushed. The digest, before it
# is pushed: a finding aborts the same way, with nothing committed. The log names the KIND of what
# was found and its line, never the text. With no scrubber (no node, or this script copied alone),
# the API is not called at all and the digest is the deterministic one — file paths the brain's
# remote already holds — so nothing unscanned leaves.
set -euo pipefail

# A copy of cortex_root from tools/_cortex-lib.sh, which is not on the server to source: this
# script lands there beside only server-setup.sh. tools/test/cortex-root.test.sh fails when the two
# differ by a character, so edit the lib's and paste it here.
cortex_root(){
  local new="${CORTEX_ROOT:-}" old="${AI_OS_ROOT:-}"
  new="${new#"${new%%[![:space:]]*}"}"; new="${new%"${new##*[![:space:]]}"}"
  old="${old#"${old%%[![:space:]]*}"}"; old="${old%"${old##*[![:space:]]}"}"
  if [ -n "$new" ]; then
    if [ -n "$old" ] && [ "$old" != "$new" ]; then
      echo "cortex: CORTEX_ROOT and AI_OS_ROOT are both set and differ. Using CORTEX_ROOT ($new); AI_OS_ROOT ($old) is ignored." >&2
    fi
    printf '%s\n' "$new"
    return 0
  fi
  [ -n "$old" ] || return 1
  printf '%s\n' "$old"
}

MODE="${1:---daily}"
# BRAIN_DIR first, and cortex_root is not even asked when it is set: a crontab that names its clone
# gets no line about two variables it never read.
BRAIN_DIR="${BRAIN_DIR:-$(cortex_root || true)}"
: "${BRAIN_DIR:?set BRAIN_DIR (or CORTEX_ROOT; AI_OS_ROOT, the older name, is still read) to your brain clone}"
MODEL="${CORTEX_MODEL:-claude-sonnet-5}"
API_URL="${CORTEX_API_URL:-https://api.anthropic.com/v1/messages}"
# Resolved before the cd, from this script's own location, as server-setup.sh resolves this script.
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRUB="${CORTEX_SCRUB:-$HERE/../cortex-scrub.mjs}"
scrub_ready() { command -v node >/dev/null 2>&1 && [ -f "$SCRUB" ]; }
# scrub <what> — stdin through the gate. Prints the scrubber's verdict (kinds and lines only) and
# returns its exit code: 0 clean or warned, 2 refused, 1 could not run. Both non-zero codes stop the
# run: a scrubber that could not decide has not cleared anything.
scrub() {
  local verdict code=0
  verdict="$(node "$SCRUB" --check 2>&1)" || code=$?
  [ -n "$verdict" ] && printf '%s\n' "$verdict" | sed "s/^/cortex-cron: $1: /" >&2
  return "$code"
}
DEST="${CORTEX_DEST_CHECK:-$HERE/../cortex-destinations.mjs}"
PROFILE="$(printf '%s' "${CORTEX_PROFILE:-}" | tr -d '[:space:]' | tr '[:upper:]' '[:lower:]')"
# dest_check <kind> <url> [--inbound] — 0 when the destination may be reached. The checker's reason
# (host and path only) goes to stderr. Without a checker only home goes on: it allows any destination,
# and every other profile must not send what it could not check.
dest_check() {
  if command -v node >/dev/null 2>&1 && [ -f "$DEST" ]; then
    local verdict code=0
    verdict="$(node "$DEST" check "$@" 2>&1 >/dev/null)" || code=$?
    [ -n "$verdict" ] && printf '%s\n' "$verdict" | sed 's/^/cortex-cron: /' >&2
    return "$code"
  fi
  case "$PROFILE" in ""|home) return 0 ;; esac
  echo "cortex-cron: cannot check the $1 destination (node, and $DEST), and the $PROFILE profile sends nothing unchecked" >&2
  return 1
}
# remotes_ok [--inbound] — every URL git would use for the brain's remotes, push URLs unless inbound.
remotes_ok() {
  local r u
  local args=(--all --push)
  [ "${1:-}" = "--inbound" ] && args=(--all)
  for r in $(git remote); do
    while IFS= read -r u; do
      [ -n "$u" ] || continue
      dest_check git "$u" "$@" || return 1
    done < <(git remote get-url "${args[@]}" "$r")
  done
}
cd "$BRAIN_DIR"

# 1. sync
if remotes_ok --inbound; then
  git pull --ff-only -q || { echo "pull failed"; exit 1; }
else
  echo "cortex-cron: not pulling — the brain's remote is not an approved destination; working from the local clone" >&2
fi

today="$(date +%F)"
if [ "$MODE" = "--weekly" ]; then SINCE="7 days ago"; OUT="audits/${today}.md"; TITLE="Weekly audit";
else SINCE="24 hours ago"; OUT="digests/${today}.md"; TITLE="Daily digest"; fi

# 2. gather what changed (note files only; ignore generated/backup noise)
changed="$(git log --since="$SINCE" --name-only --pretty=format: -- '*.md' \
  | grep -Ev '(^$|\.bak|\.generated\.|digests/|audits/)' | sort -u || true)"

# recent note bodies as raw material (bounded, so cron stays cheap)
material="$(git log --since="$SINCE" -p --pretty='commit %h %ad' --date=short -- '*.md' \
  | head -c 60000 || true)"

# 3a. AI summary if a key is present — and only once the diff has passed the scrubber. The diff is
# the brain's raw history, so a credential, a denylisted employer name or (under CORTEX_PII=refuse)
# personal data in it would otherwise go to a third party verbatim.
summary=""
send=0
if [ -n "${ANTHROPIC_API_KEY:-}" ] && [ -n "$material" ]; then
  if ! scrub_ready; then
    echo "cortex-cron: not sending the changes to the API — the scrubber is not available (node, and $SCRUB)." >&2
    echo "cortex-cron: set CORTEX_SCRUB to tools/cortex-scrub.mjs in a Cortex checkout to turn the summary back on; writing the deterministic digest" >&2
  elif ! dest_check https "$API_URL"; then
    echo "cortex-cron: not sending the changes to the API — its URL is not an approved destination; writing the deterministic digest" >&2
  elif ! printf '%s' "$material" | scrub "the changes"; then
    echo "cortex-cron: refusing to send the changes to the API. Nothing was sent, written or pushed." >&2
    echo "cortex-cron: the brain's own history holds what was found: remove it (docs/erasure.md), and rotate it if it is a credential" >&2
    exit 3
  else
    send=1
  fi
fi

mkdir -p "$(dirname "$OUT")"

if [ "$send" = 1 ]; then
  prompt="You are Cortex, a personal knowledge assistant. Summarize what changed in the brain over the last period as a short, useful ${TITLE,,}: 3-6 bullets of what was captured/decided, and 1-2 follow-ups worth doing. Be concise and concrete. Raw material follows:\n\n${material}"
  # Thinking counts toward max_tokens (core/claude-code.js: model.thinking.counts-toward-max-tokens),
  # so a limit sized for the reply alone can end the turn before any text is written. 16000 leaves
  # room for thinking plus a short digest; the reply itself is still asked to be brief.
  max_tokens=16000
  # build JSON safely with a heredoc + jq if available; else minimal escaping
  if command -v jq >/dev/null 2>&1; then
    body="$(jq -n --arg m "$MODEL" --arg p "$prompt" --argjson n "$max_tokens" \
      '{model:$m, max_tokens:$n, messages:[{role:"user", content:$p}]}')"
  else
    esc="$(printf '%s' "$prompt" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))' 2>/dev/null || printf '""')"
    body="{\"model\":\"$MODEL\",\"max_tokens\":$max_tokens,\"messages\":[{\"role\":\"user\",\"content\":$esc}]}"
  fi
  resp="$(curl -sS "$API_URL" \
    -H "x-api-key: ${ANTHROPIC_API_KEY}" \
    -H "anthropic-version: 2023-06-01" \
    -H "content-type: application/json" \
    -d "$body" 2>/dev/null || true)"
  if command -v jq >/dev/null 2>&1; then
    # Read every text block, not `.content[0]`: a model that thinks may open with a `thinking`
    # block, and the first block then holds no text (model.response.read-by-block-type).
    summary="$(printf '%s' "$resp" | jq -r '[.content[]? | select(.type == "text") | .text] | join("")' 2>/dev/null || true)"
    # A refusal and a reply cut off at max_tokens are failed summaries, not short ones: publishing
    # half a sentence as the digest would be the quiet failure the block below exists to prevent
    # (model.response.refusal-stop-reason).
    stop="$(printf '%s' "$resp" | jq -r '.stop_reason // empty' 2>/dev/null || true)"
    case "$stop" in
      refusal)
        detail="$(printf '%s' "$resp" | jq -c '.stop_details // empty' 2>/dev/null || true)"
        echo "cortex-cron: the model declined the summary (stop_reason: refusal${detail:+ $detail})" >&2
        summary="" ;;
      max_tokens)
        echo "cortex-cron: the summary was cut off (stop_reason: max_tokens, limit $max_tokens)" >&2
        summary="" ;;
    esac
  else
    # The request was built and sent, and the answer cannot be read. Without jq the summary is
    # unreachable even on a completely successful call.
    echo "cortex-cron: summary unavailable — jq is not installed, so the API response cannot be parsed" >&2
  fi

  # The deterministic digest below is the intended fallback and still gets written. What must not
  # happen is this failing quietly: a bad key, a retired model id or an unreachable network would
  # otherwise produce a normal-looking digest, exit 0, and never tell anyone the AI half is dead.
  # That silence is how CORTEX_MODEL sat on a nonexistent model id without anyone noticing.
  if [ -z "$summary" ]; then
    err_detail="$(printf '%s' "$resp" | head -c 200 | tr '\n' ' ')"
    echo "cortex-cron: summary unavailable — the API call returned nothing usable (model: $MODEL)" >&2
    [ -n "$err_detail" ] && echo "cortex-cron: response was: $err_detail" >&2
    echo "cortex-cron: writing the deterministic digest instead; the run itself is fine" >&2
  fi
fi

# 3b. build the report (AI summary if we got one, plus the deterministic change list)
report="$(
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
)"

# 3c. scrub it before it is written, so a refused digest leaves no file to commit. The summary is
# model output, and a model can repeat what it read. With no scrubber there is no summary (3a), and
# what is left is file paths the remote already holds.
if scrub_ready && ! printf '%s\n' "$report" | scrub "the digest"; then
  echo "cortex-cron: refusing to push the $TITLE. Nothing was written, committed or pushed." >&2
  exit 3
fi
printf '%s\n' "$report" > "$OUT"

# 4. commit + push (skip cleanly if nothing to commit)
git add "$OUT"
if git diff --cached --quiet; then echo "no changes to commit"; exit 0; fi
git commit -q -m "cron: $TITLE $today"
if ! remotes_ok; then
  echo "cortex-cron: committed $OUT locally and did NOT push it — the brain's remote is not an approved destination" >&2
  exit 4
fi
git push -q && echo "pushed $OUT"
