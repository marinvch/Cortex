// linediff.mjs — the unified line diff a per-file question shows.
//
// When `/cortex` asks "the team edited this file and the template moved too — what now?", the
// answer depends on what is actually different, and a model paraphrasing two files is the one step
// that must not be approximate. So the diff is computed: a longest-common-subsequence over lines,
// printed as unified hunks with three lines of context. No dependency (ADR 0004), and no `git diff
// --no-index`, which would need a temp file and a git on the path to answer a question about text.
//
// Both sides are compared under the hash's rule (`stamps.mjs`): CRLF is LF and trailing newlines do
// not count, so a diff never shows a change the state machine did not see. Deterministic: ties
// resolve to the deletion first, every time. Quadratic, which is fine for the files Cortex stamps
// (tens to hundreds of lines); past a size bound it degrades to "all of one, then all of the other"
// rather than stalling — still a correct diff, only a less minimal one.

const MAX_CELLS = 4_000_000;

const linesOf = (text) => {
  const t = String(text).replace(/\r\n/g, "\n").replace(/\n+$/, "");
  return t === "" ? [] : t.split("\n");
};

/** The unified diff from `a` to `b` (`-` lines of a, `+` lines of b), or "" when they are equal. */
export function lineDiff(a, b, context = 3) {
  const A = linesOf(a);
  const B = linesOf(b);
  if (A.length === B.length && A.every((l, i) => l === B[i])) return "";

  const ops = []; // { t: " " | "-" | "+", line }
  const n = A.length;
  const m = B.length;
  if ((n + 1) * (m + 1) > MAX_CELLS) {
    for (const line of A) ops.push({ t: "-", line });
    for (const line of B) ops.push({ t: "+", line });
  } else {
    // lcs[i][j] = length of the LCS of A[i..] and B[j..], flattened.
    const w = m + 1;
    const lcs = new Uint32Array((n + 1) * w);
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        lcs[i * w + j] = A[i] === B[j] ? lcs[(i + 1) * w + j + 1] + 1 : Math.max(lcs[(i + 1) * w + j], lcs[i * w + j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && A[i] === B[j]) { ops.push({ t: " ", line: A[i] }); i++; j++; }
      else if (j >= m || (i < n && lcs[(i + 1) * w + j] >= lcs[i * w + j + 1])) { ops.push({ t: "-", line: A[i] }); i++; }
      else { ops.push({ t: "+", line: B[j] }); j++; }
    }
  }

  // Line numbers on each side before each op, for the hunk headers.
  const aAt = [];
  const bAt = [];
  let ai = 0;
  let bi = 0;
  for (const op of ops) {
    aAt.push(ai);
    bAt.push(bi);
    if (op.t !== "+") ai++;
    if (op.t !== "-") bi++;
  }

  const changed = ops.map((op, k) => (op.t === " " ? -1 : k)).filter((k) => k >= 0);
  const hunks = [];
  for (const k of changed) {
    const start = Math.max(0, k - context);
    const end = Math.min(ops.length - 1, k + context);
    const last = hunks[hunks.length - 1];
    if (last && start <= last.end + 1) last.end = end;
    else hunks.push({ start, end });
  }

  const out = [];
  for (const { start, end } of hunks) {
    const slice = ops.slice(start, end + 1);
    const aLen = slice.filter((op) => op.t !== "+").length;
    const bLen = slice.filter((op) => op.t !== "-").length;
    out.push(`@@ -${aAt[start] + 1},${aLen} +${bAt[start] + 1},${bLen} @@`);
    for (const op of slice) out.push(`${op.t}${op.line}`);
  }
  return out.join("\n") + "\n";
}
