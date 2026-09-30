// sections.mjs — the sections Cortex writes into a repo's shared files, read and replaced (#505).
//
// `section.mjs` knows what a section is; this knows which ones Cortex writes, where, from which
// template, and what each earlier release wrote there (`shipped-sections.mjs`). Today that is one:
// the team playbook, `CLAUDE.md` § Working as a team. The verification block is appended to the same
// file and is not here, because it is filled partly by hand — rows deleted where a command does not
// exist, the opening comment left out — so matching it against its template would call every real
// block `edited`. Its template has not changed since it shipped, and `UNTRACKED_SECTIONS` pins it so
// it cannot change without someone deciding how the change reaches the repos that hold it.
//
// `sectionReport` writes nothing. `sectionReplace` writes one file, and only a section in state
// `outdated`: an earlier release's text, untouched, which this release's template replaces with the
// section's own values carried over. `edited` is the team's and is refused; so is a section whose new
// text needs a value the old one never held. The file goes through a temp file renamed into place,
// so an interrupted run leaves the old file whole.
//
// `sectionKeep` records the team's answer to an `edited` section, so it is asked once and not on
// every run. A stamped file the team edited reads `edited` and nothing is said until its template
// changes; a section had no record to say that with, so `/cortex` showed the same diff on every
// re-run. The answer goes in `.cortex/sections.json`, committed, holding the hash of the template the
// section was kept against. While this release's template has that hash the section is `kept` and
// nothing asks; once a release changes it, the section reads `edited` again and the new diff is shown
// once more. The section's own text is not hashed, just as a stamped `edited` file is not re-judged:
// a team editing its own text again is still its own text. It is a file of its own, not a key in
// `.cortex/stamps.json`, because 2.40.0–2.41.1 refuse a record holding a key they do not know, and a
// teammate on one of them would lose the whole stamp status to it. A file that is absent, does not
// read, or comes from a newer Cortex reads as no answers, so the section is asked about: asking is
// the safe direction. The keep refuses to write over such a file.

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { SectionRefused, replaceSection, sectionState } from "./section.mjs";
import { SHIPPED_SECTIONS } from "./shipped-sections.mjs";
import { hashText, runningCortex } from "./stamps.mjs";
import { PLAYBOOK_HEADING } from "./team.mjs";

const TEMPLATES_DIR = fileURLToPath(new URL("../../templates/", import.meta.url));

/** Every section Cortex writes into a shared file. `id` is what `cortex-section.mjs --replace` and `--keep` take. */
export const CORTEX_SECTIONS = [
  { id: "team", path: "CLAUDE.md", heading: PLAYBOOK_HEADING, template: "team/playbook.md" },
];

const readText = (p) => { try { return readFileSync(p, "utf8"); } catch { return null; } };

/** `CLAUDE.md § Working as a team` — how every sentence here names a section. */
export const sectionName = (s) => `${s.path} § ${s.heading}`;

export const SECTIONS_REL = ".cortex/sections.json";
export const SECTIONS_FORMAT = 1;
const SHA = /^[0-9a-f]{64}$/;
const VERSION = /^\d+\.\d+\.\d+$/;

/**
 * The team's answers, `{ <id>: { version, templateSha256 } }`: each section kept against the template
 * with that hash, by that release. `kept` is `{}` for no file and for one that does not read (see the
 * header); `problem` says why a file that is there was not read, so the keep can refuse to replace it.
 */
