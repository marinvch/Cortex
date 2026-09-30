// section.test.mjs — the sections Cortex writes into a file the team also writes (#505).
//
// The team playbook is appended to CLAUDE.md, so it is not in the stamp record, and a repo stamped
// by 2.41.0 kept the playbook that did not ask "Single agent or team?" (#498) with nothing to say so.
// These pin the three halves of the fix:
//
//   - **Which bytes are the section** (`findSections`): its heading line through the last non-blank
//     line before the next heading of the same or a higher level. A heading inside a code fence is
//     not one; CRLF, a BOM and a missing final newline are all read.
//   - **Whose text it is** (`sectionState`): `current` is this release's template with the section's
//     own values in the slots, `outdated` is an earlier release's (shipped as data, hashed), anything
//     else is `edited`. Never a guess: a match is a round trip through the renderer.
//   - **The replace** (`replaceSection`): every byte outside the section is the one that was there,
//     and the result is parsed back before it is trusted, like the shared-plugin merge.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { findSections, matchTemplate, replaceSection, sectionState, SectionRefused } from "../lib/section.mjs";
import { CORTEX_SECTIONS, sectionKeep, sectionReport, sectionReplace } from "../lib/sections.mjs";
import { SHIPPED_SECTIONS, UNTRACKED_SECTIONS } from "../lib/shipped-sections.mjs";
import { hashText } from "../lib/stamps.mjs";
import { renderTemplate } from "../lib/placeholders.mjs";
import { teamState, PLAYBOOK_HEADING } from "../lib/team.mjs";
import { tempDir } from "./tmp.mjs";

const REPO = fileURLToPath(new URL("../../", import.meta.url));
const PLAYBOOK = readFileSync(join(REPO, "templates/team/playbook.md"), "utf8");
const OLD = SHIPPED_SECTIONS["team/playbook.md"].earlier.find((e) => e.version === "2.41.0").text;
const ROSTER = "`architect`, `tester`, `code-reviewer` (reviewer)";
const H = PLAYBOOK_HEADING;
const rendered = (tpl, roster = ROSTER) => renderTemplate(tpl, { ROSTER: roster });
const TEAM = { heading: H, template: PLAYBOOK, earlier: SHIPPED_SECTIONS["team/playbook.md"].earlier };

// --- which bytes are the section -------------------------------------------------------------------

test("the section is its heading through the last non-blank line before the next heading of its level or higher", () => {
  const text = "# Repo\n\n## Working as a team\n\nBody.\n\n### A sub-part\n\nMore.\n\n\n## Next\n\nOther.\n";
  const [s] = findSections(text, H);
  assert.equal(text.slice(s.start, s.end), "## Working as a team\n\nBody.\n\n### A sub-part\n\nMore.", "a ### inside stays, trailing blank lines do not");
  assert.equal(findSections("# Repo\n\n## Working as a team\n\nBody.\n# Top\n", H).map((x) => "# Repo\n\n## Working as a team\n\nBody.\n# Top\n".slice(x.start, x.end))[0],
    "## Working as a team\n\nBody.", "a level-1 heading ends it too");
  const eof = "## Working as a team\n\nLast line, no newline";
  const [e] = findSections(eof, H);
  assert.equal(e.end, eof.length, "at the end of the file, with no final newline, it runs to the end");
});

test("a heading inside a code fence neither starts nor ends a section", () => {
  const fencedStart = "# Doc\n\n```md\n## Working as a team\n```\n";
  assert.equal(findSections(fencedStart, H).length, 0, "an example of the heading in a fence is not the section");
  const fencedEnd = "## Working as a team\n\nBody.\n\n~~~\n## Not a heading\n~~~\n\nStill the section.\n\n## Next\n";
  const [s] = findSections(fencedEnd, H);
  assert.equal(fencedEnd.slice(s.start, s.end), "## Working as a team\n\nBody.\n\n~~~\n## Not a heading\n~~~\n\nStill the section.");
  // A fence closes only on its own character: a ~~~ line inside a ``` block is content.
  assert.equal(findSections("```\n~~~\n## Working as a team\n~~~\n```\n", H).length, 0, "the other fence character does not close it");
});

test("only the exact heading, at level two or deeper, is the section", () => {
  assert.equal(findSections("# Working as a team\n", H).length, 0, "a document title is not the section");
  assert.equal(findSections("## Working as a team (draft)\n", H).length, 0);
  assert.equal(findSections("## working as a team\n", H).length, 0, "case is part of the heading Cortex writes");
  assert.equal(findSections("##  Working as a team  ##  \n", H).length, 1, "spacing and a closing sequence do not change it");
  assert.equal(findSections("### Working as a team\n", H)[0].level, 3);
});

