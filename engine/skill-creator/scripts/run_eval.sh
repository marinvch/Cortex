#!/usr/bin/env bash
# run_eval.sh — Core eval engine: tests whether skill description triggers Claude for given queries.
# Usage: bash run_eval.sh --eval-set <json_file> --skill-path <dir> [OPTIONS]
# Output: JSON to stdout.

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/utils.sh"

# Defaults
NUM_WORKERS=10
TIMEOUT=30
RUNS_PER_QUERY=3
TRIGGER_THRESHOLD=0.5
MODEL=""
VERBOSE=false
DESCRIPTION_OVERRIDE=""
EVAL_SET_FILE=""
SKILL_PATH=""

# ── Helpers ──────────────────────────────────────────────────────────────────

_uuid8() {
  if command -v uuidgen &>/dev/null; then
    uuidgen | tr -d '-' | tr '[:upper:]' '[:lower:]' | head -c 8
  elif [[ -r /proc/sys/kernel/random/uuid ]]; then
    tr -d '-' < /proc/sys/kernel/random/uuid | head -c 8
  else
    # Fallback: use $RANDOM
    printf '%04x%04x' "$RANDOM" "$RANDOM"
  fi
}

_json_escape() {
  # Escape a string for embedding in JSON
  local s="$1"
  s="${s//\\/\\\\}"
  s="${s//\"/\\\"}"
  s="${s//$'\n'/\\n}"
  s="${s//$'\r'/\\r}"
  s="${s//$'\t'/\\t}"
  printf '%s' "$s"
}

# run_single_query <query> <skill_name> <description> <timeout> <project_root> <model>
# Returns 0 if skill was triggered, 1 if not.
run_single_query() {
  local query="$1"
  local skill_name="$2"
  local description="$3"
  local timeout_sec="$4"
  local project_root="$5"
  local model="$6"

  local uuid8
  uuid8="$(_uuid8)"
  local temp_cmd_dir="$project_root/.claude/commands"
  local temp_cmd_file="$temp_cmd_dir/${skill_name}-skill-${uuid8}.md"

  # Create temp skill command file
  mkdir -p "$temp_cmd_dir"
  cat > "$temp_cmd_file" <<EOF
---
description: ${description}
---
EOF

  local triggered=false
  local tmpout
  tmpout="$(mktemp)"

  # Build claude command
  local -a cmd=()
  cmd+=(env -u CLAUDECODE claude -p "$query"
        --output-format stream-json
        --verbose
        --include-partial-messages)
  if [[ -n "$model" ]]; then
    cmd+=(--model "$model")
  fi

  # Run with timeout, capture stdout
  if timeout "$timeout_sec" "${cmd[@]}" > "$tmpout" 2>/dev/null; then
    : # completed normally
  fi

  # Parse stream-json for tool_use events referencing this skill file
  local tool_name tool_input
  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    # Check if it's a stream_event with content_block_start of type tool_use
    local event_type
    event_type="$(echo "$line" | jq -r '.type // empty' 2>/dev/null)" || continue
    [[ "$event_type" != "stream_event" ]] && continue

    local inner_type
    inner_type="$(echo "$line" | jq -r '.event.type // empty' 2>/dev/null)" || continue
    [[ "$inner_type" != "content_block_start" ]] && continue

    local cb_type cb_name
    cb_type="$(echo "$line" | jq -r '.event.content_block.type // empty' 2>/dev/null)" || continue
    [[ "$cb_type" != "tool_use" ]] && continue

    cb_name="$(echo "$line" | jq -r '.event.content_block.name // empty' 2>/dev/null)" || continue

    # Check if tool name is Skill or Read
    if [[ "$cb_name" == "Skill" || "$cb_name" == "Read" ]]; then
      # Check if the input references our temp file
      local cb_input
      cb_input="$(echo "$line" | jq -c '.event.content_block.input // {}' 2>/dev/null)" || continue
      if echo "$cb_input" | grep -qF "${skill_name}-skill-${uuid8}"; then
        triggered=true
        break
      fi
    fi
  done < "$tmpout"

  # Cleanup
  rm -f "$tmpout" "$temp_cmd_file"

  if [[ "$triggered" == true ]]; then
    return 0
  else
    return 1
  fi
}

