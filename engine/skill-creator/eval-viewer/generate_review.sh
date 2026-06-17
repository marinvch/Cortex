#!/usr/bin/env bash
# generate_review.sh — Generate and serve an eval review page for eval results.
#
# Usage:
#   generate_review.sh <workspace> [--port PORT] [--skill-name NAME]
#   generate_review.sh <workspace> --previous-workspace /path/to/prev
#   generate_review.sh <workspace> --benchmark benchmark.json
#   generate_review.sh <workspace> --static output.html
#
# Requires: bash 4+, node 14+

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VIEWER_HTML="$SCRIPT_DIR/viewer.html"

if [[ ! -f "$VIEWER_HTML" ]]; then
  echo "Error: viewer.html not found at $VIEWER_HTML" >&2
  exit 1
fi

if ! command -v node &>/dev/null; then
  echo "Error: node is required but not found in PATH" >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------
PORT=3117
SKILL_NAME=""
WORKSPACE=""
PREVIOUS_WORKSPACE=""
BENCHMARK=""
STATIC_OUT=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --port|-p)            PORT="$2";              shift 2 ;;
    --skill-name|-n)      SKILL_NAME="$2";        shift 2 ;;
    --previous-workspace) PREVIOUS_WORKSPACE="$2"; shift 2 ;;
    --benchmark)          BENCHMARK="$2";          shift 2 ;;
    --static|-s)          STATIC_OUT="$2";         shift 2 ;;
    -*)
      echo "Unknown option: $1" >&2
      echo "Usage: generate_review.sh <workspace> [--port PORT] [--skill-name NAME] [--static out.html]" >&2
      exit 1
      ;;
    *) WORKSPACE="$1"; shift ;;
  esac
done

if [[ -z "$WORKSPACE" ]]; then
  cat >&2 <<'USAGE'
Usage: generate_review.sh <workspace> [OPTIONS]

  --port/-p PORT           Server port (default: 3117)
  --skill-name/-n NAME     Skill name for the page header
  --previous-workspace DIR Previous iteration workspace (shows old outputs + feedback)
  --benchmark FILE         Path to benchmark.json to show in Benchmark tab
  --static/-s FILE         Write standalone HTML to file instead of starting a server
USAGE
  exit 1
fi

# Resolve workspace path
WORKSPACE="$(cd "$WORKSPACE" 2>/dev/null && pwd)" \
  || { echo "Error: workspace directory not found: $WORKSPACE" >&2; exit 1; }

# Default skill name from directory name
if [[ -z "$SKILL_NAME" ]]; then
  SKILL_NAME="$(basename "$WORKSPACE" | sed 's/-workspace$//')"
fi

FEEDBACK_PATH="$WORKSPACE/feedback.json"

# Resolve optional paths
if [[ -n "$PREVIOUS_WORKSPACE" ]]; then
  PREVIOUS_WORKSPACE="$(cd "$PREVIOUS_WORKSPACE" 2>/dev/null && pwd)" \
    || { echo "Error: previous-workspace directory not found: $PREVIOUS_WORKSPACE" >&2; exit 1; }
fi

if [[ -n "$BENCHMARK" && ! -f "$BENCHMARK" ]]; then
  echo "Warning: benchmark file not found: $BENCHMARK" >&2
  BENCHMARK=""
fi

# ---------------------------------------------------------------------------
# Server mode: print info + open browser
# ---------------------------------------------------------------------------
if [[ -z "$STATIC_OUT" ]]; then
  # Attempt to free the port (best-effort, Git Bash / Linux)
  if command -v lsof &>/dev/null; then
    lsof -ti ":$PORT" 2>/dev/null | while IFS= read -r pid; do
      kill -TERM "$pid" 2>/dev/null || true
    done
    sleep 0.3 2>/dev/null || true
  fi

  URL="http://localhost:$PORT"
  echo ""
  echo "  Eval Viewer"
  echo "  ─────────────────────────────────"
  echo "  URL:       $URL"
  echo "  Workspace: $WORKSPACE"
  echo "  Feedback:  $FEEDBACK_PATH"
  [[ -n "$PREVIOUS_WORKSPACE" ]] && echo "  Previous:  $PREVIOUS_WORKSPACE"
  [[ -n "$BENCHMARK" ]]          && echo "  Benchmark: $BENCHMARK"
  echo ""
  echo "  Press Ctrl+C to stop."
  echo ""

  # Open browser after a short delay (let the server start first)
  (
    sleep 1
    if command -v cmd.exe &>/dev/null; then
      cmd.exe /c start "" "$URL" 2>/dev/null || true
    elif command -v xdg-open &>/dev/null; then
      xdg-open "$URL" 2>/dev/null || true
    elif command -v open &>/dev/null; then
      open "$URL" 2>/dev/null || true
    fi
  ) &
fi

