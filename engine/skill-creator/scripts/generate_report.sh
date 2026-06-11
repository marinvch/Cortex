#!/usr/bin/env bash
# generate_report.sh — Generate an HTML report from run_loop output JSON.
#
# Usage: generate_report.sh [--auto-refresh] [--skill-name <name>]
#                           [-o <output.html>] [<input.json>|-]
#
# Reads JSON from <input.json> or stdin (-).
# Writes HTML to <output.html> or stdout if -o is omitted.
#
# Dependencies: jq (1.6+)

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── Argument parsing ──────────────────────────────────────────────────────────
auto_refresh=""
skill_name=""
output=""
input="-"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --auto-refresh) auto_refresh="true"; shift ;;
    --skill-name)   skill_name="$2";     shift 2 ;;
    -o|--output)    output="$2";         shift 2 ;;
    --)  shift; [[ $# -gt 0 ]] && { input="$1"; shift; }; break ;;
    -*) echo "Unknown option: $1" >&2; exit 1 ;;
    *)  input="$1"; shift ;;
  esac
done

# ── Read input JSON ───────────────────────────────────────────────────────────
if [[ "$input" == "-" ]]; then
  json_data=$(cat)
else
  [[ -f "$input" ]] || { echo "Error: file not found: $input" >&2; exit 1; }
  json_data=$(cat "$input")
fi
[[ -n "$json_data" ]] || { echo "Error: empty input" >&2; exit 1; }

# ── Compute title prefix (HTML-escaped) ──────────────────────────────────────
if [[ -n "$skill_name" ]]; then
  _esc="${skill_name//&/&amp;}"
  _esc="${_esc//</&lt;}"
  _esc="${_esc//>/&gt;}"
  _esc="${_esc//\"/&quot;}"
  title_prefix="${_esc} &#x2014; "
else
  title_prefix=""
fi