function readKept(root) {
  const text = readText(join(root, ...SECTIONS_REL.split("/")));
  if (text === null) return { kept: {}, problem: null };
  let doc;
  try { doc = JSON.parse(text); } catch (e) { return { kept: {}, problem: `not readable as JSON (${e.message})` }; }
  if (doc && typeof doc === "object" && typeof doc.format === "number" && doc.format > SECTIONS_FORMAT) {
    return { kept: {}, problem: `format ${doc.format} was written by a newer Cortex than this one; update the plugin` };
  }
  if (!doc || typeof doc !== "object" || doc.format !== SECTIONS_FORMAT ||
      !doc.sections || typeof doc.sections !== "object" || Array.isArray(doc.sections)) {
    return { kept: {}, problem: `not a sections record (format ${SECTIONS_FORMAT}, with a "sections" object)` };
  }
  const kept = {};
  for (const [id, e] of Object.entries(doc.sections)) {
    if (e && typeof e === "object" && SHA.test(e.templateSha256 ?? "") && (e.version === null || VERSION.test(e.version ?? ""))) {
      kept[id] = { version: e.version, templateSha256: e.templateSha256 };
    }
  }
  return { kept, problem: null };
}

function stateOf(root, s, templatesDir) {
  const template = readFileSync(join(templatesDir, ...s.template.split("/")), "utf8");
  const earlier = SHIPPED_SECTIONS[s.template]?.earlier ?? [];
  const fileText = readText(join(root, ...s.path.split("/")));
  const st = sectionState(fileText, { heading: s.heading, template, earlier });
  const templateSha256 = hashText(template);
  const keptAs = st.state === "edited" ? readKept(root).kept[s.id] ?? null : null;
  const state = keptAs?.templateSha256 === templateSha256 ? "kept" : st.state;
  return { fileText, templateSha256, keptAs, ...st, state };
}

const keptAgainst = (k) => (k.version ? `Cortex ${k.version}'s text` : "an earlier text");

/** One sentence per state, for the report, `cortex-next` and a refusal alike. */
function whyFor(s, st) {
  const name = sectionName(s);
  switch (st.state) {
    case "current": return `${name} is this release's text`;
    case "outdated":
      return `${name} is Cortex ${st.version}'s text, untouched since, and this release's differs` +
        (st.unfilled.length ? `, and needs ${st.unfilled.map((n) => `{{${n}}}`).join(", ")}, which the old text never held` : "");
    case "edited":
      return `${name} was edited here and differs from this release's text; Cortex never overwrites it` +
        (st.keptAs ? `. The team kept it against ${keptAgainst(st.keptAs)}, and this release's differs` : "");
    case "kept":
      return `${name} was edited here, and the team kept it against ${keptAgainst(st.keptAs)}, which this release has not changed`;
    case "duplicate": return `${s.path} has ${st.why}`;
    default: return `${s.path} has no section headed "${s.heading}"`;
  }
}

/**
 * Each Cortex section in this repo: `{ id, path, heading, template, state, version, values, diff,
 * unfilled, why }`. A section that is not there is `absent`, and is reported so a caller can tell
 * "not written" from "not asked".
 */
export function sectionReport(root, { templatesDir = TEMPLATES_DIR } = {}) {
  return CORTEX_SECTIONS.map((s) => {
    const st = stateOf(root, s, templatesDir);
    return {
      id: s.id, path: s.path, heading: s.heading, template: s.template,
      state: st.state, version: st.version, values: st.values, diff: st.diff, unfilled: st.unfilled,
      why: whyFor(s, st),
    };
  });
}

/**
 * Replace section `id` with this release's text when it is `outdated`. `{ written, section, version,
 * why }`: `written`
 * is false for a section that is already current. Throws `SectionRefused` — code 1 for an unknown id,
 * an edited section or a value the new text needs, code 2 for no file, no section or two — and
 * writes nothing then.
 */
