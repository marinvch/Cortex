// Shared helpers for the skill evals. Deterministic by construction: every scenario is drawn from a
// seeded generator, so the same seed writes the same tasks on every machine and the ground truth is
// known because the generator built the situation, not because a model judged it.

export function rng(seed) {
  // mulberry32 — small, fast, and good enough to shuffle scenario parts.
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const pick = (r, xs) => xs[Math.floor(r() * xs.length)];
export const int = (r, lo, hi) => lo + Math.floor(r() * (hi - lo + 1));

export function shuffle(r, xs) {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function sample(r, xs, n) {
  return shuffle(r, xs).slice(0, n);
}

// Every answer is a block of `KEY: value` lines at the end of the reply. The model may reason
// first; only the LAST occurrence of each key counts, so a draft it corrects is not held against it.
export function readAnswer(text, keys) {
  const out = {};
  for (const line of String(text || "").split(/\r?\n/)) {
    const m = /^\s*[*_`]*([A-Z][A-Z-]+)[*_`]*\s*:\s*(.*?)\s*$/.exec(line);
    if (m && keys.includes(m[1])) out[m[1]] = m[2].replace(/[`*]/g, "").trim();
  }
  return out;
}

// A list answer may trail an explanation — "#407, #413 — #413 shares a file" — so the list ends at the
// first dash, semicolon or parenthesis set off by spaces. Branch names keep their own hyphens.
export function listOf(value) {
  if (value === undefined) return null;
  const v = value.split(/\s+[—–]\s*|\s+-{1,2}\s+|\s*;\s*|\s+\(/)[0].trim();
  if (!v || /^none\.?$/i.test(v)) return [];
  return v.split(/\s*,\s*/).map((s) => s.replace(/^#/, "").trim()).filter(Boolean);
}

// Set agreement as F1, with the empty-vs-empty case scored as perfect.
export function setF1(got, want) {
  const g = new Set(got), w = new Set(want);
  if (g.size === 0 && w.size === 0) return 1;
  let tp = 0;
  for (const x of g) if (w.has(x)) tp++;
  if (tp === 0) return 0;
  const p = tp / g.size, r = tp / w.size;
  return (2 * p * r) / (p + r);
}

export const sameSet = (a, b) => a.length === b.length && setF1(a, b) === 1;

const WORDS = [
  "billing", "invoices", "auth", "session", "search", "upload", "export", "notify", "profile",
  "checkout", "cart", "ledger", "audit", "report", "import", "webhook", "cache", "queue",
  "settings", "onboarding", "routing", "theme", "i18n", "metrics", "sync", "preview",
];
export const word = (r) => pick(r, WORDS);
export const words = (r, n) => sample(r, WORDS, n);

const VERBS = ["fix", "feat", "refactor", "chore", "docs"];
export function branchName(r, used) {
  for (;;) {
    const b = `${pick(r, VERBS)}/${word(r)}-${word(r)}`;
    if (!used.has(b)) { used.add(b); return b; }
  }
}

export function sha(r) {
  let s = "";
  for (let i = 0; i < 7; i++) s += "0123456789abcdef"[Math.floor(r() * 16)];
  return s;
}
