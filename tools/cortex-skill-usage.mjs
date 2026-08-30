#!/usr/bin/env node
// cortex-skill-usage.mjs — which skills anyone actually reached, from the session record.
//
//   node tools/cortex-skill-usage.mjs              # every skill, ranked by real use
//   node tools/cortex-skill-usage.mjs --unused     # only the ones nothing ever reached
//   node tools/cortex-skill-usage.mjs --days 60    # a window, instead of all history
//   node tools/cortex-skill-usage.mjs --json
//
// Every other audit reads the skills. This reads the *sessions*, because a skill's real defect is
// usually invisible in its own file: it is well written, correct, wired in — and nobody has ever
// reached it. Cortex found ten rituals in that state, including /handoff and /catch-me-up, across 51
// sessions. Nothing in the skills themselves said so.
//
// Two counts, deliberately separate. A `<command-name>` block is a human TYPING the slash command; a
// `Skill` tool call is the model deciding to load it. The gap between them is the diagnosis:
//
//   typed > 0, auto = 0   the description does not match how the work actually arrives
//   typed = 0, auto > 0   it triggers on its own — the slash command is decoration
//   both = 0              nothing reaches it; see cortex-skill-graph.mjs for whether that is
//                         a wiring problem or the skill needs a front door
//
// PRIVACY. This reads a transcript directory that contains everything the user has ever typed,
// so it extracts only skill NAMES and timestamps — never prompt text, never file paths from a
// session, never a project name beyond the directory slug it needs to count distinct projects. A
// tool that summarised what someone worked on would be a different tool with a different consent
// question, and it is not this one. Nothing here is written to disk.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SESSIONS = process.env.CORTEX_SESSIONS_DIR || join(homedir(), ".claude", "projects");

const argv = process.argv.slice(2);
const asJson = argv.includes("--json");
const unusedOnly = argv.includes("--unused");
const days = Number((argv.find((a) => a.startsWith("--days")) || "").split(/[= ]/)[1] ?? argv[argv.indexOf("--days") + 1]) || null;
const cutoff = days ? Date.now() - days * 86_400_000 : null;

// --- what exists ---------------------------------------------------------------------------------

/** Skills shipped by this repo. The directory name is the ritual's name. */
function shippedSkills() {
  const out = new Set();
  let names;
  try {
    names = readdirSync(join(REPO_ROOT, "skills"));
  } catch {
    return out;
  }
  for (const n of names) {
    try {
      if (statSync(join(REPO_ROOT, "skills", n, "SKILL.md")).isFile()) out.add(n);
    } catch { /* not a skill directory */ }
  }
  return out;
}

// --- what was reached ----------------------------------------------------------------------------

