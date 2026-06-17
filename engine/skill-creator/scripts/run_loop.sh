#!/usr/bin/env bash
# run_loop.sh — Eval + improve loop for UNIS skill description optimizer
#
# Usage: run_loop.sh --eval-set <file> --skill-path <dir> --model <name> [options]
#   --eval-set <file>          JSON array of {query, should_trigger}  (required)
#   --skill-path <dir>         Path to skill directory                (required)
#   --model <name>             Claude model name                      (required)
#   --description <str>        Override starting description
#   --num-workers <n>          Parallel eval workers (default: 10)
#   --timeout <sec>            Per-query timeout in seconds (default: 30)
#   --max-iterations <n>       Max improvement iterations (default: 5)
#   --runs-per-query <n>       Eval runs per query (default: 3)
#   --trigger-threshold <0-1>  Pass threshold (default: 0.5)
#   --holdout <0-1>            Fraction held out for test (default: 0.4)
#   --verbose                  Print progress to stderr
#   --report auto|none|<path>  HTML report mode (default: auto)
#   --results-dir <dir>        Save outputs to timestamped subdir here

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/utils.sh"

# ── helpers ───────────────────────────────────────────────────────────────────

# Deterministically shuffle a JSON array using integer seed.
# Usage: _shuffle_json <json_array_string> [seed]
_shuffle_json() {
  local arr_json="$1" seed="${2:-42}"
  echo "$arr_json" | jq -r '.[] | @json' | \
    awk -v seed="$seed" 'BEGIN{srand(seed)} {printf "%.10f\t%s\n", rand(), $0}' | \
    LC_ALL=C sort -k1 -n | \
    cut -f2- | \
    jq -s '.'
}

# Split eval set into train/test (stratified by should_trigger).
# Sets globals SPLIT_TRAIN_JSON and SPLIT_TEST_JSON.
SPLIT_TRAIN_JSON=""
SPLIT_TEST_JSON=""
_split_eval_set() {
  local eval_set_json="$1" holdout="${2:-0.4}" seed="${3:-42}"

  local trigger_json no_trigger_json
  trigger_json="$(echo "$eval_set_json" | jq '[.[] | select(.should_trigger == true)]')"
  no_trigger_json="$(echo "$eval_set_json" | jq '[.[] | select(.should_trigger == false)]')"

  local shuffled_trigger shuffled_no_trigger
  shuffled_trigger="$(_shuffle_json "$trigger_json" "$seed")"
  shuffled_no_trigger="$(_shuffle_json "$no_trigger_json" "$seed")"

  local len_trigger len_no_trigger
  len_trigger="$(echo "$shuffled_trigger" | jq 'length')"
  len_no_trigger="$(echo "$shuffled_no_trigger" | jq 'length')"

  # max(1, floor(len * holdout))
  local n_test_trigger n_test_no_trigger
  n_test_trigger="$(awk -v n="$len_trigger" -v h="$holdout" 'BEGIN { v=int(n*h); print (v<1)?1:v }')"
  n_test_no_trigger="$(awk -v n="$len_no_trigger" -v h="$holdout" 'BEGIN { v=int(n*h); print (v<1)?1:v }')"

  local test_trigger test_no_trigger train_trigger train_no_trigger
  test_trigger="$(echo "$shuffled_trigger" | jq ".[0:${n_test_trigger}]")"
  test_no_trigger="$(echo "$shuffled_no_trigger" | jq ".[0:${n_test_no_trigger}]")"
  train_trigger="$(echo "$shuffled_trigger" | jq ".[${n_test_trigger}:]")"
  train_no_trigger="$(echo "$shuffled_no_trigger" | jq ".[${n_test_no_trigger}:]")"

  SPLIT_TRAIN_JSON="$(jq -n --argjson a "$train_trigger" --argjson b "$train_no_trigger" '$a + $b')"
  SPLIT_TEST_JSON="$(jq -n --argjson a "$test_trigger" --argjson b "$test_no_trigger" '$a + $b')"
}

# Open a local file in the browser (Windows Git Bash, Linux, macOS).
_open_report() {
  local path="$1"
  local win_path
  win_path="$(cygpath -w "$path" 2>/dev/null || echo "$path")"
  cmd /c start "$win_path" 2>/dev/null || \
    xdg-open "$path" 2>/dev/null || \
    open "$path" 2>/dev/null || true
}