# ---------------------------------------------------------------------------
# Delegate all logic to Node.js (handles both --static and server modes).
# Sentinel __NONE__ is used for optional args to avoid empty-string ambiguity.
# ---------------------------------------------------------------------------
node - \
  "$WORKSPACE" \
  "$FEEDBACK_PATH" \
  "$PORT" \
  "$SKILL_NAME" \
  "$VIEWER_HTML" \
  "${PREVIOUS_WORKSPACE:-__NONE__}" \
  "${BENCHMARK:-__NONE__}" \
  "${STATIC_OUT:-__NONE__}" \
  << 'NODE_EOF'
'use strict';
const http = require('http');
const fs   = require('fs');
const path = require('path');

const [,, workspace, feedbackPath, portStr, skillName,
         viewerHtmlPath, prevWorkspaceArg, benchmarkArg, staticOutArg] = process.argv;

const port         = parseInt(portStr, 10);
const hasPrev      = prevWorkspaceArg  !== '__NONE__';
const hasBenchmark = benchmarkArg      !== '__NONE__';
const isStatic     = staticOutArg      !== '__NONE__';

// ---------------------------------------------------------------------------
// File embedding helpers
// ---------------------------------------------------------------------------
const METADATA_FILES = new Set(['transcript.md', 'user_notes.md', 'metrics.json']);
const TEXT_EXTS  = new Set([
  '.txt', '.md',   '.json', '.csv',  '.py',  '.js', '.ts', '.tsx', '.jsx',
  '.yaml','.yml',  '.xml',  '.html', '.css', '.sh', '.rb', '.go',  '.rs',
  '.java','.c',    '.cpp',  '.h',    '.hpp', '.sql','.r',  '.toml',
]);
const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp']);
const MIME_MAP   = {
  '.svg':  'image/svg+xml',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.png':  'image/png',  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',  '.webp':'image/webp', '.pdf':  'application/pdf',
};
function getMime(ext) { return MIME_MAP[ext] || 'application/octet-stream'; }

function embedFile(fpath) {
  const name = path.basename(fpath);
  const ext  = path.extname(name).toLowerCase();
  try {
    if (TEXT_EXTS.has(ext)) {
      return { name, type: 'text', content: fs.readFileSync(fpath, 'utf8') };
    }
    const b64  = fs.readFileSync(fpath).toString('base64');
    const mime = getMime(ext);
    if (IMAGE_EXTS.has(ext)) return { name, type: 'image', mime, data_uri: `data:${mime};base64,${b64}` };
    if (ext === '.pdf')      return { name, type: 'pdf',   data_uri: `data:application/pdf;base64,${b64}` };
    if (ext === '.xlsx')     return { name, type: 'xlsx',  data_b64: b64 };
    return { name, type: 'binary', mime, data_uri: `data:${mime};base64,${b64}` };
  } catch {
    return { name, type: 'error', content: '(Error reading file)' };
  }
}

// ---------------------------------------------------------------------------
// Workspace scanning
// ---------------------------------------------------------------------------
const SKIP_DIRS = new Set(['node_modules', '.git', '__pycache__', 'skill', 'inputs']);

function buildRun(root, runDir) {
  let prompt = '', evalId = null;

  // Try eval_metadata.json in run dir, then parent dir
  for (const c of [path.join(runDir, 'eval_metadata.json'), path.join(runDir, '..', 'eval_metadata.json')]) {
    if (fs.existsSync(c)) {
      try {
        const m  = JSON.parse(fs.readFileSync(c, 'utf8'));
        prompt   = m.prompt   || '';
        evalId   = m.eval_id  ?? null;
      } catch { /* ignore */ }
      if (prompt) break;
    }
  }

  // Fallback: extract "## Eval Prompt" section from transcript.md
  if (!prompt) {
    for (const c of [path.join(runDir, 'transcript.md'), path.join(runDir, 'outputs', 'transcript.md')]) {
      if (fs.existsSync(c)) {
        try {
          const m = fs.readFileSync(c, 'utf8').match(/## Eval Prompt\n\n([\s\S]*?)(?=\n##|$)/);
          if (m) prompt = m[1].trim();
        } catch { /* ignore */ }
        if (prompt) break;
      }
    }
  }

  if (!prompt) prompt = '(No prompt found)';

  const runId  = path.relative(root, runDir).replace(/[/\\]/g, '-');
  const outDir = path.join(runDir, 'outputs');
  let outputs  = [];

  if (fs.existsSync(outDir)) {
    outputs = fs.readdirSync(outDir)
      .sort()
      .filter(f => !METADATA_FILES.has(f))
      .map(f => path.join(outDir, f))
      .filter(p => { try { return fs.statSync(p).isFile(); } catch { return false; } })
      .map(embedFile);
  }

  let grading = null;
  for (const c of [path.join(runDir, 'grading.json'), path.join(runDir, '..', 'grading.json')]) {
    if (fs.existsSync(c)) {
      try { grading = JSON.parse(fs.readFileSync(c, 'utf8')); break; } catch { /* ignore */ }
    }
  }

  return { id: runId, prompt, eval_id: evalId, outputs, grading };
}

function findRunsInner(root, current, runs) {
  try { if (!fs.statSync(current).isDirectory()) return; } catch { return; }
  if (fs.existsSync(path.join(current, 'outputs'))) {
    runs.push(buildRun(root, current));
    return;
  }
  let entries;
  try { entries = fs.readdirSync(current).sort(); } catch { return; }
  for (const child of entries) {
    if (SKIP_DIRS.has(child)) continue;
    const cp = path.join(current, child);
    try { if (fs.statSync(cp).isDirectory()) findRunsInner(root, cp, runs); } catch { /* ignore */ }
  }
}

function findRuns(root) {
  const runs = [];
  findRunsInner(root, root, runs);
  return runs.sort((a, b) => {
    const ea = a.eval_id ?? Infinity, eb = b.eval_id ?? Infinity;
    return ea !== eb ? ea - eb : String(a.id).localeCompare(String(b.id));
  });
}

// ---------------------------------------------------------------------------
// Previous workspace loader
// ---------------------------------------------------------------------------
function loadPrevious(prevWs) {
  const feedback = {}, outputs = {};
  const fbPath = path.join(prevWs, 'feedback.json');
  if (fs.existsSync(fbPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(fbPath, 'utf8'));
      for (const r of (data.reviews || [])) {
        if (r.run_id && (r.feedback || '').trim()) feedback[r.run_id] = r.feedback;
      }
    } catch { /* ignore */ }
  }
  for (const r of findRuns(prevWs)) {
    if (r.outputs && r.outputs.length) outputs[r.id] = r.outputs;
  }
  return { feedback, outputs };
}