test("CRLF, a BOM and a missing section are all read, and two sections are counted as two", () => {
  const crlf = "@AGENTS.md\r\n\r\n## Working as a team\r\n\r\nBody.\r\n\r\n## Next\r\n";
  const [s] = findSections(crlf, H);
  assert.equal(crlf.slice(s.start, s.end), "## Working as a team\r\n\r\nBody.");
  assert.equal(s.eol, "\r\n");
  assert.equal(findSections("\uFEFF## Working as a team\n\nBody.\n", H).length, 1, "a BOM before the first heading");
  assert.equal(findSections("# Repo\n", H).length, 0);
  assert.equal(findSections(null, H).length, 0, "no file is no section");
  assert.equal(findSections("## Working as a team\n\nA\n\n## Working as a team\n\nB\n", H).length, 2);
});

// --- whose text it is ------------------------------------------------------------------------------

test("a template's slots are read back only when rendering them gives the section exactly", () => {
  assert.deepEqual(matchTemplate(PLAYBOOK, rendered(PLAYBOOK)), { ROSTER });
  assert.equal(matchTemplate(PLAYBOOK, rendered(PLAYBOOK) + "\nOne more line."), null);
  assert.equal(matchTemplate(PLAYBOOK, rendered(PLAYBOOK, "")), null, "an empty slot is not a roster");
  assert.equal(matchTemplate("A {{X}} and {{X}}.", "A b and c."), null, "one placeholder, one value");
  assert.deepEqual(matchTemplate("A {{X}} and {{X}}.", "A b and b."), { X: "b" });
  assert.equal(matchTemplate("Line {{X}}.\nNext.", "Line a.\nb.\nNext."), null, "a slot never spans lines");
});

test("this release's text is current, an earlier release's is outdated, anything else is edited", () => {
  const current = sectionState(`@AGENTS.md\n\n${rendered(PLAYBOOK)}`, TEAM);
  assert.equal(current.state, "current");
  assert.deepEqual(current.values, { ROSTER });

  const old = sectionState(`@AGENTS.md\n\n${rendered(OLD)}`, TEAM);
  assert.equal(old.state, "outdated");
  assert.equal(old.version, "2.41.0");
  assert.deepEqual(old.values, { ROSTER }, "the roster is read from the section itself");
  assert.equal(old.proposed, rendered(PLAYBOOK).replace(/\n+$/, ""), "and carried into this release's text");
  assert.match(old.diff, /^\+2\. Then end your reply with the exact question "Single agent or team\?" and stop/m);
  assert.match(old.diff, /^-2\. Give the developer that recommendation/m);

  const trimmed = rendered(PLAYBOOK).replace("To stop using the team, delete this section, `.claude/skills/team/` and the agents.\n", "");
  const edited = sectionState(`@AGENTS.md\n\n${trimmed}`, TEAM);
  assert.equal(edited.state, "edited");
  assert.deepEqual(edited.values, { ROSTER }, "an edited section keeps its roster line, so the diff shows only the edit");
  assert.equal(edited.diff.split("\n").filter((l) => /^[+-][^+-]/.test(l)).length, 1, "one line differs");

  const oldEdited = sectionState(`@AGENTS.md\n\n${rendered(OLD).replace("The developer decides.", "The developer decides. Always.")}`, TEAM);
  assert.equal(oldEdited.state, "edited", "an earlier text the team changed is theirs, never outdated");
});

test("nothing but CRLF and trailing newlines is forgiven — a reformatted section is edited, never outdated", () => {
  const crlf = `@AGENTS.md\r\n\r\n${rendered(OLD).replace(/\n/g, "\r\n")}\r\n\r\n`;
  assert.equal(sectionState(crlf, TEAM).state, "outdated");
  const spaced = rendered(OLD).replace("with its reasons.", "with its reasons.  ");
  assert.equal(sectionState(spaced, TEAM).state, "edited", "trailing spaces are an edit");
  const rewrapped = rendered(OLD).replace(",\n   with its reasons.", ", with its reasons.");
  assert.equal(sectionState(rewrapped, TEAM).state, "edited", "a formatter's rewrap is an edit");
});

test("no section is absent, and two are refused with a sentence rather than guessed between", () => {
  assert.equal(sectionState("@AGENTS.md\n", TEAM).state, "absent");
  assert.equal(sectionState(null, TEAM).state, "absent");
  const two = sectionState(`${rendered(OLD)}\n${rendered(OLD)}`, TEAM);
  assert.equal(two.state, "duplicate");
  assert.match(two.why, /2 sections headed "Working as a team"/);
  assert.match(two.why, /lines 1 and 15/);
});

