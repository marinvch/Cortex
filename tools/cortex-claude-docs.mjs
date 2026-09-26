#!/usr/bin/env node
// cortex-claude-docs.mjs — are the Claude Code rules Cortex ships still what Anthropic's docs say?
//
//   node tools/cortex-claude-docs.mjs                 # report, exit 0
//   node tools/cortex-claude-docs.mjs --check         # exit 1 if a rule went stale, 2 if a page could not be read
//   node tools/cortex-claude-docs.mjs --json
//   node tools/cortex-claude-docs.mjs --pages <dir>   # read <dir>/<page>.md instead of the network
//
// core/claude-code.js vendors each rule with the sentence on its source page that states it. This
// fetches every source page (the docs serve markdown at `<url>.md`) and confirms each sentence is
// still there. A rule whose sentence is gone is STALE — the docs changed, and the rule, the value
// and whatever consumes it need a human to look. For the frontmatter key lists it also reads the
// reference table: a known key that left the table is stale, and a row Cortex does not know is
// reported as new, which breaks nothing but is a feature Cortex is not using yet.
//
// A page that could not be fetched is neither ok nor stale, and says so: an offline run that printed
// green would be the exact silent pass this tool exists to prevent.
//
// Maintainer-only. Users never run this; they get the rules with the plugin. ADR 0017.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CHECKED, RULES } from "../core/claude-code.js";

const args = process.argv.slice(2);
const asJson = args.includes("--json");
const check = args.includes("--check");
const pagesAt = args.includes("--pages") ? args[args.indexOf("--pages") + 1] : null;

/**
 * Markdown → the words a reader sees, so a sentence matches whatever the page wraps it in: link
 * targets dropped, code and emphasis marks dropped, table pipes and every run of whitespace
 * collapsed to one space. Applied to both the page and the evidence, so either may carry the marks.
 */
function normalise(md) {
  return md
    .replace(/\\([\\`*_{}[\]()#+\-.!|])/g, "$1")
    .replace(/<[^>\n]+>/g, " ")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[`*]/g, "")
    .replace(/\|/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The keys a frontmatter reference table lists: rows whose second cell is Yes / No / Recommended. */
function tableKeys(md) {
  const keys = [];
  for (const line of md.split(/\r?\n/)) {
    const m = line.match(/^\|\s*`([A-Za-z_][\w-]*)`\s*\|\s*(Yes|No|Recommended)\s*\|/);
    if (m) keys.push(m[1]);
  }
  return keys;
}

/** Judge every rule against the pages that were read. `pages` maps source URL → markdown | Error. */
function judge(rules, pages) {
  const stale = [];
  const unchecked = [];
  const newKeys = {};
  for (const r of rules) {
    const page = pages.get(r.source);
    if (!(typeof page === "string")) {
      unchecked.push({ id: r.id, source: r.source, reason: page?.message ?? "not read" });
      continue;
    }
    const text = normalise(page);
    const problems = [];
    if (!text.includes(normalise(r.evidence))) problems.push("evidence no longer on the page");
    if (r.table === "frontmatter") {
      const onPage = tableKeys(page);
      const gone = r.value.filter((k) => !onPage.includes(k));
      if (gone.length) problems.push(`keys no longer in the table: ${gone.join(", ")}`);
      const added = onPage.filter((k) => !r.value.includes(k));
      if (added.length) newKeys[r.id] = added;
    }
    if (problems.length) stale.push({ id: r.id, source: r.source, evidence: r.evidence, problems });
  }
  return { stale, unchecked, newKeys };
}

async function readPage(source) {
  if (pagesAt) {
    const file = join(pagesAt, `${source.split("/").pop()}.md`);
    try {
      return readFileSync(file, "utf8");
    } catch {
      return new Error(`no fixture at ${file}`);
    }
  }
  try {
    const res = await fetch(`${source}.md`, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) return new Error(`HTTP ${res.status}`);
    return await res.text();
  } catch (e) {
    return new Error(e?.cause?.code ?? e?.name ?? String(e));
  }
}

async function main() {
  const sources = [...new Set(RULES.map((r) => r.source))];
  const pages = new Map();
  await Promise.all(sources.map(async (s) => pages.set(s, await readPage(s))));
  const { stale, unchecked, newKeys } = judge(RULES, pages);
  const code = stale.length ? 1 : unchecked.length ? 2 : 0;

  if (asJson) {
    const result = {
      checked: CHECKED,
      rules: RULES.length,
      pages: sources.map((s) => ({
        source: s,
        read: typeof pages.get(s) === "string",
        error: typeof pages.get(s) === "string" ? null : pages.get(s).message,
      })),
      stale,
      unchecked,
      newKeys,
      ok: code === 0,
    };
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    const out = [`Claude Code rules — ${RULES.length} rules from ${sources.length} pages, last confirmed ${CHECKED}`];
    for (const s of sources) {
      const page = pages.get(s);
      const n = RULES.filter((r) => r.source === s).length;
      if (typeof page !== "string") out.push(`  ?      ${s} — could not check (${page.message})`);
      else {
        const bad = stale.filter((x) => x.source === s).length;
        out.push(`  ${bad ? "STALE " : "ok    "} ${s} — ${n - bad}/${n} rules still stated`);
      }
    }
    for (const s of stale) {
      out.push("", `STALE  ${s.id}  (${s.source})`);
      for (const p of s.problems) out.push(`       ${p}`);
      out.push(`       evidence: ${s.evidence}`);
    }
    for (const [id, keys] of Object.entries(newKeys)) {
      out.push("", `new    ${id}: the docs list ${keys.join(", ")} — not in core/claude-code.js (informational)`);
    }
    if (unchecked.length) {
      out.push("", `${unchecked.length} rule(s) could not be checked — this is not a pass.`);
    }
    if (code === 1) out.push("", "A stale rule means the docs moved: update core/claude-code.js, then whatever consumes the rule.");
    process.stdout.write(`${out.join("\n")}\n`);
  }
  process.exit(check ? code : 0);
}

await main();
