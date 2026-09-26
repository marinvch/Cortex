// overview.mjs — the facts the Overview tab shows that the index itself does not carry.
//
// The index is a picture of the tree. The Overview also answers "what state is this repo in": is the
// index current, which profile is this install serving, what did the team last write down, how busy
// has the code been. Those live in git, in `.cortex/memory/` and in the environment, so they are
// read here — once, at render time — and handed to the page as plain data.
//
// Determinism still holds, with one boundary drawn on purpose. Nothing here reads the clock: every
// window is anchored to the INDEXED COMMIT's own date, never to "now", so the same commit renders the
// same churn and the same timeline on any machine on any day. What does change the page is the repo's
// state — a new memory entry, a stale index — which is the thing the page is there to report.
//
// Every field that cannot be read says why, instead of rendering a zero. "0 commits in 30 days" and
// "not a git repository" are different answers, and a dashboard that draws the first when it means
// the second is the kind of confident wrong number this package exists to avoid.

import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { list as listMemory } from "../../core/memory.js";
import { resolveProfile } from "../../core/profile.js";
import { gitReader } from "./changed.mjs";
import { analyse } from "./findings.mjs";

const DAY = 86_400;
export const CHURN_DAYS = 30;
const TIMELINE_MAX = 10;
const MEMORY_FILES = 3;
const SEVERITIES = ["critical", "high", "medium", "low"];

/** `YYYY-MM-DD` of a unix timestamp, in UTC so a machine's timezone cannot move a commit a day. */
function isoDay(ts) {
  const d = new Date(ts * 1000);
  return d.toISOString().slice(0, 10);
}

/** Whole days from `a` to `b`, both `YYYY-MM-DD`. */
function daysBetween(a, b) {
  return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86_400_000);
}

/**
 * The entries in one memory file: `## HH:MM · kind` headings, each with the first line of its body.
 * A digest is often long; the timeline needs the sentence that says what it is about, not all of it.
 */