test("a current template that needs a value no earlier text carried says which, and proposes nothing to write", () => {
  const next = PLAYBOOK.replace("This session runs them.", "This session runs them in {{MODE}}.");
  const s = sectionState(rendered(OLD), { ...TEAM, template: next });
  assert.equal(s.state, "outdated");
  assert.deepEqual(s.unfilled, ["MODE"]);
});

// --- the replace -----------------------------------------------------------------------------------

test("a replace changes the section and not one byte around it", () => {
  const before = "\uFEFF@AGENTS.md\r\n\r\n## Verifying your work\r\n\r\n| Test | `npm test` |\r\n\r\n" +
    rendered(OLD).replace(/\n/g, "\r\n") + "\r\n\r\n## After\r\n\r\nTheirs.  \r\n";
  const [s] = findSections(before, H);
  const after = replaceSection(before, H, rendered(PLAYBOOK));
  const [t] = findSections(after, H);
  assert.equal(after.slice(0, t.start), before.slice(0, s.start), "everything before is the same bytes");
  assert.equal(after.slice(t.end), before.slice(s.end), "everything after is the same bytes");
  assert.equal(after.slice(t.start, t.end), rendered(PLAYBOOK).replace(/\n+$/, "").replace(/\n/g, "\r\n"), "in the file's own line endings");
  assert.equal(sectionState(after, TEAM).state, "current");

  const eof = `@AGENTS.md\n\n${rendered(OLD).replace(/\n+$/, "")}`;
  assert.equal(replaceSection(eof, H, rendered(PLAYBOOK)), `@AGENTS.md\n\n${rendered(PLAYBOOK).replace(/\n+$/, "")}`, "no final newline is added");
});

test("a replace refuses a missing or duplicated section, and a body that would not parse back as the one section", () => {
  assert.throws(() => replaceSection("@AGENTS.md\n", H, rendered(PLAYBOOK)), SectionRefused);
  assert.throws(() => replaceSection(`${rendered(OLD)}\n${rendered(OLD)}`, H, rendered(PLAYBOOK)), /2 sections headed/);
  // A body carrying a heading of its own level would end the section early, and the next read would
  // call half of it "after the section". The parse-back is what catches it.
  assert.throws(() => replaceSection(rendered(OLD), H, "## Working as a team\n\nA.\n\n## Smuggled\n\nB.\n"), /nothing was written/);
});

// --- the shipped texts ------------------------------------------------------------------------------

test("every earlier text is the one its hash names, and this release's template is pinned", () => {
  for (const [template, entry] of Object.entries(SHIPPED_SECTIONS)) {
    const now = readFileSync(join(REPO, "templates", ...template.split("/")), "utf8");
    assert.equal(hashText(now), entry.current,
      `templates/${template} changed. If the text it replaces was ever released, add it to \`earlier\` in ` +
        "index/lib/shipped-sections.mjs with its version — a repo stamped by that release holds it, and without it " +
        "that repo reads `edited` and is never offered the new text. Then pin the new hash here.");
    for (const e of entry.earlier) {
      assert.equal(hashText(e.text), e.sha256, `${template} ${e.version}: the text is not the one its hash names`);
      assert.notEqual(e.sha256, entry.current, `${template} ${e.version} is this release's text, not an earlier one`);
      assert.match(e.version, /^\d+\.\d+\.\d+$/);
    }
  }
  assert.match(OLD, /ask the developer which to use/, "2.41.0's playbook is the one that did not ask in one exact sentence");
});

test("each Cortex section names a template this release ships and the heading it writes", () => {
  for (const s of CORTEX_SECTIONS) {
    const tpl = readFileSync(join(REPO, "templates", ...s.template.split("/")), "utf8");
    assert.equal(findSections(tpl, s.heading).length, 1, `${s.template} writes the heading ${s.heading}`);
    assert.ok(SHIPPED_SECTIONS[s.template], `${s.template} has its shipped history`);
  }
});

// --- a repo on disk ---------------------------------------------------------------------------------

function repo(claudeMd) {
  const root = tempDir("cortex-section-");
  if (claudeMd !== null) writeFileSync(join(root, "CLAUDE.md"), claudeMd);
  return root;
}

