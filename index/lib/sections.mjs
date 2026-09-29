// sections.mjs — the sections Cortex writes into a repo's shared files, read and replaced (#505).
//
// `section.mjs` knows what a section is; this knows which ones Cortex writes, where, from which
// template, and what each earlier release wrote there (`shipped-sections.mjs`). Today that is one:
// the team playbook, `CLAUDE.md` § Working as a team. The verification block is appended to the same
// file and is not here, because it is filled partly by hand — rows deleted where a command does not
// exist, the opening comment left out — so matching it against its template would call every real
// block `edited`, and its template has not changed since it shipped.
//
// `sectionReport` writes nothing. `sectionReplace` writes one file, and only a section in state
// `outdated`: an earlier release's text, untouched, which this release's template replaces with the
// section's own values carried over. `edited` is the team's and is refused; so is a section whose new
// text needs a value the old one never held. The file goes through a temp file renamed into place,
// so an interrupted run leaves the old file whole.

import { readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { SectionRefused, replaceSection, sectionState } from "./section.mjs";
import { SHIPPED_SECTIONS } from "./shipped-sections.mjs";
import { PLAYBOOK_HEADING } from "./team.mjs";

const TEMPLATES_DIR = fileURLToPath(new URL("../../templates/", import.meta.url));

/** Every section Cortex writes into a shared file. `id` is what `cortex-section.mjs --replace` takes. */
export const CORTEX_SECTIONS = [
  { id: "team", path: "CLAUDE.md", heading: PLAYBOOK_HEADING, template: "team/playbook.md" },
];

const readText = (p) => { try { return readFileSync(p, "utf8"); } catch { return null; } };

/** `CLAUDE.md § Working as a team` — how every sentence here names a section. */
export const sectionName = (s) => `${s.path} § ${s.heading}`;

function stateOf(root, s, templatesDir) {
  const template = readFileSync(join(templatesDir, ...s.template.split("/")), "utf8");
  const earlier = SHIPPED_SECTIONS[s.template]?.earlier ?? [];
  const fileText = readText(join(root, ...s.path.split("/")));
  return { fileText, ...sectionState(fileText, { heading: s.heading, template, earlier }) };
}

/** One sentence per state, for the report, `cortex-next` and a refusal alike. */
function whyFor(s, st) {
  const name = sectionName(s);
  switch (st.state) {
    case "current": return `${name} is this release's text`;
    case "outdated":
      return `${name} is Cortex ${st.version}'s text, untouched since, and this release's differs` +
        (st.unfilled.length ? `, and needs ${st.unfilled.map((n) => `{{${n}}}`).join(", ")}, which the old text never held` : "");
    case "edited": return `${name} was edited here and differs from this release's text; Cortex never overwrites it`;
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
  if (st.state === "edited") {
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