# run_eval_set — runs all queries with parallelism, writes results to a tmp dir
# run_eval <eval_set_json> <skill_name> <description> <num_workers> <timeout> <project_root> <runs_per_query> <trigger_threshold> <model>
# Prints JSON result to stdout
run_eval() {
  local eval_set_json="$1"
  local skill_name="$2"
  local description="$3"
  local num_workers="$4"
  local timeout_sec="$5"
  local project_root="$6"
  local runs_per_query="$7"
  local trigger_threshold="$8"
  local model="$9"

  local tmpdir
  tmpdir="$(mktemp -d)"
  trap 'rm -rf "$tmpdir"' RETURN

  # Parse queries from eval_set JSON array
  # Each element: { "query": "...", "should_trigger": true/false }
  local num_queries
  num_queries="$(echo "$eval_set_json" | jq 'length')"

  local results_file="$tmpdir/results.json"
  echo "[]" > "$results_file"

  local running=0
  local -a pids=()
  local -a query_indices=()

  # Process each query
  local i
  for (( i=0; i<num_queries; i++ )); do
    local query should_trigger
    query="$(echo "$eval_set_json" | jq -r ".[$i].query")"
    should_trigger="$(echo "$eval_set_json" | jq -r ".[$i].should_trigger")"

    # Run runs_per_query times for this query
    local triggers_file="$tmpdir/triggers_$i"
    echo "0" > "$triggers_file"

    (
      local triggers=0
      local r
      for (( r=0; r<runs_per_query; r++ )); do
        if run_single_query "$query" "$skill_name" "$description" "$timeout_sec" "$project_root" "$model"; then
          (( triggers++ )) || true
        fi
      done
      echo "$triggers" > "$triggers_file"
    ) &
    pids+=($!)
    (( running++ )) || true

    # Throttle workers
    if (( running >= num_workers )); then
      wait "${pids[0]}"
      pids=("${pids[@]:1}")
      (( running-- )) || true
    fi
  done

  # Wait for remaining jobs
  for pid in "${pids[@]}"; do
    wait "$pid" || true
  done

  # Aggregate results
  local total=0 passed=0 failed=0
  local results_array="["
  local first=true

  for (( i=0; i<num_queries; i++ )); do
    local query should_trigger triggers trigger_rate pass
    query="$(echo "$eval_set_json" | jq -r ".[$i].query")"
    should_trigger="$(echo "$eval_set_json" | jq -r ".[$i].should_trigger")"
    triggers="$(cat "$tmpdir/triggers_$i" 2>/dev/null || echo 0)"

    # trigger_rate = triggers / runs_per_query (as float using awk)
    trigger_rate="$(awk "BEGIN { printf \"%.4f\", $triggers / $runs_per_query }")"

    # Determine pass/fail
    if [[ "$should_trigger" == "true" ]]; then
      if awk "BEGIN { exit ($trigger_rate >= $trigger_threshold) ? 0 : 1 }"; then
        pass="true"
        (( passed++ )) || true
      else
        pass="false"
        (( failed++ )) || true
      fi
    else
      if awk "BEGIN { exit ($trigger_rate < $trigger_threshold) ? 0 : 1 }"; then
        pass="true"
        (( passed++ )) || true
      else
        pass="false"
        (( failed++ )) || true
      fi
    fi
    (( total++ )) || true

    local q_escaped
    q_escaped="$(_json_escape "$query")"

    if [[ "$first" == true ]]; then
      first=false
    else
      results_array+=","
    fi
    results_array+="{\"query\":\"$q_escaped\",\"should_trigger\":$should_trigger,\"triggers\":$triggers,\"runs\":$runs_per_query,\"trigger_rate\":$trigger_rate,\"pass\":$pass}"
  done
  results_array+="]"

  local desc_escaped
  desc_escaped="$(_json_escape "$description")"
  local name_escaped
  name_escaped="$(_json_escape "$skill_name")"

  # Output JSON result
  jq -n \
    --arg skill_name "$skill_name" \
    --arg description "$description" \
    --argjson results "$results_array" \
    --argjson total "$total" \
    --argjson passed "$passed" \
    --argjson failed "$failed" \
    '{
      skill_name: $skill_name,
      description: $description,
      results: $results,
      summary: {
        total: $total,
        passed: $passed,
        failed: $failed
      }
    }'
}

