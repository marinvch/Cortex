#!/usr/bin/env node
// cortex-skill-graph.mjs — which rituals reach which, and which one nothing reaches.
//
//   node tools/cortex-skill-graph.mjs                # the graph, plus the isolates
//   node tools/cortex-skill-graph.mjs --check        # exit 1 if a ritual is isolated both ways
//   node tools/cortex-skill-graph.mjs --json         # for a ritual to walk
//   node tools/cortex-skill-graph.mjs cortex-brief   # one ritual's neighbourhood
//
// The failure this catches has no error state. A ritual nothing points at still works when you type
// its name — it is simply never *reached*, so the user has to already know it exists. /wizard and
// /team-add each sat that way: /team-init created a team-brain and never mentioned the command a
// member runs to join it, and every ritual that scaffolds a repo needing manual credential setup
// re-explained the steps instead of handing over to the skill that writes the script.
//
// The rule is the one AGENTS.md applies to prose: define a thing once, and point at it from
// everywhere else. An edge here IS that pointer, so the graph is a measurement of whether the rule
// held. It reads the skill bodies rather than a maintained list, because a maintained list of edges
// is a second copy and second copies drift — that is the whole argument this file exists to enforce.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SKILLS = join(REPO_ROOT, "skills");

const args = process.argv.slice(2);
const asJson = args.includes("--json");
const check = args.includes("--check");
const only = args.find((a) => !a.startsWith("--"))?.replace(/^\//, "");

// --- read the skills -------------------------------------------------------------------------

/** Every skill directory holding a SKILL.md. The directory name is the ritual's name. */
function readSkills() {
  const out = new Map();
  for (const name of readdirSync(SKILLS)) {
    const dir = join(SKILLS, name);
    try {
      if (!statSync(dir).isDirectory()) continue;
    } catch {
      continue;
    }
    let src;
    try {
      src = readFileSync(join(dir, "SKILL.md"), "utf8");
    } catch {
      continue;
    }
    out.set(name, src);
  }
  return out;
}

// Two syntaxes mean the same thing here and both must count. `/cortex-brief` is how a ritual names
// another as a command; `[[domain-modeling]]` is the vault's wikilink. An earlier hand count read
// only the first and reported /resolving-merge-conflicts as reaching nothing, when it points at
// [[domain-modeling]] in its second step — the kind of wrong answer that gets a healthy edge
// "fixed" into a duplicate.
const SLASH_RE = /\/([a-z][a-z0-9-]+)/g;
const WIKI_RE = /\[\[([a-z][a-z0-9-]+)\]\]/g;

// A ritual nothing in this repo reaches is not automatically broken. /resolving-merge-conflicts is
// reached by an interrupted rebase and /optimize-prompt by the UserPromptSubmit hook; no ritual could
// honestly point at either, and inventing one would make the graph agree with itself while telling
// the reader something false.
//
// So the escape hatch is declared, not hardcoded here: `reached-by: <what triggers it>` in the
// frontmatter. A list of exceptions in this file would be a second copy that drifts the first time a
// skill is renamed; a line in the skill travels with it and doubles as documentation. It has to name
// what the trigger IS — a bare `reached-by: true` would just be the check switched off.
const REACHED_BY_RE = /^reached-by:\s*(\S.*?)\s*$/m;

/** The rituals `src` names, excluding itself. A name only counts if a skill by that name exists. */
function outbound(self, src, known) {
  const hits = new Set();
  for (const re of [SLASH_RE, WIKI_RE]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(src)) !== null) {
      const name = m[1];
      if (name !== self && known.has(name)) hits.add(name);
    }
  }
  return [...hits].sort();
}

const skills = readSkills();
const graph = new Map();
for (const [name, src] of skills)
  graph.set(name, {
    out: outbound(name, src, skills),
    in: [],
    reachedBy: (src.match(REACHED_BY_RE) || [])[1] || null,
  });
for (const [name, node] of graph) for (const target of node.out) graph.get(target).in.push(name);
for (const node of graph.values()) node.in.sort();

// --- the finding -----------------------------------------------------------------------------

// Isolated in ONE direction is normal and often correct: a router like /cortex-next is nearly all
// outbound, and a shared discipline like /writing-for-agents is nearly all inbound. Isolated in
// BOTH is the defect — a ritual that neither reaches anything nor is reached is not part of the
// system, it is a file that happens to live in the same folder.
const orphans = [...graph.entries()]
  .filter(([, n]) => n.out.length === 0 && n.in.length === 0 && !n.reachedBy)
  .map(([name]) => name);

// Reported beside the pass rather than folded silently into it. A declared external trigger is a
// claim about the world outside this repo — a hook that still fires, a git state that still exists —
// and the only thing keeping it true is someone reading it occasionally.
const external = [...graph.entries()]
  .filter(([, n]) => n.in.length === 0 && n.reachedBy)
  .map(([name, n]) => ({ name, reachedBy: n.reachedBy }));

if (asJson) {
  console.log(
    JSON.stringify(
      {
        skills: graph.size,
        orphans,
        external,
        edges: Object.fromEntries([...graph].map(([k, v]) => [k, { in: v.in, out: v.out }])),
      },
      null,
      2,
    ),
  );
} else if (only) {
  const node = graph.get(only);
  if (!node) {
    console.error(`no skills/${only}/SKILL.md`);
    process.exit(2);
  }
  console.log(`\n/${only}`);
  const reachedBy =
    node.in.map((n) => "/" + n).join(" ") || (node.reachedBy ? `— ${node.reachedBy}` : "— nothing");
  console.log(`  reached by  ${reachedBy}`);
  console.log(`  reaches     ${node.out.map((n) => "/" + n).join(" ") || "— nothing"}`);
} else {
  const width = Math.max(...[...graph.keys()].map((n) => n.length)) + 1;
  console.log(`\n${graph.size} rituals — in / out, then what each one reaches\n`);
  for (const [name, node] of [...graph].sort((a, b) => a[0].localeCompare(b[0]))) {
    const counts = `${String(node.in.length).padStart(2)} ← → ${String(node.out.length).padEnd(2)}`;
    const reaches = node.out.map((n) => "/" + n).join(" ") || "—";
    console.log(`  /${name.padEnd(width)} ${counts}  ${reaches}`);
  }
  if (orphans.length) {
    console.log(`\nisolated both ways: ${orphans.map((n) => "/" + n).join(", ")}`);
    console.log(
      "Give each one an edge in the direction that is true — a ritual it hands off to, or a\n" +
        "ritual that should hand off to it. Do not invent a decorative link; if nothing genuinely\n" +
        "reaches it, that is a finding about the ritual, not about the graph.",
    );
  } else {
    console.log("\nno ritual is isolated in both directions.");
  }
  for (const e of external) console.log(`reached from outside: /${e.name} — ${e.reachedBy}`);
}

if (check && orphans.length) process.exit(1);
