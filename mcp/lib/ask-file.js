// The ask file: `asks/<id>.md` in a team-brain clone, read and written as text (#620, #624).
//
// Frontmatter says who asked, from which project, to whom, and where the thread stands; the body is
// the question, then one `## Answer` section per answer and one `## Comment` section per comment
// sync pulled from a tracker. `asks.js` sends and answers asks, `sync.js` mirrors them to trackers,
// and both read and write the file through this module alone, so neither imports the other.

import { openVault } from "./vault.js";

const ANSWER_HEAD = /^## Answer · (\d{4}-\d{2}-\d{2}) · ([^·\n]*?) · (open|answered|decided|wontfix)[ \t]*$/m;
// A comment pulled from a tracker by sync (#624): `## Comment · <date> · <author> · <kind>:<origin id>`.
const COMMENT_HEAD = /^## Comment · (\d{4}-\d{2}-\d{2}) · ([^·\n]*?) · ([a-z]+):(\S+)[ \t]*$/m;
// Both headers with no capture groups: `split` would otherwise splice the groups into its result.
const ANSWER_SPLIT = /^(?=## Answer · \d{4}-\d{2}-\d{2} · [^·\n]*? · (?:open|answered|decided|wontfix)[ \t]*$|## Comment · \d{4}-\d{2}-\d{2} · [^·\n]*? · [a-z]+:\S+[ \t]*$)/m;

export class AskRefused extends Error {
  constructor(code, message) {
    super(message);
    this.name = "AskRefused";
    this.code = code;
  }
}

export const oneLine = (s) => String(s ?? "").replace(/\s+/g, " ").trim();

/** The text of an ask file. `links` is a JSON array on one line, so the frontmatter stays flat. */
export function renderAsk(meta, question) {
  const lines = [
    "---",
    "type: ask",
    `id: ${meta.id}`,
    `title: ${oneLine(meta.title)}`,
    `from: ${meta.from ?? ""}`,
    `fromProject: ${meta.fromProject ?? ""}`,
    `to: ${meta.to}`,
    `toKind: ${meta.toKind}`,
    `status: ${meta.status}`,
    `created: ${meta.created}`,
    `updated: ${meta.updated}`,
    `links: ${JSON.stringify(meta.links ?? [])}`,
    "---",
    "",
    String(question).trim(),
    "",
  ];
  return lines.join("\n");
}

/**
 * Parse an ask file into `{ meta, question, answers }`, or null when it is not one. Tolerant of
 * CRLF, since a clone on Windows may check files out that way.
 */
export function parseAsk(text) {
  const src = String(text).replace(/\r\n/g, "\n");
  const m = src.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) return null;
  const meta = {};
  for (const line of m[1].split("\n")) {
    const i = line.indexOf(":");
    if (i < 1) continue;
    meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  if (meta.type !== "ask" || !meta.id) return null;
  try {
    meta.links = meta.links ? JSON.parse(meta.links) : [];
    if (!Array.isArray(meta.links)) meta.links = [];
  } catch {
    meta.links = [];
  }
  const rest = src.slice(m[0].length);
  // Split only on a whole answer header, so a question that merely mentions one keeps its text.
  const parts = rest.split(ANSWER_SPLIT);
  const question = parts[0].trim();
  const answers = [];
  const comments = [];
  for (const part of parts.slice(1)) {
    const c = part.startsWith("## Comment") ? part.match(COMMENT_HEAD) : null;
    if (c) {
      comments.push({ date: c[1], author: c[2].trim(), kind: c[3], origin: c[4], text: part.slice(c[0].length).trim() });
      continue;
    }
    const h = part.match(ANSWER_HEAD);
    if (!h) continue;
    answers.push({ date: h[1], handle: h[2].trim(), status: h[3], text: part.slice(h[0].length).trim() });
  }
  return { meta, question, answers, comments };
}

/**
 * Change frontmatter lines of an ask's text and keep everything else byte for byte. A key that is
 * not there yet is added before the closing `---`; a value of `null` removes the line. `links` is
 * written as one line of JSON, as `renderAsk` writes it.
 *
 * @param {string} text
 * @param {Record<string, string|object[]|null>} changes
 */
export function setAskMeta(text, changes) {
  const src = String(text).replace(/\r\n/g, "\n");
  const fm = src.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!fm) throw new AskRefused("not_an_ask", "not an ask file");
  let lines = fm[1].split("\n");
  for (const [key, value] of Object.entries(changes)) {
    const at = lines.findIndex((l) => l.startsWith(`${key}:`));
    if (value === null || value === undefined) {
      if (at !== -1) lines = lines.filter((_, i) => i !== at);
      continue;
    }
    const line = `${key}: ${typeof value === "string" ? oneLine(value) : JSON.stringify(value)}`;
    if (at === -1) lines.push(line);
    else lines[at] = line;
  }
  return `---\n${lines.join("\n")}\n---\n${src.slice(fm[0].length)}`;
}

