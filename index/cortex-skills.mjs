#!/usr/bin/env node
// cortex-skills.mjs — which skills this repo would benefit from, from what the index detected.
//
//   node index/cortex-skills.mjs .            # human-readable proposal
//   node index/cortex-skills.mjs . --offers   # JSON worklist, for a ritual to walk
//
// Both also report the skills already in .claude/skills/ that the repo now contradicts — the
// `drift` key in --offers, one line per finding otherwise (lib/skill-drift.mjs).
//
// Read-only in the strongest sense: it writes nothing at all, not even under .cortex/. The bodies
// are written by /cortex-skills after the user picks, because a useful body quotes this repo's real
// commands and real paths — and inventing those is precisely the failure a deterministic module
// cannot detect in itself.

import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { proposeSkills, partitionExisting } from "./lib/skills.mjs";
import { labelsFor } from "./lib/stack.mjs";
import { skillDrift } from "./lib/skill-drift.mjs";
import { openTarget } from "./lib/open.mjs";

// Every proposal cites something the index detected, so the index is required. "No index" is one of
// this command's three refusals, and the other two are below.
const { root, args, index } = openTarget(process.argv.slice(2), {
  usage: "usage: node index/cortex-skills.mjs [root] [--index FILE] [--offers]",
  flags: { "--offers": "boolean", "--index": "value" },
  root: "positional",
  index: "require",
  // --offers is JSON a ritual walks.
  freshness: (a) => !a.offers,
});

/** Skills the repo already has, so present ones are reported rather than silently dropped. */
function existingSkills(r) {
  const out = [];
  for (const dir of [join(r, ".claude", "skills"), join(r, ".agents", "skills")]) {
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      try {
        if (statSync(join(dir, name)).isDirectory()) out.push(name);
      } catch { /* unreadable entry is not an existing skill */ }
    }
  }
  return [...new Set(out)];
}

const proposed = proposeSkills(index);
const { missing, present } = partitionExisting(proposed, existingSkills(root));
// The skills already here, checked against the repo they describe (#462). Proposing new skills and
// leaving a written one telling agents "there are no tests" beside a test suite is half the job.
const drift = skillDrift(root, index)?.drifted ?? [];

if (args.offers) {
  console.log(JSON.stringify({ stack: index.stack ?? null, propose: missing, alreadyPresent: present, drift }, null, 2));
  process.exit(0);
}

const st = index.stack;
if (!st || !st.manifests?.length) {
  console.log("No dependency manifest found, so the stack is unknown and nothing stack-specific can");
  console.log("be proposed honestly. Add a package.json / pyproject.toml / go.mod, or write skills by hand.");
}

if (st) {
  const line = (label, ids) => (ids?.length ? `  ${label.padEnd(11)} ${labelsFor(ids).join(" · ")}` : null);
  const lines = [
    line("language", st.languages), line("framework", st.frameworks), line("data", st.data),
    line("services", st.services), line("tests", st.test), line("delivery", st.delivery),
  ].filter(Boolean);
  if (lines.length) {
    console.log(`\nDetected stack (${index.stats.files} files, ${index.stats.tests} test files)`);
    console.log(lines.join("\n"));
  }
}

if (!missing.length) {
  console.log(`\nNothing to propose — every skill this stack suggests is already here.`);
} else {
  console.log(`\n${missing.length} skill${missing.length === 1 ? "" : "s"} worth adding, most useful first:\n`);
  for (const p of missing) {
    console.log(`  /${p.id}  — ${p.title}`);
    console.log(`      why: ${p.why}`);
    // The exact frontmatter line the written skill carries, so the ritual copies it rather than
    // re-deriving globs. Absent when nothing file-shaped was detected — the skill then loads by
    // description alone, as every skill did before `paths` existed.
    if (p.pathsLine) console.log(`      ${p.pathsLine}`);
    console.log("");
  }
  console.log("These are proposals. Nothing has been written. Run /cortex-skills to pick and write them.");
}

if (present.length) {
  console.log(`\nAlready present: ${present.map((p) => p.id).join(", ")}`);
}

// Every line cites the skill file and the line, so the reader can open it and check — the same
// standard the proposals hold: a claim a user cannot verify is one they cannot act on.
if (drift.length) {
  console.log(`\n${drift.length} skill${drift.length === 1 ? "" : "s"} here the repo has moved away from — each line below is provable from disk:\n`);
  for (const d of drift) {
    console.log(`  /${d.skill}  ${d.path}${d.editedNote ? ` — ${d.editedNote}` : ""}`);
    for (const f of d.findings) {
      console.log(`      line ${f.line}: ${f.why}`);
      if (f.hint) console.log(`        a file of that name is at ${f.hint}`);
    }
    console.log("");
  }
  console.log("Nothing has been changed. /cortex-skills refreshes the lines above, and asks before touching");
  console.log("a skill that was edited after it was written.");
}
