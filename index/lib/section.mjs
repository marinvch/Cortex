// section.mjs — a section Cortex writes into a markdown file the team also writes (#505).
//
// The team playbook is appended to `CLAUDE.md` under `## Working as a team`. The stamp record hashes
// whole files, so it cannot hold this, and a repo stamped by 2.41.0 kept the playbook that did not ask
// "Single agent or team?" (#498) with nothing to say so. This module answers three questions about
// such a section, and nothing about the file around it.
//
// **Which bytes are the section.** Its heading line — an ATX heading at level two or deeper whose
// text is exactly the heading Cortex writes — through the last non-blank line before the next
// heading of the same or a higher level, or the end of the file. Blank lines after it are outside,
// so they stay where they were. A heading inside a ``` or ~~~ fence is not a heading, so an example
// in a code block neither starts nor ends one. A BOM before the first line is allowed. The section
// keeps the line ending of its heading line.
//
// **Whose text it is.** `current` when the section is the template filled with values; `outdated`
// when it is an earlier release's template filled with values (`shipped-sections.mjs`); `edited`
// otherwise. Values are read from the section itself, one placeholder per slot, a slot never
// spanning lines, and a match counts only if rendering those values gives the section back exactly.
// That round trip is the whole definition: a regex that reads a value is a guess, and the renderer
// agreeing with it is the check. Only CRLF and trailing newlines are forgiven — the stamp record's
// rule — so a formatter's rewrap or a trailing space is an edit, and an edit is never overwritten.
// Two sections of one heading are `duplicate`: Cortex will not choose between them.
//
// **The replace.** Only the section's bytes change; every byte before and after is the one that was
// there. The result is read back before it is returned — exactly one section, at the same offset,
// holding exactly the new text — or nothing is returned, like the shared-plugin merge: a text edit
// is trusted only once the reader agrees with it.
//
// Pure: no filesystem, no clock.

import { lineDiff } from "./linediff.mjs";
import { placeholderMatches, renderTemplate, unfilledPlaceholders } from "./placeholders.mjs";

/** A section Cortex will not read or write, with the sentence that says why. `code` is the CLI's exit. */
export class SectionRefused extends Error {
  constructor(message, code) {
    super(message);
    this.name = "SectionRefused";
    this.code = code;
  }
}

const lf = (s) => String(s).replace(/\r\n/g, "\n");
const normal = (s) => lf(s).replace(/\n+$/, "");
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;

/** Each line with its offsets: `{ start, end, text }`, `end` before any `\r\n` or `\n`. */
function linesOf(text) {
  const out = [];
  let at = 0;
  while (at <= text.length) {
    const nl = text.indexOf("\n", at);
    const stop = nl === -1 ? text.length : nl;
    const end = stop > at && text[stop - 1] === "\r" ? stop - 1 : stop;
    out.push({ start: at, end, text: text.slice(at, end) });
    if (nl === -1) break;
    at = nl + 1;
  }
  return out;
}

