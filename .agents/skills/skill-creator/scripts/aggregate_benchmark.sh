#!/usr/bin/env bash
# aggregate_benchmark.sh — Aggregate benchmark run results into a single JSON.
#
# Usage: aggregate_benchmark.sh <benchmark_dir>
#
# Scans <benchmark_dir> for grading.json files in two supported layouts:
#   Layout A: <benchmark_dir>/eval-N/<config>/run-N/grading.json
#   Layout B: <benchmark_dir>/runs/eval-N/<config>/run-N/grading.json
#
# Outputs aggregated JSON to stdout.
#
# Dependencies: jq (1.6+)

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── Argument parsing ──────────────────────────────────────────────────────────
if [[ $# -lt 1 ]]; then
  echo "Usage: aggregate_benchmark.sh <benchmark_dir>" >&2
  exit 1
fi
benchmark_dir="${1%/}"
[[ -d "$benchmark_dir" ]] || { echo "Error: directory not found: $benchmark_dir" >&2; exit 1; }

# ── Determine search root (supports two layouts) ──────────────────────────────
if [[ -d "$benchmark_dir/runs" ]]; then
  search_dir="$benchmark_dir/runs"
elif ls "$benchmark_dir"/eval-* 2>/dev/null | grep -q .; then
  search_dir="$benchmark_dir"
else
  echo "Error: no eval runs found in $benchmark_dir" >&2
  exit 1
fi

# ── Collect per-run data as JSONL ─────────────────────────────────────────────
collected_jsonl=""
while IFS= read -r grading_json; do
  run_dir=$(dirname "$grading_json")
  config_dir=$(dirname "$run_dir")
  eval_dir=$(dirname "$config_dir")

  config=$(basename "$config_dir")
  run_num=$(basename "$run_dir" | sed 's/^run-//')

  # Derive eval_id: prefer eval_metadata.json, else parse eval dir name (eval-N)
  eval_meta="$eval_dir/eval_metadata.json"
  if [[ -f "$eval_meta" ]]; then
    eval_id=$(jq -r '.eval_id // .id // 0' "$eval_meta" 2>/dev/null || echo "0")
  else
    eval_id=$(basename "$eval_dir" | sed 's/^eval-//')
    [[ "$eval_id" =~ ^[0-9]+$ ]] || eval_id="0"
  fi

  # Timing: try grading.json first, then timing.json fallback
  timing_json="$run_dir/timing.json"
  time_seconds=$(jq -r '
    .timing.total_duration_seconds //
    .total_duration_seconds //
    null
  ' "$grading_json")
  if [[ "$time_seconds" == "null" || -z "$time_seconds" ]]; then
    if [[ -f "$timing_json" ]]; then
      time_seconds=$(jq -r '.total_duration_seconds // null' "$timing_json")
    fi
  fi
  [[ "$time_seconds" == "null" || -z "$time_seconds" ]] && time_seconds="0"

  # Tokens: cascade through three sources
  tokens=$(jq -r '
    .execution_metrics.total_tokens //
    .timing.total_tokens //
    .execution_metrics.output_chars //
    0
  ' "$grading_json")
  [[ "$tokens" == "null" || -z "$tokens" ]] && tokens="0"

  # One JSONL record per grading.json
  record=$(jq -c \
    --arg config "$config" \
    --argjson run_number "$run_num" \
    --argjson eval_id "$eval_id" \
    --argjson time_seconds "$time_seconds" \
    --argjson tokens "$tokens" \
    '{
      config: $config,
      run_number: $run_number,
      eval_id: $eval_id,
      pass_rate: (.summary.pass_rate // (.summary.passed / (.summary.total // 1))),
      time_seconds: $time_seconds,
      tokens: $tokens,
      tool_calls: (.execution_metrics.tool_calls // .tool_calls // 0),
      errors: (.summary.failed // 0),
      expectations: (.summary.total // 0),
      notes: (.notes // [])
    }' "$grading_json")
  collected_jsonl="${collected_jsonl}${record}"$'\n'
done < <(find "$search_dir" -name "grading.json" | sort)

[[ -n "${collected_jsonl// /}" ]] || { echo "Error: no grading.json files found" >&2; exit 1; }

# ── Timestamp ─────────────────────────────────────────────────────────────────
generated_at=$(date -u "+%Y-%m-%dT%H:%M:%SZ")

# ── Aggregate (slurp all JSONL, compute stats + delta) ────────────────────────
echo "$collected_jsonl" | jq -s \
  --arg benchmark_dir "$benchmark_dir" \
  --arg generated_at "$generated_at" \
  '
  def round4: (. * 10000 | round) / 10000;

  def stats(values):
    (values | length) as $n |
    if $n == 0 then {"mean":0,"stddev":0,"min":0,"max":0}
    else
      ((values | add) / $n) as $mean |
      (if $n > 1 then
         ((values | map((. - $mean) * (. - $mean)) | add) / ($n - 1)) | sqrt
       else 0 end) as $sd |
      {
        "mean":   ($mean | round4),
        "stddev": ($sd   | round4),
        "min":    (values | min | round4),
        "max":    (values | max | round4)
      }
    end;

  # builds delta map:  config_A[metric] - config_B[metric]
  def delta_between(a; b):
    {
      "pass_rate":    ((a.pass_rate.mean    - b.pass_rate.mean)    | round4),
      "time_seconds": ((a.time_seconds.mean - b.time_seconds.mean) | round4),
      "tokens":       ((a.tokens.mean       - b.tokens.mean)       | round4)
    };

  . as $all |
  (map(.config) | unique | sort) as $configs |
  ($configs | map({key: ., value: [($all[] | select(.config == .))]}) | from_entries) as $by_config |

  # Build run_summary per config
  ($configs | map(. as $c |
    ($by_config[$c]) as $runs |
    {
      key: $c,
      value: {
        "runs":       ($runs | length),
        "pass_rate":  stats([$runs[].pass_rate]),
        "time_seconds": stats([$runs[].time_seconds]),
        "tokens":     stats([$runs[].tokens]),
        "tool_calls": stats([$runs[].tool_calls]),
        "errors":     stats([$runs[].errors])
      }
    }
  ) | from_entries) as $run_summary |

  # Delta: only when exactly 2 configs exist
  (if ($configs | length) == 2 then
    ([$run_summary[$configs[0]], $run_summary[$configs[1]]] |
      {"delta": delta_between(.[0]; .[1])})
  else {} end) as $delta_obj |

  {
    "metadata": {
      "benchmark_dir":  $benchmark_dir,
      "generated_at":   $generated_at,
      "total_runs":     ($all | length),
      "configs":        $configs
    },
    "runs": $all,
    "run_summary": ($run_summary + $delta_obj),
    "notes": []
  }
  '