export function sectionReplace(root, id, { templatesDir = TEMPLATES_DIR } = {}) {
  const s = CORTEX_SECTIONS.find((x) => x.id === id);
  if (!s) throw new SectionRefused(`${id} is not a section Cortex writes — one of ${CORTEX_SECTIONS.map((x) => x.id).join(", ")}`, 1);
  const st = stateOf(root, s, templatesDir);
  if (st.fileText === null) throw new SectionRefused(`no ${s.path} in this repo, so there is no section to replace`, 2);
  if (st.state === "absent" || st.state === "duplicate") throw new SectionRefused(whyFor(s, st), 2);
  if (st.state === "current") return { written: false, section: sectionName(s), version: null, why: whyFor(s, st) };
  if (st.state === "edited" || st.state === "kept") {
    throw new SectionRefused(`${sectionName(s)} was edited here, so it is the team's: Cortex shows the diff and never replaces it`, 1);
  }
  if (st.unfilled.length) throw new SectionRefused(whyFor(s, st), 1);

  const template = readFileSync(join(templatesDir, ...s.template.split("/")), "utf8");
  const next = replaceSection(st.fileText, s.heading, st.proposed ?? template);
  const abs = join(root, ...s.path.split("/"));
  const tmp = `${abs}.cortex-tmp`;
  try {
    writeFileSync(tmp, next);
    renameSync(tmp, abs);
  } catch (e) {
    rmSync(tmp, { force: true });
    throw new SectionRefused(`could not write ${s.path}: ${e.message}`, 2);
  }
  return {
    written: true, section: sectionName(s), version: st.version,
    why: `it was Cortex ${st.version}'s text, and is now this release's, with the values it held kept`,
  };
}

/**
 * Record that the team keeps its own text for section `id`, against this release's template: the
 * section reads `kept`, and is not asked about again until a release changes that template. Writes
 * only `.cortex/sections.json`, and only for a section in state `edited`. `{ written, section, why }`:
 * `written` is false for a section already kept against this template. Throws `SectionRefused` —
 * code 1 for an unknown id or a section that is Cortex's text (current, or outdated, which is offered
 * as an update instead), code 2 for no file, no section or two, or a `.cortex/sections.json` that
 * does not read, which is left as it is.
 */
export function sectionKeep(root, id, { templatesDir = TEMPLATES_DIR, version = runningCortex() } = {}) {
  const s = CORTEX_SECTIONS.find((x) => x.id === id);
  if (!s) throw new SectionRefused(`${id} is not a section Cortex writes — one of ${CORTEX_SECTIONS.map((x) => x.id).join(", ")}`, 1);
  const st = stateOf(root, s, templatesDir);
  if (st.fileText === null) throw new SectionRefused(`no ${s.path} in this repo, so there is no section to keep`, 2);
  if (st.state === "absent" || st.state === "duplicate") throw new SectionRefused(whyFor(s, st), 2);
  if (st.state === "kept") return { written: false, section: sectionName(s), why: whyFor(s, st) };
  if (st.state !== "edited") {
    throw new SectionRefused(`${whyFor(s, st)}. That is Cortex's text, not the team's, so there is nothing to keep`, 1);
  }

  const { kept, problem } = readKept(root);
  if (problem) throw new SectionRefused(`${SECTIONS_REL}: ${problem}. It is left as it is`, 2);
  const entry = { version: VERSION.test(version ?? "") ? version : null, templateSha256: st.templateSha256 };
  const all = { ...kept, [s.id]: entry };
  const sections = Object.fromEntries(Object.keys(all).sort().map((k) => [k, all[k]]));
  const file = join(root, ...SECTIONS_REL.split("/"));
  const tmp = `${file}.cortex-tmp`;
  try {
    if (!existsSync(join(root, ".cortex"))) mkdirSync(join(root, ".cortex"));
    writeFileSync(tmp, JSON.stringify({ format: SECTIONS_FORMAT, sections }, null, 2) + "\n");
    renameSync(tmp, file);
  } catch (e) {
    rmSync(tmp, { force: true });
    throw new SectionRefused(`could not write ${SECTIONS_REL}: ${e.message}`, 2);
  }
  return {
    written: true, section: sectionName(s),
    why: `the team's text is kept against ${keptAgainst(entry)}, and is not asked about again until a release changes it`,
  };
}
