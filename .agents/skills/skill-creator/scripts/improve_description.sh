#!/usr/bin/env bash
# improve_description.sh — Calls Claude to generate an improved skill description.
# Usage: bash improve_description.sh --eval-results <json_file> --skill-path <dir> [OPTIONS]
# Output: Prints the new description string to stdout.

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/utils.sh"

# Defaults
MODEL=""
VERBOSE=false
EVAL_RESULTS_FILE=""
SKILL_PATH=""
HISTORY_JSON="[]"
LOG_DIR=""
ITERATION=0

# ── Helper ────────────────────────────────────────────────────────────────────

_call_claude_text() {
  # Reads prompt from stdin, returns response text to stdout
  local model="$1"
  local -a cmd=(env -u CLAUDECODE claude -p --output-format text)
  if [[ -n "$model" ]]; then
    cmd+=(--model "$model")
  fi
  "${cmd[@]}"
}

_json_escape() {
  local s="$1"
  s="${s//\\/\\\\}"
  s="${s//\"/\\\"}"
  s="${s//$'\n'/\\n}"
  s="${s//$'\r'/\\r}"
  s="${s//$'\t'/\\t}"
  printf '%s' "$s"
}

# improve_description <skill_name> <skill_content> <current_description> <eval_results_json> <history_json> <model> [log_dir] [iteration]
# Prints improved description to stdout
improve_description() {
  local skill_name="$1"
  local skill_content="$2"
  local current_description="$3"
  local eval_results_json="$4"
  local history_json="$5"
  local model="$6"
  local log_dir="${7:-}"
  local iteration="${8:-0}"

  # Build failed_triggers list (should_trigger=true, pass=false)
  local failed_triggers
  failed_triggers="$(echo "$eval_results_json" | jq -r '
    .results[]
    | select(.should_trigger == true and .pass == false)
    | "  - \"" + .query + "\" (triggered " + (.triggers|tostring) + "/" + (.runs|tostring) + " times)"
  ' 2>/dev/null || echo "")"

  # Build false_triggers list (should_trigger=false, pass=false)
  local false_triggers
  false_triggers="$(echo "$eval_results_json" | jq -r '
    .results[]
    | select(.should_trigger == false and .pass == false)
    | "  - \"" + .query + "\" (triggered " + (.triggers|tostring) + "/" + (.runs|tostring) + " times)"
  ' 2>/dev/null || echo "")"

  # Build scores summary line
  local total passed failed
  total="$(echo "$eval_results_json" | jq '.summary.total // 0')"
  passed="$(echo "$eval_results_json" | jq '.summary.passed // 0')"
  failed="$(echo "$eval_results_json" | jq '.summary.failed // 0')"
  local scores_summary="$passed/$total passed, $failed failed"

  # Build PREVIOUS ATTEMPTS section from history
  local prev_attempts=""
  local hist_len
  hist_len="$(echo "$history_json" | jq 'length')"

  local h
  for (( h=0; h<hist_len; h++ )); do
    local h_desc h_train_passed h_train_total h_test_passed h_test_total
    h_desc="$(echo "$history_json" | jq -r ".[$h].description // \"\"")"
    h_train_passed="$(echo "$history_json" | jq -r ".[$h].train_passed // 0")"
    h_train_total="$(echo "$history_json" | jq -r ".[$h].train_total // 0")"
    h_test_passed="$(echo "$history_json" | jq -r ".[$h].test_passed // \"?\"")"
    h_test_total="$(echo "$history_json" | jq -r ".[$h].test_total // \"?\"")"

    local attempt_header="<attempt train=${h_train_passed}/${h_train_total}"
    if [[ "$h_test_total" != "null" && "$h_test_total" != "?" ]]; then
      attempt_header+=", test=${h_test_passed}/${h_test_total}"
    fi
    attempt_header+=">"

    prev_attempts+="
$attempt_header
Description: \"$h_desc\"
Train results:"

    local num_results
    num_results="$(echo "$history_json" | jq ".[$h].train_results | length" 2>/dev/null || echo 0)"
    local r2
    for (( r2=0; r2<num_results; r2++ )); do
      local r_pass r_query r_triggers r_runs
      r_pass="$(echo "$history_json" | jq -r ".[$h].train_results[$r2].pass")"
      r_query="$(echo "$history_json" | jq -r ".[$h].train_results[$r2].query")"
      r_triggers="$(echo "$history_json" | jq -r ".[$h].train_results[$r2].triggers")"
      r_runs="$(echo "$history_json" | jq -r ".[$h].train_results[$r2].runs")"
      local marker="[FAIL]"
      [[ "$r_pass" == "true" ]] && marker="[PASS]"
      prev_attempts+="
  $marker \"$r_query\" (triggered $r_triggers/$r_runs)"
    done
    prev_attempts+="
</attempt>"
  done

  # If failed/false trigger sections are empty, show placeholder
  [[ -z "$failed_triggers" ]] && failed_triggers="  (none)"
  [[ -z "$false_triggers" ]]  && false_triggers="  (none)"

  # Build full prompt
  local prompt
  prompt="$(cat <<PROMPT
You are optimizing a skill description for a Claude Code skill called "${skill_name}". A "skill" is sort of like a prompt or workflow — it's a file that Claude can read to get instructions on how to do a specific task. Claude decides whether to read a skill based on the description alone, so the description must be precise and discriminating.

The description appears in Claude's "available_skills" list alongside many other skills. Claude reads this list and decides which skills (if any) are relevant to the user's request. A good description:
- Clearly states WHAT the skill does and WHEN to use it
- Uses trigger-worthy language that matches how users phrase relevant requests
- Does NOT trigger for unrelated requests (precision matters as much as recall)

Here's the current description:
<current_description>
"${current_description}"
</current_description>

Current scores (${scores_summary}):
<scores_summary>
FAILED TO TRIGGER (should have triggered but didn't):
${failed_triggers}

FALSE TRIGGERS (triggered but shouldn't have):
${false_triggers}
${prev_attempts:+
PREVIOUS ATTEMPTS (do NOT repeat these — try something structurally different):${prev_attempts}}
</scores_summary>

Skill content (for context on what the skill does):
<skill_content>
${skill_content}
</skill_content>

Based on the failures above, write an improved description. Guidelines:
- Target 100-200 words
- Hard limit: 1024 characters
- Use imperative phrasing: "Use this skill when...", "Load this skill to..."
- Include specific keywords that match how users request this type of task
- Be specific enough to NOT trigger for unrelated domains
- If there are false triggers, make the description more discriminating
- If there are missed triggers, broaden the relevant vocabulary
- Do NOT just rephrase the current description — try a structurally different approach if previous attempts exist
- Do NOT include angle brackets < > in your response

Please respond with only the new description text in <new_description> tags, nothing else.
PROMPT
)"

  # Call Claude
  local response
  response="$(echo "$prompt" | _call_claude_text "$model")"

  # Save transcript if log_dir provided
  if [[ -n "$log_dir" && -d "$log_dir" ]]; then
    local log_file="$log_dir/improve_iter_${iteration}.json"
    jq -n \
      --arg prompt "$prompt" \
      --arg response "$response" \
      --argjson iteration "$iteration" \
      '{ iteration: $iteration, prompt: $prompt, response: $response }' \
      > "$log_file" 2>/dev/null || true
  fi

  # Extract <new_description>...</new_description>
  local new_desc
  new_desc="$(echo "$response" | sed -n 's/.*<new_description>\(.*\)<\/new_description>.*/\1/p' | head -1)"

  # If not on single line, try multiline extraction
  if [[ -z "$new_desc" ]]; then
    new_desc="$(echo "$response" | awk '
      /<new_description>/ { capturing=1; sub(/.*<new_description>/, ""); }
      capturing && /<\/new_description>/ { sub(/<\/new_description>.*/, ""); print; capturing=0; next }
      capturing { print }
    ' | tr '\n' ' ' | sed 's/^[[:space:]]*//' | sed 's/[[:space:]]*$//')"
  fi

  # Fallback: use full response if tags not found
  if [[ -z "$new_desc" ]]; then
    new_desc="$response"
  fi

  # Trim whitespace
  new_desc="${new_desc#"${new_desc%%[![:space:]]*}"}"
  new_desc="${new_desc%"${new_desc##*[![:space:]]}"}"

  # Safety net: if > 1024 chars, ask Claude to shorten
  if [[ ${#new_desc} -gt 1024 ]]; then
    local shorten_prompt="The following skill description is too long (${#new_desc} characters, max 1024). Please shorten it while keeping the key trigger keywords and meaning intact. Respond with only the shortened text in <new_description> tags.

<description>
${new_desc}
</description>"

    local short_response
    short_response="$(echo "$shorten_prompt" | _call_claude_text "$model")"

    local short_desc
    short_desc="$(echo "$short_response" | sed -n 's/.*<new_description>\(.*\)<\/new_description>.*/\1/p' | head -1)"

    if [[ -z "$short_desc" ]]; then
      short_desc="$(echo "$short_response" | awk '
        /<new_description>/ { capturing=1; sub(/.*<new_description>/, ""); }
        capturing && /<\/new_description>/ { sub(/<\/new_description>.*/, ""); print; capturing=0; next }
        capturing { print }
      ' | tr '\n' ' ' | sed 's/^[[:space:]]*//' | sed 's/[[:space:]]*$//')"
    fi

    if [[ -n "$short_desc" ]]; then
      new_desc="$short_desc"
    else
      # Hard truncate as last resort
      new_desc="${new_desc:0:1021}..."
    fi
  fi

  printf '%s' "$new_desc"
}

# ── CLI ───────────────────────────────────────────────────────────────────────

_usage() {
  cat >&2 <<EOF
Usage: $0 --eval-results <json_file> --skill-path <dir> [OPTIONS]

Options:
  --eval-results <file>   JSON file (output of run_eval.sh)
  --skill-path <dir>      Path to skill directory
  --history <json>        JSON array of previous iteration history
  --model <name>          Claude model to use
  --log-dir <dir>         Directory to save transcript logs
  --iteration <n>         Iteration number (for log filenames)
  --verbose               Verbose output
EOF
  exit 1
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --eval-results) EVAL_RESULTS_FILE="$2"; shift 2 ;;
      --skill-path)   SKILL_PATH="$2"; shift 2 ;;
      --history)      HISTORY_JSON="$2"; shift 2 ;;
      --model)        MODEL="$2"; shift 2 ;;
      --log-dir)      LOG_DIR="$2"; shift 2 ;;
      --iteration)    ITERATION="$2"; shift 2 ;;
      --verbose)      VERBOSE=true; shift ;;
      -h|--help)      _usage ;;
      *) echo "Unknown option: $1" >&2; _usage ;;
    esac
  done

  [[ -z "$EVAL_RESULTS_FILE" ]] && { echo "ERROR: --eval-results required" >&2; _usage; }
  [[ -z "$SKILL_PATH" ]]        && { echo "ERROR: --skill-path required" >&2; _usage; }
  [[ ! -f "$EVAL_RESULTS_FILE" ]] && { echo "ERROR: eval-results file not found: $EVAL_RESULTS_FILE" >&2; exit 1; }

  parse_skill_md "$SKILL_PATH"

  EVAL_RESULTS_JSON="$(cat "$EVAL_RESULTS_FILE")"

  if [[ "$VERBOSE" == true ]]; then
    echo "Improving description for: $SKILL_NAME" >&2
  fi

  improve_description \
    "$SKILL_NAME" "$SKILL_CONTENT" "$SKILL_DESCRIPTION" \
    "$EVAL_RESULTS_JSON" "$HISTORY_JSON" "$MODEL" \
    "$LOG_DIR" "$ITERATION"

  echo  # trailing newline
fi