# ── core loop function ────────────────────────────────────────────────────────

run_loop() {
  local eval_set_json="$1"
  local skill_dir="$2"
  local description_override="${3:-}"
  local num_workers="${4:-10}"
  local timeout_sec="${5:-30}"
  local max_iterations="${6:-5}"
  local runs_per_query="${7:-3}"
  local trigger_threshold="${8:-0.5}"
  local holdout="${9:-0.4}"
  local model="${10}"
  local verbose="${11:-false}"
  local live_report_path="${12:-}"
  local log_dir="${13:-}"

  # Parse skill metadata
  parse_skill_md "$skill_dir"
  local skill_name="$SKILL_NAME"
  local original_description="$SKILL_DESCRIPTION"

  local current_description
  if [[ -n "$description_override" ]]; then
    current_description="$description_override"
  else
    current_description="$original_description"
  fi

  # Split into train / test sets
  local train_set_json test_set_json
  if awk -v h="$holdout" 'BEGIN { exit (h > 0) ? 0 : 1 }'; then
    _split_eval_set "$eval_set_json" "$holdout" 42
    train_set_json="$SPLIT_TRAIN_JSON"
    test_set_json="$SPLIT_TEST_JSON"
    if [[ "$verbose" == "true" ]]; then
      local n_tr n_te
      n_tr="$(echo "$train_set_json" | jq 'length')"
      n_te="$(echo "$test_set_json" | jq 'length')"
      echo "Split: $n_tr train, $n_te test (holdout=$holdout)" >&2
    fi
  else
    train_set_json="$eval_set_json"
    test_set_json="[]"
  fi

  local train_size test_size
  train_size="$(echo "$train_set_json" | jq 'length')"
  test_size="$(echo "$test_set_json" | jq 'length')"

  local history_json="[]"
  local exit_reason="unknown"
  local iteration=1

  local tmpdir
  tmpdir="$(mktemp -d)"
  trap 'rm -rf "$tmpdir"' EXIT

  while [[ "$iteration" -le "$max_iterations" ]]; do
    if [[ "$verbose" == "true" ]]; then
      echo "" >&2
      echo "============================================================" >&2
      echo "Iteration $iteration/$max_iterations" >&2
      echo "Description: $current_description" >&2
      echo "============================================================" >&2
    fi

    # Combine train + test for a single parallel evaluation batch
    local combined_tmp="$tmpdir/combined_${iteration}.json"
    jq -n --argjson a "$train_set_json" --argjson b "$test_set_json" '$a + $b' > "$combined_tmp"

    # Run evaluation
    local all_results_json
    all_results_json="$("$SCRIPT_DIR/run_eval.sh" \
      --eval-set "$combined_tmp" \
      --skill-path "$skill_dir" \
      --description "$current_description" \
      --num-workers "$num_workers" \
      --timeout "$timeout_sec" \
      --runs-per-query "$runs_per_query" \
      --trigger-threshold "$trigger_threshold" \
      --model "$model")"

    local all_results_arr
    all_results_arr="$(echo "$all_results_json" | jq '.results')"

    # Split results back into train / test by query membership
    local train_queries_arr
    train_queries_arr="$(echo "$train_set_json" | jq '[.[].query]')"

    local train_results_arr test_results_arr
    train_results_arr="$(echo "$all_results_arr" | jq \
      --argjson tq "$train_queries_arr" \
      '[.[] | select(.query as $q | $tq | index($q) != null)]')"
    test_results_arr="$(echo "$all_results_arr" | jq \
      --argjson tq "$train_queries_arr" \
      '[.[] | select(.query as $q | $tq | index($q) == null)]')"

    # Train stats
    local train_passed train_total train_failed
    train_passed="$(echo "$train_results_arr" | jq '[.[] | select(.pass == true)] | length')"
    train_total="$(echo "$train_results_arr" | jq 'length')"
    train_failed=$(( train_total - train_passed ))

    # Test stats (null when no test set)
    local test_passed test_total test_failed
    if [[ "$test_size" -gt 0 ]]; then
      test_passed="$(echo "$test_results_arr" | jq '[.[] | select(.pass == true)] | length')"
      test_total="$(echo "$test_results_arr" | jq 'length')"
      test_failed=$(( test_total - test_passed ))
    else
      test_passed="null"
      test_total="null"
      test_failed="null"
      test_results_arr="null"
    fi

    # Build history entry (with backward-compat keys: passed/failed/total/results)
    local entry
    if [[ "$test_size" -gt 0 ]]; then
      entry="$(jq -n \
        --argjson iteration "$iteration" \
        --arg   description "$current_description" \
        --argjson train_passed  "$train_passed" \
        --argjson train_failed  "$train_failed" \
        --argjson train_total   "$train_total" \
        --argjson train_results "$train_results_arr" \
        --argjson test_passed   "$test_passed" \
        --argjson test_failed   "$test_failed" \
        --argjson test_total    "$test_total" \
        --argjson test_results  "$test_results_arr" \
        '{
          iteration:    $iteration,
          description:  $description,
          train_passed: $train_passed,
          train_failed: $train_failed,
          train_total:  $train_total,
          train_results:$train_results,
          test_passed:  $test_passed,
          test_failed:  $test_failed,
          test_total:   $test_total,
          test_results: $test_results,
          passed: $train_passed,
          failed: $train_failed,
          total:  $train_total,
          results:$train_results
        }')"
    else
      entry="$(jq -n \
        --argjson iteration "$iteration" \
        --arg   description "$current_description" \
        --argjson train_passed  "$train_passed" \
        --argjson train_failed  "$train_failed" \
        --argjson train_total   "$train_total" \
        --argjson train_results "$train_results_arr" \
        '{
          iteration:    $iteration,
          description:  $description,
          train_passed: $train_passed,
          train_failed: $train_failed,
          train_total:  $train_total,
          train_results:$train_results,
          test_passed:  null,
          test_failed:  null,
          test_total:   null,
          test_results: null,
          passed: $train_passed,
          failed: $train_failed,
          total:  $train_total,
          results:$train_results
        }')"
    fi

    history_json="$(echo "$history_json" | jq ". + [$entry]")"

    # Write live HTML report (with auto-refresh)
    if [[ -n "$live_report_path" ]]; then
      local partial_output
      partial_output="$(jq -n \
        --arg   original_description "$original_description" \
        --arg   best_description     "$current_description" \
        --arg   best_score           "in progress" \
        --argjson iterations_run     "$(echo "$history_json" | jq 'length')" \
        --argjson holdout            "$holdout" \
        --argjson train_size         "$train_size" \
        --argjson test_size          "$test_size" \
        --argjson history            "$history_json" \
        '{
          original_description: $original_description,
          best_description:     $best_description,
          best_score:           $best_score,
          iterations_run:       $iterations_run,
          holdout:              $holdout,
          train_size:           $train_size,
          test_size:            $test_size,
          history:              $history
        }')"
      echo "$partial_output" | "$SCRIPT_DIR/generate_report.sh" \
        --auto-refresh \
        --skill-name "$skill_name" \
        -o "$live_report_path" \
        - 2>/dev/null || true
    fi

    if [[ "$verbose" == "true" ]]; then
      echo "Train: $train_passed/$train_total passed, $train_failed failed" >&2
      if [[ "$test_size" -gt 0 ]]; then
        echo "Test:  $test_passed/$test_total passed" >&2
      fi
      echo "$train_results_arr" | jq -r \
        '.[] | "  [\(if .pass then "PASS" else "FAIL" end)] rate=\(.triggers)/\(.runs) expected=\(.should_trigger): \(.query | .[0:60])"' >&2
    fi

    # Check exit conditions
    if [[ "$train_failed" -eq 0 ]]; then
      exit_reason="all_passed (iteration $iteration)"
      if [[ "$verbose" == "true" ]]; then
        echo "" >&2
        echo "All train queries passed on iteration $iteration!" >&2
      fi
      break
    fi

    if [[ "$iteration" -eq "$max_iterations" ]]; then
      exit_reason="max_iterations ($max_iterations)"
      if [[ "$verbose" == "true" ]]; then
        echo "" >&2
        echo "Max iterations reached ($max_iterations)." >&2
      fi
      break
    fi

    if [[ "$verbose" == "true" ]]; then
      echo "" >&2
      echo "Improving description..." >&2
    fi

    # Blind history: strip all test_ keys before passing to improve
    local blinded_history
    blinded_history="$(echo "$history_json" | jq \
      '[.[] | del(.test_passed, .test_failed, .test_total, .test_results)]')"

    # Build train_results object in the shape improve_description.sh expects
    local train_results_obj
    train_results_obj="$(jq -n \
      --argjson results "$train_results_arr" \
      --argjson passed  "$train_passed" \
      --argjson failed  "$train_failed" \
      --argjson total   "$train_total" \
      '{results: $results, summary: {passed: $passed, failed: $failed, total: $total}}')"

    local eval_tmp="$tmpdir/eval_iter_${iteration}.json"
    local hist_tmp="$tmpdir/hist_iter_${iteration}.json"
    echo "$train_results_obj" > "$eval_tmp"
    echo "$blinded_history"   > "$hist_tmp"

    local improve_args=(
      --eval-results "$eval_tmp"
      --skill-path   "$skill_dir"
      --history      "$hist_tmp"
      --model        "$model"
      --iteration    "$iteration"
    )
    [[ -n "$log_dir" ]] && improve_args+=(--log-dir "$log_dir")

    local new_description
    new_description="$("$SCRIPT_DIR/improve_description.sh" "${improve_args[@]}")"

    if [[ "$verbose" == "true" && -n "$new_description" ]]; then
      echo "Proposed: $new_description" >&2
    fi

    current_description="$new_description"
    (( iteration++ ))
  done

  # Determine best iteration (by test score if test set exists, else train)
  local best_iter
  if [[ "$test_size" -gt 0 ]]; then
    best_iter="$(echo "$history_json" | jq 'max_by(.test_passed // 0) | .iteration')"
  else
    best_iter="$(echo "$history_json" | jq 'max_by(.train_passed) | .iteration')"
  fi

  local best_description best_train_passed best_train_total
  best_description="$(echo "$history_json" | \
    jq -r --argjson bi "$best_iter" '.[] | select(.iteration == $bi) | .description')"
  best_train_passed="$(echo "$history_json" | \
    jq -r --argjson bi "$best_iter" '.[] | select(.iteration == $bi) | .train_passed')"
  best_train_total="$(echo "$history_json" | \
    jq -r --argjson bi "$best_iter" '.[] | select(.iteration == $bi) | .train_total')"

  local best_score best_train_score best_test_score_json
  best_train_score="${best_train_passed}/${best_train_total}"

  if [[ "$test_size" -gt 0 ]]; then
    local best_test_passed best_test_total
    best_test_passed="$(echo "$history_json" | \
      jq -r --argjson bi "$best_iter" '.[] | select(.iteration == $bi) | .test_passed')"
    best_test_total="$(echo "$history_json" | \
      jq -r --argjson bi "$best_iter" '.[] | select(.iteration == $bi) | .test_total')"
    best_score="${best_test_passed}/${best_test_total}"
    best_test_score_json="\"${best_test_passed}/${best_test_total}\""
  else
    best_score="$best_train_score"
    best_test_score_json="null"
  fi

  local iterations_run
  iterations_run="$(echo "$history_json" | jq 'length')"

  if [[ "$verbose" == "true" ]]; then
    echo "" >&2
    echo "Exit reason: $exit_reason" >&2
    echo "Best score:  $best_score (iteration $best_iter)" >&2
  fi

  # Build and emit output JSON
  jq -n \
    --arg   exit_reason          "$exit_reason" \
    --arg   original_description "$original_description" \
    --arg   best_description     "$best_description" \
    --arg   best_score           "$best_score" \
    --arg   best_train_score     "$best_train_score" \
    --argjson best_test_score    "$best_test_score_json" \
    --arg   final_description    "$current_description" \
    --argjson iterations_run     "$iterations_run" \
    --argjson holdout            "$holdout" \
    --argjson train_size         "$train_size" \
    --argjson test_size          "$test_size" \
    --argjson history            "$history_json" \
    '{
      exit_reason:          $exit_reason,
      original_description: $original_description,
      best_description:     $best_description,
      best_score:           $best_score,
      best_train_score:     $best_train_score,
      best_test_score:      $best_test_score,
      final_description:    $final_description,
      iterations_run:       $iterations_run,
      holdout:              $holdout,
      train_size:           $train_size,
      test_size:            $test_size,
      history:              $history
    }'
}