# ── HTML generation (writes to stdout) ───────────────────────────────────────
_generate_html() {
  local json="$1"

  # ── HEAD ──────────────────────────────────────────────────────────────────
  printf '%s\n' '<!DOCTYPE html>'
  printf '%s\n' '<html>'
  printf '%s\n' '<head>'
  printf '%s\n' '    <meta charset="utf-8">'
  [[ -n "$auto_refresh" ]] && printf '%s\n' '    <meta http-equiv="refresh" content="5">'
  printf '    <title>%sSkill Description Optimization</title>\n' "$title_prefix"
  cat << 'CSS_EOF'
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@500;600&family=Lora:wght@400;500&display=swap" rel="stylesheet">
    <style>
        body {
            font-family: 'Lora', Georgia, serif;
            max-width: 100%;
            margin: 0 auto;
            padding: 20px;
            background: #faf9f5;
            color: #141413;
        }
        h1 { font-family: 'Poppins', sans-serif; color: #141413; }
        .explainer {
            background: white;
            padding: 15px;
            border-radius: 6px;
            margin-bottom: 20px;
            border: 1px solid #e8e6dc;
            color: #b0aea5;
            font-size: 0.875rem;
            line-height: 1.6;
        }
        .summary {
            background: white;
            padding: 15px;
            border-radius: 6px;
            margin-bottom: 20px;
            border: 1px solid #e8e6dc;
        }
        .summary p { margin: 5px 0; }
        .best { color: #788c5d; font-weight: bold; }
        .table-container { overflow-x: auto; width: 100%; }
        table {
            border-collapse: collapse;
            background: white;
            border: 1px solid #e8e6dc;
            border-radius: 6px;
            font-size: 12px;
            min-width: 100%;
        }
        th, td {
            padding: 8px;
            text-align: left;
            border: 1px solid #e8e6dc;
            white-space: normal;
            word-wrap: break-word;
        }
        th {
            font-family: 'Poppins', sans-serif;
            background: #141413;
            color: #faf9f5;
            font-weight: 500;
        }
        th.test-col { background: #6a9bcc; }
        th.query-col { min-width: 200px; }
        td.description {
            font-family: monospace;
            font-size: 11px;
            word-wrap: break-word;
            max-width: 400px;
        }
        td.result { text-align: center; font-size: 16px; min-width: 40px; }
        td.test-result { background: #f0f6fc; }
        .pass { color: #788c5d; }
        .fail { color: #c44; }
        .rate { font-size: 9px; color: #b0aea5; display: block; }
        tr:hover { background: #faf9f5; }
        .score {
            display: inline-block;
            padding: 2px 6px;
            border-radius: 4px;
            font-weight: bold;
            font-size: 11px;
        }
        .score-good { background: #eef2e8; color: #788c5d; }
        .score-ok   { background: #fef3c7; color: #d97706; }
        .score-bad  { background: #fceaea; color: #c44; }
        .best-row   { background: #f5f8f2; }
        th.positive-col { border-bottom: 3px solid #788c5d; }
        th.negative-col { border-bottom: 3px solid #c44; }
        th.test-col.positive-col { border-bottom: 3px solid #788c5d; }
        th.test-col.negative-col { border-bottom: 3px solid #c44; }
        .legend {
            font-family: 'Poppins', sans-serif;
            display: flex; gap: 20px;
            margin-bottom: 10px;
            font-size: 13px;
            align-items: center;
        }
        .legend-item { display: flex; align-items: center; gap: 6px; }
        .legend-swatch { width: 16px; height: 16px; border-radius: 3px; display: inline-block; }
        .swatch-positive { background: #141413; border-bottom: 3px solid #788c5d; }
        .swatch-negative { background: #141413; border-bottom: 3px solid #c44; }
        .swatch-test  { background: #6a9bcc; }
        .swatch-train { background: #141413; }
    </style>
</head>
<body>
CSS_EOF

  # ── BODY: header + explainer ───────────────────────────────────────────────
  printf '    <h1>%sSkill Description Optimization</h1>\n' "$title_prefix"
  cat << 'EXPLAINER_EOF'
    <div class="explainer">
        <strong>Optimizing your skill&#39;s description.</strong> This page updates automatically as
        Claude tests different versions of your skill&#39;s description. Each row is an iteration &mdash;
        a new description attempt. The columns show test queries: green checkmarks mean the skill
        triggered correctly (or correctly didn&#39;t trigger), red crosses mean it got it wrong.
        The &#34;Train&#34; score shows performance on queries used to improve the description; the
        &#34;Test&#34; score shows performance on held-out queries the optimizer hasn&#39;t seen.
        When it&#39;s done, Claude will apply the best-performing description to your skill.
    </div>
EXPLAINER_EOF

  # ── SUMMARY (dynamic) ─────────────────────────────────────────────────────
  jq -r '
    def he: gsub("&"; "&amp;") | gsub("<"; "&lt;") | gsub(">"; "&gt;") | gsub("\""; "&quot;");
    [
      "    <div class=\"summary\">",
      "        <p><strong>Original:</strong> \((.original_description // "N/A") | he)</p>",
      "        <p class=\"best\"><strong>Best:</strong> \((.best_description // "N/A") | he)</p>",
      "        <p><strong>Best Score:</strong> \(.best_score // "N/A") \(if .best_test_score then "(test)" else "(train)" end)</p>",
      "        <p><strong>Iterations:</strong> \(.iterations_run // 0) | <strong>Train:</strong> \(.train_size // "?") | <strong>Test:</strong> \(.test_size // "?")</p>",
      "    </div>"
    ] | join("\n")
  ' <<< "$json"

  # ── LEGEND (static) ───────────────────────────────────────────────────────
  cat << 'LEGEND_EOF'
    <div class="legend">
        <span style="font-weight:600">Query columns:</span>
        <span class="legend-item"><span class="legend-swatch swatch-positive"></span> Should trigger</span>
        <span class="legend-item"><span class="legend-swatch swatch-negative"></span> Should NOT trigger</span>
        <span class="legend-item"><span class="legend-swatch swatch-train"></span> Train</span>
        <span class="legend-item"><span class="legend-swatch swatch-test"></span> Test</span>
    </div>
LEGEND_EOF

  # ── TABLE: static header columns ──────────────────────────────────────────
  cat << 'TABLE_HEAD_EOF'
    <div class="table-container">
    <table>
        <thead>
            <tr>
                <th>Iter</th>
                <th>Train</th>
                <th>Test</th>
                <th class="query-col">Description</th>
TABLE_HEAD_EOF

  # Train query column headers
  jq -r '
    def he: gsub("&"; "&amp;") | gsub("<"; "&lt;") | gsub(">"; "&gt;");
    if (.history | length) > 0 then
      (.history[0].train_results // .history[0].results // [])[] |
      (if .should_trigger then "positive-col" else "negative-col" end) as $pol |
      "                <th class=\"\($pol)\">\(.query | he)</th>"
    else empty end
  ' <<< "$json"

  # Test query column headers
  jq -r '
    def he: gsub("&"; "&amp;") | gsub("<"; "&lt;") | gsub(">"; "&gt;");
    if (.history | length) > 0 then
      (.history[0].test_results // [])[] |
      (if .should_trigger then "positive-col" else "negative-col" end) as $pol |
      "                <th class=\"test-col \($pol)\">\(.query | he)</th>"
    else empty end
  ' <<< "$json"

  cat << 'TABLE_BODY_START_EOF'
            </tr>
        </thead>
        <tbody>
TABLE_BODY_START_EOF

  # ── TABLE BODY ROWS (dynamic) ──────────────────────────────────────────────
  jq -r '
    def he: gsub("&"; "&amp;") | gsub("<"; "&lt;") | gsub(">"; "&gt;") | gsub("\""; "&quot;");

    def score_cls(c; t):
      if t > 0 then
        (c / t) as $r |
        if $r >= 0.8 then "score-good"
        elif $r >= 0.5 then "score-ok"
        else "score-bad" end
      else "score-bad" end;

    def agg_correct(res):
      [res[] |
        (.triggers // 0) as $t | (.runs // 0) as $r |
        if (.should_trigger // true) then $t else $r - $t end
      ] | add // 0;

    def agg_total(res): [res[].runs // 0] | add // 0;

    .history as $hist |
    (if ($hist | length) > 0 then
       ($hist[0].train_results // $hist[0].results // []) | map(.query)
     else [] end) as $tq |
    (if ($hist | length) > 0 then
       ($hist[0].test_results // []) | map(.query)
     else [] end) as $sq |

    (if ($sq | length) > 0 then
       ($hist | to_entries | max_by(.value.test_passed // 0) | .value.iteration)
     else
       ($hist | to_entries | max_by(.value.train_passed // .value.passed // 0) | .value.iteration)
     end) as $best_iter |

    [$hist[] |
      . as $h |
      (.iteration // "?") as $iter |
      (.train_results // .results // []) as $tr |
      (.test_results // []) as $sr |
      ($tr | map({key: .query, value: .}) | from_entries) as $tbq |
      ($sr | map({key: .query, value: .}) | from_entries) as $sbq |
      agg_correct($tr) as $tc | agg_total($tr) as $tt |
      agg_correct($sr) as $sc | agg_total($sr) as $st |
      (if $iter == $best_iter then "best-row" else "" end) as $rc |
      (.description // "" | he) as $desc |

      ([$tq[] | . as $q |
         ($tbq[$q] // {}) as $r | ($r.pass // false) as $p |
         "<td class=\"result \(if $p then "pass" else "fail" end)\">\(if $p then "&#x2713;" else "&#x2717;" end)<span class=\"rate\">\($r.triggers // 0)/\($r.runs // 0)</span></td>"
       ] | join("")) as $tc_cells |

      ([$sq[] | . as $q |
         ($sbq[$q] // {}) as $r | ($r.pass // false) as $p |
         "<td class=\"result test-result \(if $p then "pass" else "fail" end)\">\(if $p then "&#x2713;" else "&#x2717;" end)<span class=\"rate\">\($r.triggers // 0)/\($r.runs // 0)</span></td>"
       ] | join("")) as $sc_cells |

      "            <tr class=\"\($rc)\"><td>\($iter)</td><td><span class=\"score \(score_cls($tc;$tt))\">\($tc)/\($tt)</span></td><td><span class=\"score \(score_cls($sc;$st))\">\($sc)/\($st)</span></td><td class=\"description\">\($desc)</td>\($tc_cells)\($sc_cells)</tr>"
    ] | join("\n")
  ' <<< "$json"

  # ── CLOSING ───────────────────────────────────────────────────────────────
  cat << 'CLOSE_EOF'
        </tbody>
    </table>
    </div>
</body>
</html>
CLOSE_EOF
}

# ── Run ───────────────────────────────────────────────────────────────────────
if [[ -n "$output" ]]; then
  _generate_html "$json_data" > "$output"
  echo "Report written to $output" >&2
else
  _generate_html "$json_data"
fi