test("the report reads CLAUDE.md, and the replace writes only an outdated section", () => {
  const head = "@AGENTS.md\n\n## Verifying your work\n\nRun it.\n\n";
  const root = repo(head + rendered(OLD) + "\n");
  const [r] = sectionReport(root);
  assert.deepEqual([r.id, r.path, r.state, r.version], ["team", "CLAUDE.md", "outdated", "2.41.0"]);

  const done = sectionReplace(root, "team");
  assert.equal(done.written, true);
  assert.equal(readFileSync(join(root, "CLAUDE.md"), "utf8"), head + rendered(PLAYBOOK));
  assert.equal(sectionReport(root)[0].state, "current");

  const again = sectionReplace(root, "team");
  assert.equal(again.written, false, "a current section is left alone");
});

test("the replace never writes an edited, missing or duplicated section, and says why", () => {
  const edited = rendered(PLAYBOOK).replace("The developer decides", "The lead decides");
  const root = repo(edited);
  assert.throws(() => sectionReplace(root, "team"), (e) => e instanceof SectionRefused && e.code === 1 && /edited here/.test(e.message));
  assert.equal(readFileSync(join(root, "CLAUDE.md"), "utf8"), edited, "untouched");
  assert.throws(() => sectionReplace(repo("@AGENTS.md\n"), "team"), (e) => e.code === 2 && /no section headed/.test(e.message));
  assert.throws(() => sectionReplace(repo(null), "team"), (e) => e.code === 2 && /no CLAUDE\.md/.test(e.message));
  assert.throws(() => sectionReplace(repo(`${rendered(OLD)}\n${rendered(OLD)}`), "team"), (e) => e.code === 2);
  assert.throws(() => sectionReplace(repo(rendered(OLD)), "nope"), (e) => e.code === 1 && /not a section Cortex writes/.test(e.message));
});

test("the replace refuses a new text that needs a value the old section never held, and writes nothing", () => {
  // A later playbook with a placeholder 2.41.0's text had no slot for: the section is outdated, but
  // there is nothing to fill it with, and a `{{MODE}}` written into CLAUDE.md is an instruction to
  // every session that means nothing.
  const templatesDir = tempDir("cortex-section-tpl-");
  mkdirSync(join(templatesDir, "team"), { recursive: true });
  writeFileSync(join(templatesDir, "team", "playbook.md"), PLAYBOOK.replace("This session runs them.", "This session runs them in {{MODE}}."));
  const text = rendered(OLD) + "\n";
  const root = repo(text);
  assert.equal(sectionReport(root, { templatesDir })[0].state, "outdated");
  assert.throws(() => sectionReplace(root, "team", { templatesDir }), (e) => e.code === 1 && /\{\{MODE\}\}/.test(e.message));
  assert.equal(readFileSync(join(root, "CLAUDE.md"), "utf8"), text, "untouched");
});

test("the team row asks the same reader whether the playbook is there", () => {
  const index = { files: [{ path: "src/a.js", category: "code" }], stats: { files: 1 } };
  const fenced = repo("# Notes\n\n```md\n## Working as a team\n```\n");
  mkdirSync(join(fenced, "src"), { recursive: true });
  assert.equal(teamState(fenced, index, {}).playbook, false, "an example in a code fence is not the playbook");
  assert.equal(teamState(repo(rendered(OLD)), index, {}).playbook, true);
});

// --- the team's answer ------------------------------------------------------------------------------

const EDITED = rendered(PLAYBOOK).replace("The developer decides", "The lead decides") + "\n";
const keptFile = (root) => join(root, ".cortex", "sections.json");
function templatesWith(playbook) {
  const dir = tempDir("cortex-section-tpl-");
  mkdirSync(join(dir, "team"), { recursive: true });
  writeFileSync(join(dir, "team", "playbook.md"), playbook);
  return dir;
}