// ---------------------------------------------------------------------------
// HTML generation
// ---------------------------------------------------------------------------
let viewerHtml;
try { viewerHtml = fs.readFileSync(viewerHtmlPath, 'utf8'); }
catch (e) { process.stderr.write(`Error: Cannot read viewer.html: ${e.message}\n`); process.exit(1); }

let prevFeedback = {}, prevOutputs = {};
if (hasPrev) {
  const prev = loadPrevious(prevWorkspaceArg);
  prevFeedback = prev.feedback;
  prevOutputs  = prev.outputs;
}

let benchmarkData = null;
if (hasBenchmark && fs.existsSync(benchmarkArg)) {
  try { benchmarkData = JSON.parse(fs.readFileSync(benchmarkArg, 'utf8')); } catch { /* ignore */ }
}

function generateHTML(runs) {
  const embedded = {
    skill_name:        skillName,
    runs,
    previous_feedback: prevFeedback,
    previous_outputs:  prevOutputs,
  };
  if (benchmarkData) embedded.benchmark = benchmarkData;
  return viewerHtml.replace(
    '/*__EMBEDDED_DATA__*/',
    `const EMBEDDED_DATA = ${JSON.stringify(embedded)};`,
  );
}

// ---------------------------------------------------------------------------
// Static mode — write HTML file and exit
// ---------------------------------------------------------------------------
if (isStatic) {
  const runs = findRuns(workspace);
  if (!runs.length) {
    process.stderr.write(`Error: No runs found in ${workspace}\n`);
    process.exit(1);
  }
  const html   = generateHTML(runs);
  const outDir = path.dirname(path.resolve(staticOutArg));
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(staticOutArg, html, 'utf8');
  process.stderr.write(`\n  Static viewer written to: ${staticOutArg}\n\n`);
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Server mode — regenerate HTML on every GET / so new eval outputs appear
// after refreshing without restarting the server
// ---------------------------------------------------------------------------
const runs0 = findRuns(workspace);
if (!runs0.length) {
  process.stderr.write(`Error: No runs found in ${workspace}\n`);
  process.exit(1);
}

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
    const buf = Buffer.from(generateHTML(findRuns(workspace)), 'utf8');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': buf.length });
    res.end(buf);

  } else if (req.method === 'GET' && req.url === '/api/feedback') {
    try {
      const data = fs.existsSync(feedbackPath) ? fs.readFileSync(feedbackPath) : Buffer.from('{}');
      res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': data.length });
      res.end(data);
    } catch { res.writeHead(500); res.end('{}'); }

  } else if (req.method === 'POST' && req.url === '/api/feedback') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        if (!data || !Array.isArray(data.reviews)) throw new Error("Expected JSON with 'reviews' key");
        fs.writeFileSync(feedbackPath, JSON.stringify(data, null, 2) + '\n', 'utf8');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"ok":true}');
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });

  } else {
    res.writeHead(404);
    res.end('Not Found');
  }
});

server.on('error', e => {
  const msg = e.code === 'EADDRINUSE'
    ? `Error: Port ${port} is already in use. Use --port to specify a different port.\n`
    : `Server error: ${e.message}\n`;
  process.stderr.write(msg);
  process.exit(1);
});

server.listen(port, '127.0.0.1', () => {});
process.on('SIGINT', () => { server.close(); process.exit(0); });
NODE_EOF
