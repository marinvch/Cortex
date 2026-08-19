#!/usr/bin/env node
// cortex-capability.mjs — what each ritual needs from the setup running it.
//
//   node tools/cortex-capability.mjs               # the whole table
//   node tools/cortex-capability.mjs mechanical    # only what runs anywhere
//
// Cortex names self-hosted and own-LLM setups as an audience, and until now gave them nothing to
// consult: a ritual needing multi-round judgment looked exactly like one that appends a line to a
// file. The failure is not a crash — a weak model runs /cortex-enrich and writes plausible, wrong
// summaries into recall, and nobody notices. This is the list you read BEFORE running something.
//
// The frontmatter is the source of truth; this reads it rather than restating it, so the table
// cannot drift from the rituals it describes.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SKILLS = join(REPO_ROOT, "skills");

const TIERS = {
  mechanical: "runs anywhere — the work is files, or a deterministic tool",
  judgment: "reads real code or prose and writes claims that must be TRUE",
  strong: "multi-round reasoning or whole-repo synthesis; each has a degraded path",
};

const want = process.argv[2];
if (want && !(want in TIERS)) {
  console.error(`unknown tier: ${want}. Expected one of: ${Object.keys(TIERS).join(", ")}`);
  process.exit(2);
}

const rows = [];
for (const name of readdirSync(SKILLS)) {
  const p = join(SKILLS, name, "SKILL.md");
  try {
    if (!statSync(join(SKILLS, name)).isDirectory()) continue;
  } catch { continue; }
  let src;
  try { src = readFileSync(p, "utf8"); } catch { continue; }
  const cap = (src.match(/^capability:\s*(\S+)\s*$/m) || [])[1] || "undeclared";
  const degraded = /## When the floor is not met/m.test(src);
  rows.push({ name, cap, degraded });
}

for (const tier of Object.keys(TIERS)) {
  if (want && tier !== want) continue;
  const inTier = rows.filter((r) => r.cap === tier).sort((a, b) => a.name.localeCompare(b.name));
  if (!inTier.length) continue;
  console.log(`\n${tier}  — ${TIERS[tier]}`);
  for (const r of inTier) console.log(`  /${r.name}${r.degraded ? "   (has a degraded path)" : ""}`);
}

const undeclared = rows.filter((r) => r.cap === "undeclared");
if (undeclared.length) {
  console.error(`\nundeclared: ${undeclared.map((r) => r.name).join(", ")}`);
  process.exit(1);
}
if (!want) console.log(`\n${rows.length} rituals. Run a tier name to filter, e.g. \`mechanical\`.`);