# ── CLI ───────────────────────────────────────────────────────────────────────

_usage() {
  cat >&2 <<EOF
Usage: $0 --eval-set <json_file> --skill-path <dir> [OPTIONS]

Options:
  --eval-set <file>           JSON file with array of {query, should_trigger}
  --skill-path <dir>          Path to skill directory
  --description <str>         Override description (default: from SKILL.md)
  --num-workers <n>           Parallel workers (default: $NUM_WORKERS)
  --timeout <sec>             Timeout per query (default: $TIMEOUT)
  --runs-per-query <n>        Runs per query (default: $RUNS_PER_QUERY)
  --trigger-threshold <0-1>   Threshold to count as triggered (default: $TRIGGER_THRESHOLD)
  --model <name>              Claude model to use
  --verbose                   Verbose output
EOF
  exit 1
}

# Only parse CLI args when run directly (not sourced)
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --eval-set)       EVAL_SET_FILE="$2"; shift 2 ;;
      --skill-path)     SKILL_PATH="$2"; shift 2 ;;
      --description)    DESCRIPTION_OVERRIDE="$2"; shift 2 ;;
      --num-workers)    NUM_WORKERS="$2"; shift 2 ;;
      --timeout)        TIMEOUT="$2"; shift 2 ;;
      --runs-per-query) RUNS_PER_QUERY="$2"; shift 2 ;;
      --trigger-threshold) TRIGGER_THRESHOLD="$2"; shift 2 ;;
      --model)          MODEL="$2"; shift 2 ;;
      --verbose)        VERBOSE=true; shift ;;
      -h|--help)        _usage ;;
      *) echo "Unknown option: $1" >&2; _usage ;;
    esac
  done

  [[ -z "$EVAL_SET_FILE" ]] && { echo "ERROR: --eval-set required" >&2; _usage; }
  [[ -z "$SKILL_PATH" ]]    && { echo "ERROR: --skill-path required" >&2; _usage; }
  [[ ! -f "$EVAL_SET_FILE" ]] && { echo "ERROR: eval-set file not found: $EVAL_SET_FILE" >&2; exit 1; }

  parse_skill_md "$SKILL_PATH"

  DESCRIPTION="${DESCRIPTION_OVERRIDE:-$SKILL_DESCRIPTION}"
  EVAL_SET_JSON="$(cat "$EVAL_SET_FILE")"
  PROJECT_ROOT="$(cd "$SKILL_PATH/../../../.." && pwd)"

  if [[ "$VERBOSE" == true ]]; then
    echo "Skill: $SKILL_NAME" >&2
    echo "Description: $DESCRIPTION" >&2
    echo "Project root: $PROJECT_ROOT" >&2
    echo "Workers: $NUM_WORKERS, Timeout: $TIMEOUT, Runs/query: $RUNS_PER_QUERY" >&2
  fi

  run_eval "$EVAL_SET_JSON" "$SKILL_NAME" "$DESCRIPTION" \
    "$NUM_WORKERS" "$TIMEOUT" "$PROJECT_ROOT" \
    "$RUNS_PER_QUERY" "$TRIGGER_THRESHOLD" "$MODEL"
fi
