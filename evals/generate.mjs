#!/usr/bin/env node
// Write the skill evals: evals/data/<skill>/{train,val,test}/tasks.json, deterministically.
//
//   node evals/generate.mjs            # all skills
//   node evals/generate.mjs ship       # one
//   node evals/generate.mjs --check    # exit 1 if the committed data differs from what the seeds write
//
// Seeds are fixed per split, so the files are reproducible and a diff in them means a generator
// changed. `score.mjs` holds the answers' checker; the tasks carry the ground truth it needs.

import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SKILLS } from "./skills.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SPLITS = { train: [1000, 16], val: [2000, 10], test: [3000, 14] };

export function build(skill) {
  const mod = SKILLS[skill];
  const out = {};
  for (const [split, [base, n]] of Object.entries(SPLITS)) {
    out[split] = [];
    for (let i = 0; i < n; i++) {
      const seed = base + i + skill.length * 7919;
      const s = mod.generate(seed);
      out[split].push({ id: `${skill}-${split}-${i}`, skill, seed, task_type: skill, prompt: mod.render(s), truth: mod.truth(s) });
    }
  }
  return out;
}

const args = process.argv.slice(2);
const check = args.includes("--check");
const wanted = args.filter((a) => !a.startsWith("--"));
let drift = 0;
for (const skill of wanted.length ? wanted : Object.keys(SKILLS)) {
  if (!SKILLS[skill]) { console.error(`unknown skill: ${skill} (have: ${Object.keys(SKILLS).join(", ")})`); process.exit(2); }
  for (const [split, items] of Object.entries(build(skill))) {
    const path = join(HERE, "data", skill, split, "tasks.json");
    const text = JSON.stringify(items, null, 2) + "\n";
    if (check) {
      if (!existsSync(path) || readFileSync(path, "utf8").replace(/\r\n/g, "\n") !== text) { console.log(`drift  ${path}`); drift++; }
      continue;
    }
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
    console.log(`wrote  ${skill}/${split}  ${items.length} tasks`);
  }
}
if (check) { console.log(drift ? `${drift} split(s) differ from their seeds` : "every split matches its seeds"); process.exit(drift ? 1 : 0); }
