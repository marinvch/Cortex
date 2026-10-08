#!/usr/bin/env node
// triggers.mjs — is each ritual's description made of the words people use to ask for it?
//
//   node evals/triggers.mjs                 # every ritual: where its prompts rank it
//   node evals/triggers.mjs resume          # one ritual, prompt by prompt, with what outranked it
//   node evals/triggers.mjs --check         # exit 1 on a problem. No model, so CI runs it
//   node evals/triggers.mjs --record        # write the rank-1 rate. Refuses to lower it
//
// A ritual a model may invoke is found through one sentence: its `description`. Edit that sentence
// and nothing fails; the ritual is just reached less. `evals/triggers/<ritual>.json` holds what a
// person would type (`reach`), and prompts that sound close but belong to a named other ritual
// (`elsewhere`). Every prompt is ranked against every model-invocable ritual's name and description.
//
// What this measures is words: BM25 over the descriptions, the same on every machine. It is NOT
// Claude Code's router, which reads meaning. A prompt that ranks first here can still be routed
// elsewhere, and one that ranks fourth can still be reached. What it does catch is the cheap, common
// break: a description edited until the words a person says are no longer in it.
//
// The rules `--check` holds:
//   - every model-invocable ritual has a file, with at least MIN_REACH prompts and one `elsewhere`;
//   - a `reach` prompt ranks its ritual within TOP;
//   - an `elsewhere` prompt ranks its owner above the ritual;
//   - a `reach` prompt is not just one of the description's own quoted triggers, which would pass
//     by construction and say nothing;
//   - the share of `reach` prompts ranked first is not below the recorded one.

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseFrontmatter } from "../tools/cortex-frontmatter.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
export const MIN_REACH = 3;
export const TOP = 3;

// Words that carry no routing signal. Short on purpose: a word dropped here can never rank a ritual.
const STOP = new Set(
  ("a an and any are as at be been but by can could did do does for from had has have how i if in into is it its just me my " +
    "need no not now of on or our out please should so that the their them then there these this those to up us want was we " +
    "were what when where which who why will with would you your " +
    // what a contraction leaves behind once the apostrophe splits it: what's, don't, we'll
    "s t d ll re ve m").split(" "),
);

/** One word, to the form it is compared in: plural and tense endings dropped. Deliberately crude. */
function stem(w) {
  if (!/^[a-z]+$/.test(w) || w.length < 5) return w;
  for (const [end, to] of [["ies", "y"], ["ing", ""], ["ed", ""], ["es", ""], ["s", ""]]) {
    if (w.endsWith(end) && w.length - end.length + to.length >= 3) return w.slice(0, w.length - end.length) + to;
  }
  return w;
}