// Both syntaxes name the same skill and both are stripped to the bare name, because
// `/cortex:cortex-install`, `/cortex-install` and a `Skill` call for `cortex:cortex-install` are one
// ritual being used three ways. Counting them apart would report a heavily-used skill as three
// lightly-used ones.
const bare = (s) => String(s).replace(/^\//, "").replace(/^[a-z0-9-]+:/, "").trim();

const COMMAND_RE = /<command-name>([^<]+)<\/command-name>/;

function scan() {
  const use = new Map(); // name → { typed, auto, projects:Set, first, last }
  let sessions = 0;
  let projects = 0;

  const touch = (name) => {
    if (!use.has(name)) use.set(name, { typed: 0, auto: 0, projects: new Set(), first: null, last: null });
    return use.get(name);
  };
  const stamp = (rec, ts, proj) => {
    if (proj) rec.projects.add(proj);
    if (!ts) return;
    if (!rec.first || ts < rec.first) rec.first = ts;
    if (!rec.last || ts > rec.last) rec.last = ts;
  };

  let dirs;
  try {
    dirs = readdirSync(SESSIONS);
  } catch {
    return { use, sessions, projects, missing: true };
  }

  for (const proj of dirs) {
    const dir = join(SESSIONS, proj);
    try {
      if (!statSync(dir).isDirectory()) continue;
    } catch { continue; }
    projects++;
    for (const file of readdirSync(dir)) {
      if (!file.endsWith(".jsonl")) continue;
      let lines;
      try {
        lines = readFileSync(join(dir, file), "utf8").split("\n");
      } catch { continue; }
      sessions++;
      for (const line of lines) {
        // A cheap prefilter: most lines are ordinary turns and parsing them all is the slow path.
        if (!line.includes("command-name") && !line.includes('"Skill"')) continue;
        let o;
        try {
          o = JSON.parse(line);
        } catch { continue; }
        const ts = o.timestamp ? Date.parse(o.timestamp) : null;
        if (cutoff && ts && ts < cutoff) continue;

        const content = o.message?.content;

        // typed: a human ran the slash command
        if (typeof content === "string" || Array.isArray(content)) {
          const text = typeof content === "string"
            ? content
            : content.filter((b) => b.type === "text").map((b) => b.text).join("\n");
          const m = text.match(COMMAND_RE);
          if (m) {
            const rec = touch(bare(m[1]));
            rec.typed++;
            stamp(rec, ts, proj);
          }
        }

        // auto: the model chose to load it
        if (Array.isArray(content)) {
          for (const b of content) {
            if (b.type === "tool_use" && b.name === "Skill" && b.input?.skill) {
              const rec = touch(bare(b.input.skill));
              rec.auto++;
              stamp(rec, ts, proj);
            }
          }
        }
      }
    }
  }
  return { use, sessions, projects, missing: false };
}

// --- report --------------------------------------------------------------------------------------

const shipped = shippedSkills();
const { use, sessions, projects, missing } = scan();

if (missing) {
  console.error(`no session history at ${SESSIONS} — nothing to measure.`);
  console.error("Set CORTEX_SESSIONS_DIR to point elsewhere.");
  process.exit(2);
}

const day = (ms) => (ms ? new Date(ms).toISOString().slice(0, 10) : "—");

const rows = [...shipped].map((name) => {
  const r = use.get(name) || { typed: 0, auto: 0, projects: new Set(), first: null, last: null };
  return {
    name,
    typed: r.typed,
    auto: r.auto,
    total: r.typed + r.auto,
    projects: r.projects.size,
    lastUsed: day(r.last),
    // The diagnosis, as data rather than as a sentence, so a ritual can branch on it.
    verdict:
      r.typed + r.auto === 0 ? "never-reached"
        : r.auto === 0 ? "typed-only"
        : r.typed === 0 ? "auto-only"
        : "both",
  };
});

// Skills used that this repo does not ship — other plugins, or a renamed ritual whose old name is
// still being typed. Worth seeing: a rename that left the old name in someone's muscle memory looks
// exactly like a skill that vanished.
const foreign = [...use.entries()]
  .filter(([n]) => !shipped.has(n))
  .map(([name, r]) => ({ name, total: r.typed + r.auto }))
  .sort((a, b) => b.total - a.total);

const unused = rows.filter((r) => r.total === 0).sort((a, b) => a.name.localeCompare(b.name));

if (asJson) {
  console.log(JSON.stringify({ sessions, projects, window: days ? `${days}d` : "all", rows, unused: unused.map((r) => r.name), foreign }, null, 2));
} else if (unusedOnly) {
  console.log(`\n${unused.length} of ${rows.length} skills were never reached in ${sessions} sessions\n`);
  for (const r of unused) console.log(`  /${r.name}`);
  console.log(
    "\nNever reached is not the same as unwanted. Check cortex-skill-graph.mjs first: a ritual\n" +
      "nothing points at needs a front door, not a pushier description. And some are deliberate\n" +
      "acts — /dream and /handoff are things a person decides to do, so auto-firing them is wrong.",
  );
} else {
  const w = Math.max(...rows.map((r) => r.name.length)) + 1;
  console.log(`\n${sessions} sessions across ${projects} projects${days ? `, last ${days} days` : ""}\n`);
  console.log(`  ${"ritual".padEnd(w)} typed  auto  projects  last used`);
  for (const r of rows.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name))) {
    const mark = r.total === 0 ? "·" : " ";
    console.log(
      `${mark} /${r.name.padEnd(w)} ${String(r.typed).padStart(5)} ${String(r.auto).padStart(5)} ` +
        `${String(r.projects).padStart(9)}  ${r.lastUsed}`,
    );
  }
  console.log(`\n${unused.length} never reached (marked ·). Run --unused for the list and what it means.`);
  if (foreign.length) {
    console.log(`\nAlso used, not shipped here: ${foreign.slice(0, 8).map((f) => `${f.name}(${f.total})`).join(" ")}`);
  }
}