# ── CLI ───────────────────────────────────────────────────────────────────────
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  description_override=""
  num_workers=10
  timeout_sec=30
  max_iterations=5
  runs_per_query=3
  trigger_threshold=0.5
  holdout=0.4
  verbose=false
  report_mode="auto"
  results_dir=""
  model=""
  eval_set_file=""
  skill_dir=""

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --eval-set)          eval_set_file="$2";        shift 2 ;;
      --skill-path)        skill_dir="$2";            shift 2 ;;
      --description)       description_override="$2"; shift 2 ;;
      --num-workers)       num_workers="$2";          shift 2 ;;
      --timeout)           timeout_sec="$2";          shift 2 ;;
      --max-iterations)    max_iterations="$2";       shift 2 ;;
      --runs-per-query)    runs_per_query="$2";       shift 2 ;;
      --trigger-threshold) trigger_threshold="$2";    shift 2 ;;
      --holdout)           holdout="$2";              shift 2 ;;
      --model)             model="$2";                shift 2 ;;
      --verbose)           verbose=true;              shift ;;
      --report)            report_mode="$2";          shift 2 ;;
      --results-dir)       results_dir="$2";          shift 2 ;;
      *) echo "Unknown option: $1" >&2; exit 1 ;;
    esac
  done

  [[ -z "$eval_set_file" ]] && { echo "Error: --eval-set is required" >&2; exit 1; }
  [[ -z "$skill_dir" ]]     && { echo "Error: --skill-path is required" >&2; exit 1; }
  [[ -z "$model" ]]         && { echo "Error: --model is required" >&2; exit 1; }
  [[ ! -f "$eval_set_file" ]] && { echo "Error: Eval set file not found: $eval_set_file" >&2; exit 1; }
  [[ ! -f "$skill_dir/SKILL.md" ]] && { echo "Error: No SKILL.md found at $skill_dir" >&2; exit 1; }

  eval_set_json="$(cat "$eval_set_file")"

  parse_skill_md "$skill_dir"
  skill_name="$SKILL_NAME"

  # Set up live report
  live_report_path=""
  if [[ "$report_mode" != "none" ]]; then
    local_timestamp="$(date +%Y%m%d_%H%M%S)"
    if [[ "$report_mode" == "auto" ]]; then
      live_report_path="/tmp/skill_description_report_${skill_name}_${local_timestamp}.html"
    else
      live_report_path="$report_mode"
    fi
    printf '<html><body><h1>Starting optimization loop...</h1><meta http-equiv="refresh" content="5"></body></html>' \
      > "$live_report_path"
    _open_report "$live_report_path" &
  fi

  # Set up results directory
  log_dir=""
  final_results_dir=""
  if [[ -n "$results_dir" ]]; then
    final_timestamp="$(date +%Y-%m-%d_%H%M%S)"
    final_results_dir="$results_dir/$final_timestamp"
    mkdir -p "$final_results_dir/logs"
    log_dir="$final_results_dir/logs"
  fi

  # Run the loop and capture output
  output="$(run_loop \
    "$eval_set_json" \
    "$skill_dir" \
    "$description_override" \
    "$num_workers" \
    "$timeout_sec" \
    "$max_iterations" \
    "$runs_per_query" \
    "$trigger_threshold" \
    "$holdout" \
    "$model" \
    "$verbose" \
    "$live_report_path" \
    "$log_dir")"

  # Emit JSON to stdout
  echo "$output"

  # Save to results dir
  [[ -n "$final_results_dir" ]] && echo "$output" > "$final_results_dir/results.json"

  # Write final HTML report (no auto-refresh)
  if [[ -n "$live_report_path" ]]; then
    echo "$output" | "$SCRIPT_DIR/generate_report.sh" \
      --skill-name "$skill_name" \
      -o "$live_report_path" \
      - 2>/dev/null || true
    echo "" >&2
    echo "Report: $live_report_path" >&2
  fi

  if [[ -n "$final_results_dir" && -n "$live_report_path" ]]; then
    cp "$live_report_path" "$final_results_dir/report.html" 2>/dev/null || true
    echo "Results saved to: $final_results_dir" >&2
  fi
fi
