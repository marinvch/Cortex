#!/usr/bin/env node
// cortex-section.mjs — the sections Cortex wrote into a shared file, against this release (#505).
//
//   node index/cortex-section.mjs <repo> [--json]        # each section's state, and its diff; writes nothing
//   node index/cortex-section.mjs <repo> --replace team  # replace an outdated section with this release's text
//
// Today there is one section: the team playbook, `CLAUDE.md` § Working as a team. It is appended to a
// file the team also writes, so the stamp record cannot hold it, and a repo stamped by 2.41.0 kept the
// playbook that did not ask "Single agent or team?" (#498) with nothing to say so. Its state
// (lib/section.mjs) is `current` (this release's text, with the section's own roster), `outdated` (an
// earlier release's text, untouched, from `lib/shipped-sections.mjs`), `edited` (anything else — the
// team's), `duplicate` or `absent`.
//
// `/cortex` reads `--json` on a re-run and offers an outdated section as a replace in its one
// confirmation, with the diff; an edited one is shown with the diff and asked about, never replaced.
// `cortex-next` names both. `--replace` writes only an outdated section: every byte outside it stays
// where it was, the result is read back before it is written, and it goes through a temp file renamed
// into place. This is the third script in index/ that writes outside `.cortex/`, beside
// `cortex-stamps.mjs update` and `cortex-shared-plugin.mjs --write`.
//
// Exit codes: 0 for a status, a replace, or a section already current; 1 for a bad argument or a
// refused replace (an edited section, an unknown id, a value the new text needs); 2 for a file state
// it will not write into (no CLAUDE.md, no section, two sections).

import { openTarget } from "./lib/open.mjs";
import { SectionRefused } from "./lib/section.mjs";
import { sectionReport, sectionReplace } from "./lib/sections.mjs";

const USAGE = "usage: node index/cortex-section.mjs <repo> [--json] [--replace <section>]";

const refuse = (text, code) => {
  process.stderr.write(text.endsWith("\n") ? text : text + "\n");
  process.exit(code);
};

const { root, args } = openTarget(process.argv.slice(2), {
  usage: USAGE,
  flags: { "--json": "boolean", "--replace": "value" },
  root: "positional",
  index: "none",
});

if (args.replace != null) {
  if (args.json) refuse(`--replace and --json are separate: read the state, then replace\n${USAGE}`, 1);
  try {
    const r = sectionReplace(root, args.replace);
    console.log(r.written ? `Replaced ${r.section}: ${r.why}.` : `Nothing to replace: ${r.why}.`);
    if (r.written) console.log("Every other line of the file is as it was. Commit it so the team shares the new text.");
    process.exit(0);
  } catch (e) {
    if (!(e instanceof SectionRefused)) throw e;
    refuse(`${e.message}\nNothing was written.`, e.code);
  }
}

const report = sectionReport(root);

if (args.json) {
  // The machine form /cortex reads. Paths are repo-relative, and no absolute path is printed.
  console.log(JSON.stringify({ sections: report }, null, 2));
  process.exit(0);
}

for (const s of report) {
  console.log(`${s.state}: ${s.why}.`);
  if (s.diff) {
    console.log(`--- ${s.path} (the section now)`);
    console.log(`+++ ${s.template} (this release's text${s.values && Object.keys(s.values).length ? ", with the section's own values" : ""})`);
    process.stdout.write(s.diff);
  }
  if (s.state === "outdated" && !s.unfilled.length) console.log(`\n\`cortex-section.mjs . --replace ${s.id}\` replaces it; /cortex offers that in its confirmation.`);
  if (s.state === "edited") console.log("\nIt is the team's text: take any line of the new one by hand, or leave it as it is.");
}
console.log("\nNothing was changed.");