test("an edited section the team kept is not asked about again until a release changes the template", () => {
  // A stamped file the team edited reads `edited` and nothing is said until its template changes. A
  // section had no record, so /cortex showed the same diff on every re-run; the keep is that record.
  const root = repo(EDITED);
  assert.equal(sectionReport(root)[0].state, "edited");

  const done = sectionKeep(root, "team", { version: "2.42.0" });
  assert.equal(done.written, true);
  assert.equal(readFileSync(join(root, "CLAUDE.md"), "utf8"), EDITED, "CLAUDE.md is not touched");
  assert.deepEqual(JSON.parse(readFileSync(keptFile(root), "utf8")),
    { format: 1, sections: { team: { version: "2.42.0", templateSha256: hashText(PLAYBOOK) } } });
  const [kept] = sectionReport(root);
  assert.equal(kept.state, "kept");
  assert.match(kept.why, /kept it against Cortex 2\.42\.0's text, which this release has not changed/);
  assert.equal(sectionKeep(root, "team").written, false, "keeping it twice records nothing new");

  // The team edits its own text again: still theirs, still not asked about.
  writeFileSync(join(root, "CLAUDE.md"), EDITED.replace("The lead decides", "The tech lead decides"));
  assert.equal(sectionReport(root)[0].state, "kept");

  // A release changes the playbook: the new text is shown once more, and says what was kept.
  const templatesDir = templatesWith(PLAYBOOK.replace("This session runs them.", "This session runs them, one job each."));
  const [again] = sectionReport(root, { templatesDir });
  assert.equal(again.state, "edited");
  assert.match(again.why, /kept it against Cortex 2\.42\.0's text, and this release's differs/);
  assert.ok(again.diff.includes("one job each"), "the diff is against the new text");
  assert.throws(() => sectionReplace(root, "team"), (e) => e.code === 1 && /edited here/.test(e.message), "kept is never replaced either");
});

test("the keep records only the team's text, and writes nothing else", () => {
  const current = repo(rendered(PLAYBOOK));
  assert.throws(() => sectionKeep(current, "team"), (e) => e instanceof SectionRefused && e.code === 1 && /nothing to keep/.test(e.message));
  const outdated = repo(rendered(OLD));
  assert.throws(() => sectionKeep(outdated, "team"), (e) => e.code === 1 && /nothing to keep/.test(e.message), "an outdated section is offered as an update instead");
  assert.throws(() => sectionKeep(repo("@AGENTS.md\n"), "team"), (e) => e.code === 2);
  assert.throws(() => sectionKeep(repo(null), "team"), (e) => e.code === 2);
  assert.throws(() => sectionKeep(repo(EDITED), "nope"), (e) => e.code === 1);
  for (const root of [current, outdated]) assert.equal(existsSync(join(root, ".cortex")), false, "a refusal creates nothing");

  // Another section's answer survives a keep; the file is written in one sorted form.
  const root = repo(EDITED);
  mkdirSync(join(root, ".cortex"));
  const other = { version: "2.42.0", templateSha256: "a".repeat(64) };
  writeFileSync(keptFile(root), JSON.stringify({ format: 1, sections: { zeta: other } }));
  sectionKeep(root, "team", { version: "2.42.0" });
  assert.deepEqual(Object.keys(JSON.parse(readFileSync(keptFile(root), "utf8")).sections), ["team", "zeta"]);
  assert.deepEqual(readdirSync(join(root, ".cortex")), ["sections.json"], "no temp file is left behind");
});

test("a sections record that does not read is asked about, never written over", () => {
  // Reading it as "no answers" makes the section `edited`, which asks: the safe direction. Writing a
  // fresh record over it would lose whatever it held, so the keep refuses instead.
  for (const text of ["{ not json", JSON.stringify({ format: 2, sections: {} }), JSON.stringify({ format: 1 })]) {
    const root = repo(EDITED);
    mkdirSync(join(root, ".cortex"));
    writeFileSync(keptFile(root), text);
    assert.equal(sectionReport(root)[0].state, "edited", text);
    assert.throws(() => sectionKeep(root, "team"), (e) => e.code === 2 && /left as it is/.test(e.message), text);
    assert.equal(readFileSync(keptFile(root), "utf8"), text, "untouched");
  }
  const newer = repo(EDITED);
  mkdirSync(join(newer, ".cortex"));
  writeFileSync(keptFile(newer), JSON.stringify({ format: 2, sections: {} }));
  assert.throws(() => sectionKeep(newer, "team"), (e) => /newer Cortex/.test(e.message));
});

// --- the block that has no refresh ------------------------------------------------------------------

test("the verification block's template is pinned, because nothing carries a change to it into a repo", () => {
  // `CLAUDE.md` § Verifying your work is filled partly by hand — rows deleted where a command does not
  // exist — so no section match can tell Cortex's text from the team's, and it is not in
  // CORTEX_SECTIONS. That is safe only while its template does not change: a change would reach new
  // installs and no repo that already holds the block, with nothing to say so.
  const now = readFileSync(join(REPO, "templates", "loop", "verification.md"), "utf8");
  assert.equal(hashText(now), UNTRACKED_SECTIONS["loop/verification.md"].sha256,
    "templates/loop/verification.md changed, and no repo that already holds the block will get the change. " +
      "Either give it a refresh path (a CORTEX_SECTIONS entry whose match allows the rows a team deletes), or decide " +
      "the change does not need to reach them and say so in the CHANGELOG. Then pin the new hash in " +
      "index/lib/shipped-sections.mjs UNTRACKED_SECTIONS.");
});