/** Append one `## Answer` or `## Comment` section to an ask's text. */
export function appendSection(text, head, body) {
  return `${String(text).replace(/\r\n/g, "\n").replace(/\n*$/, "\n")}\n${head}\n\n${String(body).trim()}\n`;
}

/** A name safe in a section header: one line, no `·`, at most 60 characters. */
export const headerName = (s) => oneLine(s).replace(/·/g, "-").slice(0, 60) || "someone";

/** Every ask in the clone, parsed, newest update first. A file that is not an ask is skipped. */
export function listAsks(clone) {
  const vault = openVault(clone);
  const out = [];
  for (const rel of vault.list("asks", { ext: ".md" })) {
    const ask = parseAsk(vault.read(rel));
    if (ask) out.push({ ...ask, rel });
  }
  out.sort((a, b) => String(b.meta.updated).localeCompare(String(a.meta.updated)) || b.meta.id.localeCompare(a.meta.id));
  return out;
}

// What one read may return of the team's decisions. The transport caps a whole result at 40,000
// characters, and these ride beside notes and commits, so they are bounded on their own.
const DECISIONS_MAX = 20;
const DECISION_CHARS = 500;
const DECISIONS_BUDGET = 6_000;

/**
 * An ask whose thread ended in a decision, as a reader needs it: what was decided, by whom, when, and
 * for which project. null for any other ask. The last `decided` answer is the one that stands.
 */
export function decisionOf(ask) {
  if (ask.meta.status !== "decided") return null;
  const last = [...ask.answers].reverse().find((a) => a.status === "decided");
  if (!last) return null;
  return {
    id: ask.meta.id,
    title: ask.meta.title,
    project: ask.meta.fromProject || null,
    askedBy: ask.meta.from || null,
    to: ask.meta.to,
    decidedBy: last.handle,
    decidedOn: last.date,
    decision: last.text,
  };
}

/** Decisions newest first, cut to what fits in a result. `truncated` says a cap was hit. */
export function boundDecisions(list) {
  const sorted = [...list].sort((a, b) => b.decidedOn.localeCompare(a.decidedOn) || b.id.localeCompare(a.id));
  const items = [];
  let budget = DECISIONS_BUDGET;
  let truncated = sorted.length > DECISIONS_MAX;
  for (const d of sorted.slice(0, DECISIONS_MAX)) {
    const room = Math.min(DECISION_CHARS, budget);
    if (room <= 0) { truncated = true; break; }
    const decision = d.decision.length > room ? d.decision.slice(0, room) : d.decision;
    if (decision.length < d.decision.length) truncated = true;
    items.push({ ...d, decision });
    budget -= decision.length;
  }
  return { items, total: sorted.length, truncated };
}

/** The team's decisions on or after `since`, across every project. A `since` that is no date reads all. */
export function teamDecisions(clone, { since } = {}) {
  const day = /^\d{4}-\d{2}-\d{2}/.test(String(since)) ? String(since).slice(0, 10) : null;
  return boundDecisions(listAsks(clone).map(decisionOf).filter((d) => d && (!day || d.decidedOn >= day)));
}