/** The words of `text` that can rank a ritual: lower case, any script, stop words out, stemmed. */
export function tokens(text) {
  return (String(text).toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((w) => !STOP.has(w)).map(stem);
}

/** `[{ name, description }]` for every ritual a model may invoke, by name. */
export function readRituals(root = REPO) {
  const out = [];
  for (const name of readdirSync(join(root, "skills")).sort()) {
    const file = join(root, "skills", name, "SKILL.md");
    if (!existsSync(file)) continue;
    const { data } = parseFrontmatter(readFileSync(file, "utf8"));
    if (data["disable-model-invocation"]?.trim() === "true") continue;
    out.push({ name, description: data.description ?? "" });
  }
  return out;
}

/**
 * A ranker over `rituals`. `rank(prompt)` returns their names, best first, by BM25 of the prompt's
 * words against each ritual's name and description. A tie goes to the earlier name, so the order is
 * the same on every run.
 */
export function ranker(rituals) {
  const docs = rituals.map((r) => ({ name: r.name, words: tokens(`${r.name} ${r.description}`) }));
  const avg = docs.reduce((n, d) => n + d.words.length, 0) / (docs.length || 1);
  const df = new Map();
  for (const d of docs) for (const w of new Set(d.words)) df.set(w, (df.get(w) ?? 0) + 1);
  const idf = (w) => Math.log(1 + (docs.length - (df.get(w) ?? 0) + 0.5) / ((df.get(w) ?? 0) + 0.5));
  const K1 = 1.2;
  const B = 0.75;
  const score = (doc, q) => {
    let s = 0;
    for (const w of new Set(q)) {
      const tf = doc.words.filter((x) => x === w).length;
      if (tf) s += (idf(w) * tf * (K1 + 1)) / (tf + K1 * (1 - B + (B * doc.words.length) / avg));
    }
    return s;
  };
  return {
    rank(prompt) {
      const q = tokens(prompt);
      return docs
        .map((d) => ({ name: d.name, score: score(d, q) }))
        .sort((a, b) => b.score - a.score || (a.name < b.name ? -1 : 1))
        .map((x) => x.name);
    },
  };
}

/** The phrases a description puts in double quotes: its own trigger list. */
const quoted = (description) => [...String(description).matchAll(/"([^"]+)"/g)].map((m) => tokens(m[1]).join(" "));

const paths = (root) => ({ dir: join(root, "evals", "triggers"), baseline: join(root, "evals", "baselines", "triggers.json") });
const round = (n) => Math.round(n * 10000) / 10000;

/**
 * Rank every prompt. `{ ok, problems, rows, reach, rank1, rate, recorded }`: `rows` is one entry per
 * prompt (`{ ritual, kind, prompt, position, above }`), `rate` the share of `reach` prompts ranked
 * first, `recorded` the committed rate or null.
 */
export function checkTriggers({ root = REPO } = {}) {
  const p = paths(root);
  const rituals = readRituals(root);
  const names = new Set(rituals.map((r) => r.name));
  const { rank } = ranker(rituals);
  const problems = [];
  const rows = [];
  for (const r of rituals) {
    const file = join(p.dir, `${r.name}.json`);
    if (!existsSync(file)) {
      problems.push(`${r.name}: no evals/triggers/${r.name}.json — a ritual a model may invoke needs the prompts that should reach it`);
      continue;
    }
    let set;
    try {
      set = JSON.parse(readFileSync(file, "utf8"));
    } catch (e) {
      problems.push(`${r.name}: evals/triggers/${r.name}.json is not JSON (${e.message})`);
      continue;
    }
    const reach = Array.isArray(set.reach) ? set.reach : [];
    const elsewhere = Array.isArray(set.elsewhere) ? set.elsewhere : [];
    if (reach.length < MIN_REACH) problems.push(`${r.name}: ${reach.length} reach prompt(s), and ${MIN_REACH} is the least that says anything`);
    if (!elsewhere.length) problems.push(`${r.name}: no elsewhere prompt — name one that sounds close and belongs to another ritual`);
    const own = quoted(r.description);
    for (const prompt of reach) {
      const order = rank(prompt);
      const position = order.indexOf(r.name) + 1;
      rows.push({ ritual: r.name, kind: "reach", prompt, position, above: order.slice(0, position - 1) });
      if (own.includes(tokens(prompt).join(" "))) {
        problems.push(`${r.name}: "${prompt}" is one of the description's own quoted triggers, so it ranks by construction — write what a person would say`);
      } else if (position > TOP) {
        problems.push(`${r.name}: "${prompt}" ranks it ${position}, below ${order.slice(0, TOP).join(", ")} — the description does not hold the words this prompt uses`);
      }
    }
    for (const e of elsewhere) {
      if (!names.has(e.owner) || e.owner === r.name) {
        problems.push(`${r.name}: elsewhere prompt "${e.prompt}" names owner "${e.owner}", which is not another model-invocable ritual`);
        continue;
      }
      const order = rank(e.prompt);
      const position = order.indexOf(r.name) + 1;
      const owner = order.indexOf(e.owner) + 1;
      rows.push({ ritual: r.name, kind: "elsewhere", prompt: e.prompt, owner: e.owner, position, ownerPosition: owner });
      if (owner > position) {
        problems.push(`${r.name}: "${e.prompt}" belongs to /${e.owner}, which ranks ${owner} while /${r.name} ranks ${position} — the two descriptions pull the wrong way`);
      }
    }
  }
  for (const f of existsSync(p.dir) ? readdirSync(p.dir) : []) {
    const name = f.replace(/\.json$/, "");
    if (f.endsWith(".json") && !names.has(name)) problems.push(`evals/triggers/${f}: no model-invocable ritual is named ${name}`);
  }
  const reachRows = rows.filter((x) => x.kind === "reach");
  const rank1 = reachRows.filter((x) => x.position === 1).length;
  const rate = reachRows.length ? round(rank1 / reachRows.length) : 0;
  const recorded = existsSync(p.baseline) ? JSON.parse(readFileSync(p.baseline, "utf8")) : null;
  if (!recorded) problems.push("no evals/baselines/triggers.json — record the rank-1 rate with `node evals/triggers.mjs --record`");
  else if (rate < recorded.rank1Rate) {
    problems.push(`${rank1} of ${reachRows.length} reach prompts rank first (${rate}), below the recorded ${recorded.rank1Rate} — the rate is only raised`);
  }
  return { ok: problems.length === 0, problems, rows, reach: reachRows.length, rank1, rate, recorded };
}

/** Write the rank-1 rate. Refuses to lower it, and refuses while any other problem stands. */
export function recordTriggers({ root = REPO } = {}) {
  const r = checkTriggers({ root });
  const other = r.problems.filter((m) => !m.startsWith("no evals/baselines/triggers.json"));
  if (other.length) return { written: false, problems: other };
  const next = { rank1Rate: r.rate, rank1: r.rank1, reach: r.reach, top: TOP };
  writeFileSync(paths(root).baseline, JSON.stringify(next, null, 2) + "\n");
  return { written: true, ...next, was: r.recorded?.rank1Rate ?? null };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const only = args.find((a) => !a.startsWith("--"));
  if (args.includes("--record")) {
    const r = recordTriggers();
    if (!r.written) {
      for (const m of r.problems) console.error(m);
      console.error("nothing was recorded.");
      process.exit(1);
    }
    console.log(`recorded evals/baselines/triggers.json — ${r.rank1} of ${r.reach} reach prompts rank first (${r.rank1Rate}${r.was == null ? "" : `, was ${r.was}`})`);
    process.exit(0);
  }
  const r = checkTriggers();
  if (only) {
    for (const x of r.rows.filter((row) => row.ritual === only)) {
      console.log(
        x.kind === "reach"
          ? `  ${String(x.position).padStart(2)}  ${x.prompt}${x.above.length ? `   (above it: ${x.above.join(", ")})` : ""}`
          : `  ${String(x.position).padStart(2)}  ${x.prompt}   (belongs to /${x.owner}, ranked ${x.ownerPosition})`,
      );
    }
  }
  for (const m of r.problems) console.error(m);
  const within = r.rows.filter((x) => x.kind === "reach" && x.position <= TOP).length;
  console.log(
    r.ok
      ? `${r.rank1} of ${r.reach} reach prompts rank their ritual first (${r.rate}), ${within} within ${TOP}; every elsewhere prompt ranks its owner higher`
      : `${r.problems.length} trigger problem(s); ${r.rank1} of ${r.reach} reach prompts rank first (${r.rate})`,
  );
  if (args.includes("--check") && !r.ok) process.exit(1);
}