/** Every heading outside a code fence: `{ line, level, text }` with `line` an index into `lines`. */
function headingsOf(lines) {
  const out = [];
  let fence = null;
  lines.forEach((l, i) => {
    const t = i === 0 ? l.text.replace(/^\uFEFF/, "") : l.text;
    const f = FENCE.exec(t);
    if (fence) {
      if (f && f[1][0] === fence[0] && f[1].length >= fence.length && /^ {0,3}[`~]+[ \t]*$/.test(t)) fence = null;
      return;
    }
    if (f) { fence = f[1]; return; }
    const h = HEADING.exec(t);
    if (h) out.push({ line: i, level: h[1].length, text: (h[2] ?? "").trim() });
  });
  return out;
}

/**
 * Each section headed `heading` in `text`: `{ start, end, level, line, eol }` — `start` and `end` are
 * offsets (the heading line's start, the end of the last non-blank line), `line` is 1-based.
 * `[]` for no text.
 */
export function findSections(text, heading) {
  if (typeof text !== "string") return [];
  const lines = linesOf(text);
  const heads = headingsOf(lines);
  const out = [];
  heads.forEach((h, k) => {
    if (h.level < 2 || h.text !== heading) return;
    const stop = heads.slice(k + 1).find((n) => n.level <= h.level);
    let last = (stop ? stop.line : lines.length) - 1;
    while (last > h.line && /^\s*$/.test(lines[last].text)) last--;
    const head = lines[h.line];
    const eol = text[head.end] === "\r" ? "\r\n" : "\n";
    out.push({ start: head.start, end: lines[last].end, level: h.level, line: h.line + 1, eol });
  });
  return out;
}

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The values that fill `template` to give `text` exactly, or `null`. One value per placeholder name
 * (a name used twice must carry one value), never empty, never across a line.
 */
export function matchTemplate(template, text) {
  const t = normal(template);
  const target = normal(text);
  const names = [];
  let re = "";
  let last = 0;
  for (const m of placeholderMatches(t)) {
    re += escape(t.slice(last, m.index));
    const k = names.indexOf(m.name);
    re += k === -1 ? `(?<p${names.push(m.name) - 1}>[^\\n]+?)` : `\\k<p${k}>`;
    last = m.index + m.token.length;
  }
  re += escape(t.slice(last));
  const hit = new RegExp(`^${re}$`).exec(target);
  if (!hit) return null;
  const values = Object.fromEntries(names.map((n, i) => [n, hit.groups[`p${i}`]]));
  return normal(renderTemplate(t, values)) === target ? values : null;
}

/**
 * Values an edited section still carries: for each template line that holds a placeholder, the first
 * section line it matches. So an edited section's diff shows the team's edit and not its roster.
 */
function lineValues(templates, text) {
  const values = {};
  const lines = normal(text).split("\n");
  for (const tpl of templates) {
    for (const tl of normal(tpl).split("\n")) {
      if (!placeholderMatches(tl).length) continue;
      for (const l of lines) {
        const v = matchTemplate(tl, l);
        if (!v) continue;
        for (const [k, x] of Object.entries(v)) if (!Object.hasOwn(values, k)) values[k] = x;
        break;
      }
    }
  }
  return values;
}

function duplicateWhy(found, heading) {
  const at = found.map((f) => f.line);
  const list = at.length === 2 ? `${at[0]} and ${at[1]}` : `${at.slice(0, -1).join(", ")} and ${at.at(-1)}`;
  return `${found.length} sections headed "${heading}", at lines ${list}. Cortex will not choose between them — ` +
    "keep one, by hand, and run this again";
}

/**
 * The state of the section headed `heading` in `fileText` (null for no file), against `template` and
 * the `earlier` shipped texts (`[{ version, text }]`, newest first or in any order):
 *
 * `{ state, version, values, proposed, unfilled, diff, why }` — `state` is `absent`, `duplicate`,
 * `current`, `outdated` or `edited`; `version` names the release an outdated text came from;
 * `proposed` is `template` filled with the section's values, and `diff` runs from the section to it
 * (`null` when there is nothing to compare); `unfilled` names the placeholders `proposed` still needs.
 */
export function sectionState(fileText, { heading, template, earlier = [] }) {
  const base = { state: "absent", version: null, values: null, proposed: null, unfilled: [], diff: null, why: null };
  const found = findSections(fileText, heading);
  if (!found.length) return base;
  if (found.length > 1) return { ...base, state: "duplicate", why: duplicateWhy(found, heading) };
  const body = normal(fileText.slice(found[0].start, found[0].end));

  const now = matchTemplate(template, body);
  if (now) return { ...base, state: "current", values: now, proposed: body };

  let state = "edited";
  let version = null;
  let values = null;
  for (const e of earlier) {
    values = matchTemplate(e.text, body);
    if (values) { state = "outdated"; version = e.version; break; }
  }
  if (!values) values = lineValues([template, ...earlier.map((e) => e.text)], body);
  const proposed = normal(renderTemplate(template, values));
  return { ...base, state, version, values, proposed, unfilled: unfilledPlaceholders(template, values), diff: lineDiff(body, proposed) };
}

/**
 * `fileText` with the one section headed `heading` replaced by `body`, in the section's own line
 * endings, every other byte as it was. Throws `SectionRefused` (code 2) for no section or two, and an
 * Error when the result does not read back as exactly that — nothing is returned then.
 */
export function replaceSection(fileText, heading, body) {
  const found = findSections(fileText, heading);
  if (!found.length) throw new SectionRefused(`no section headed "${heading}"`, 2);
  if (found.length > 1) throw new SectionRefused(duplicateWhy(found, heading), 2);
  const [s] = found;
  const want = normal(body);
  const out = fileText.slice(0, s.start) + want.split("\n").join(s.eol) + fileText.slice(s.end);

  const again = findSections(out, heading);
  const back = again.length === 1 ? again[0] : null;
  const agrees = back &&
    back.start === s.start &&
    normal(out.slice(back.start, back.end)) === want &&
    out.slice(back.end) === fileText.slice(s.end);
  if (!agrees) {
    throw new Error(`replacing the section headed "${heading}" did not read back as that one section — nothing was written`);
  }
  return out;
}