export function memoryEntries(day, text) {
  const out = [];
  const lines = String(text).replace(/\r/g, "").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = /^##\s+(\d{2}:\d{2})\s*·\s*(.+?)\s*$/.exec(lines[i]);
    if (!m) continue;
    let body = "";
    for (let j = i + 1; j < lines.length && !lines[j].startsWith("## "); j++) {
      const t = lines[j].trim();
      if (t) { body = t; break; }
    }
    // Markdown emphasis reads as noise in a one-line list; the words stay, the asterisks go.
    body = body.replace(/\*\*|__|`/g, "");
    out.push({ date: day, time: m[1], kind: "memory", tag: m[2], title: body.length > 140 ? body.slice(0, 139) + "…" : body });
  }
  return out;
}

function readMemory(root) {
  const files = listMemory(join(root, ".cortex"));
  if (!files.length) return { newest: null, days: 0, entries: [] };
  const entries = [];
  for (const f of files.slice(0, MEMORY_FILES)) {
    let text = "";
    try {
      text = readFileSync(f.path, "utf8");
    } catch {
      text = "";
    }
    // Newest last within a day in the file; newest first in the timeline.
    entries.push(...memoryEntries(f.day, text).reverse());
  }
  return { newest: files[0].day, days: files.length, entries };
}

function readChurn(git, commit) {
  if (!commit) return { unavailable: "the index records no commit" };
  const head = git(["show", "-s", "--format=%ct", commit]);
  if (head.error) return { unavailable: "the indexed commit is not readable from git" };
  const end = Number(head.out.trim());
  const start = end - CHURN_DAYS * DAY;
  // `--since=@<epoch>` is an absolute instant, so the window is the 30 days that ended at the indexed
  // commit — never the 30 days before whenever someone happened to open the page.
  const log = git(["log", commit, `--since=@${start}`, "--format=%ct"]);
  if (log.error) return { unavailable: "git log failed: " + log.error };
  const days = new Array(CHURN_DAYS).fill(0);
  let commits = 0;
  for (const line of log.out.split("\n")) {
    const ts = Number(line.trim());
    if (!ts || ts < start || ts > end) continue;
    const slot = Math.min(CHURN_DAYS - 1, Math.floor((ts - start) / DAY));
    days[slot] += 1;
    commits += 1;
  }
  return { commits, days, from: isoDay(start), to: isoDay(end) };
}

function readCommits(git, commit) {
  if (!commit) return [];
  const log = git(["log", "-n", "8", commit, "--format=%cs%x1f%h%x1f%an%x1f%s"]);
  if (log.error) return [];
  return log.out
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [date, sha, author, subject = ""] = line.split("\x1f");
      return { date, time: "", kind: "commit", tag: sha, author, title: subject.length > 140 ? subject.slice(0, 139) + "…" : subject };
    });
}

function readFindings(index, root) {
  try {
    const all = analyse(index, root);
    const counts = Object.fromEntries(SEVERITIES.map((s) => [s, 0]));
    for (const f of all) if (f.severity in counts) counts[f.severity] += 1;
    const rank = (f) => SEVERITIES.indexOf(f.severity);
    const top = [...all]
      .sort((a, b) => rank(a) - rank(b) || String(a.kind).localeCompare(String(b.kind)))
      .slice(0, 3)
      .map((f) => ({ severity: f.severity, kind: f.kind, title: f.title }));
    return { counts, total: all.length, top };
  } catch (e) {
    return { unavailable: "the findings pass failed: " + String(e?.message ?? e).split("\n")[0] };
  }
}

function readProfile(env) {
  try {
    const p = resolveProfile({ env });
    return { name: p.profile, source: p.source };
  } catch (e) {
    return { name: "unknown", source: "invalid CORTEX_PROFILE", unavailable: String(e?.message ?? e) };
  }
}

/**
 * The version of the Cortex that drew the page, from the one file every release stamps. It belongs
 * to the tool, not to the repo — the same install renders the same number on every repo it reads.
 */
function readCortexVersion() {
  try {
    const v = readFileSync(new URL("../../VERSION", import.meta.url), "utf8").trim();
    return /^\d+\.\d+\.\d+$/.test(v) ? v : null;
  } catch {
    return null;
  }
}

/** Which of Cortex's own generated outputs exist — the "output" column of the Structure tab. */
function readGenerated(root) {
  const at = (rel) => existsSync(join(root, rel));
  return [
    { path: ".cortex/index/", what: "the index", present: at(".cortex/index/index.json") },
    { path: ".cortex/findings/", what: "findings reports", present: at(".cortex/findings") },
    { path: ".cortex/view/", what: "this page", present: true },
    { path: ".cortex/memory/", what: "team memory — committed", present: at(".cortex/memory") },
  ];
}

/**
 * Build the Overview's facts. `stale` is the caller's freshness answer (`true` / `false` / `null`
 * for "cannot tell"); `git` is injectable so the no-git state is testable without deleting `.git`.
 */
export function buildOverview(index, root, { stale = null, env = {}, git = gitReader(root) } = {}) {
  const commit = index.commit || "";
  const probe = git(["rev-parse", "--is-inside-work-tree"]);
  const hasGit = !probe.error && probe.out.trim() === "true";

  let commitDate = null;
  if (hasGit && commit) {
    const d = git(["show", "-s", "--format=%ct", commit]);
    if (!d.error && d.out.trim()) commitDate = isoDay(Number(d.out.trim()));
  }

  const memory = readMemory(root);
  const churn = hasGit ? readChurn(git, commit) : { unavailable: "not a git repository" };
  const commits = hasGit ? readCommits(git, commit) : [];

  // Newest day first. Within a day, memory before commits (it says why; the commits say what), and
  // each source keeps its own order — git's is already newest first, and memory was reversed above.
  // Ties are broken by that position, never by comparing two empty times, which is not an order.
  const tagged = [...memory.entries, ...commits].map((e, i) => ({ e, i }));
  const timeline = tagged
    .sort((a, b) =>
      (a.e.date < b.e.date ? 1 : a.e.date > b.e.date ? -1 : 0) ||
      (a.e.kind === b.e.kind ? 0 : a.e.kind === "memory" ? -1 : 1) ||
      a.i - b.i)
    .map((t) => t.e)
    .slice(0, TIMELINE_MAX);

  return {
    cortex: readCortexVersion(),
    commit: commit ? commit.slice(0, 7) : null,
    commitDate,
    index: stale === null ? "unknown" : stale ? "stale" : "fresh",
    profile: readProfile(env),
    memory: {
      newest: memory.newest,
      days: memory.days,
      // How far the team's written memory trails the code it describes — anchored to the indexed
      // commit, not to today, so the number is the same on every machine.
      lagDays: memory.newest && commitDate ? Math.max(0, daysBetween(memory.newest, commitDate)) : null,
    },
    churn,
    findings: readFindings(index, root),
    timeline,
    timelineNote: hasGit ? null : "not a git repository — only memory entries can be listed",
    generated: readGenerated(root),
  };
}
