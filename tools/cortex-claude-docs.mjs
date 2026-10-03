#!/usr/bin/env node
// cortex-claude-docs.mjs — are the Claude Code rules Cortex ships still what Anthropic's docs say?
//
//   node tools/cortex-claude-docs.mjs                 # report, exit 0
//   node tools/cortex-claude-docs.mjs --check         # exit 1 if a rule went stale, 2 if a page could not be read,
//                                                     #      3 if the docs or the blog have a page not seen before
//   node tools/cortex-claude-docs.mjs --json
//   node tools/cortex-claude-docs.mjs --accept        # record every page now published as seen
//   node tools/cortex-claude-docs.mjs --pages <dir>   # read <dir>/<page>.md, llms.txt and blog.html instead of the network
//   node tools/cortex-claude-docs.mjs --seen <file>   # the seen-list to read and write (default: beside this file)
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
// That half only watches pages a rule already cites, so a feature documented on a page of its own
// goes unnoticed however long the check runs. The second half reads the two indexes Anthropic
// publishes — the docs' llms.txt and the blog's front page — and reports every page that is not in
// claude-docs-seen.json. It judges nothing: a new page is something for a maintainer to read, and
// --accept is how they say they have. An index that read but listed no pages counts as unread.
//
// Maintainer-only. Users never run this; they get the rules with the plugin. ADR 0017.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { CHECKED, RULES } from "../core/claude-code.js";

const DOCS_INDEX = "https://code.claude.com/docs/llms.txt";
const DOCS_ROOT = "https://code.claude.com/docs/en/";
const BLOG_INDEX = "https://claude.com/blog";

const args = process.argv.slice(2);
const asJson = args.includes("--json");
const check = args.includes("--check");
const accept = args.includes("--accept");
const pagesAt = args.includes("--pages") ? args[args.indexOf("--pages") + 1] : null;
const seenAt = args.includes("--seen")
  ? args[args.indexOf("--seen") + 1]
  : fileURLToPath(new URL("./claude-docs-seen.json", import.meta.url));

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

/** The docs index → Map of page path (under /docs/en/, no extension) → title. */
function docPages(md) {
  const found = new Map();
  const link = /\[([^\]]+)\]\(https:\/\/code\.claude\.com\/docs\/en\/([^)\s]+?)\.md\)/g;
  for (const m of md.matchAll(link)) found.set(m[2], m[1]);
  return found;
}

/** The blog's front page → the post slugs it links. A category or tag link has a second segment. */
function blogPosts(html) {
  const found = new Set();
  for (const m of html.matchAll(/href="(?:https:\/\/claude\.com)?\/blog\/([a-z0-9][a-z0-9-]*)"/g)) found.add(m[1]);
  return found;
}

/**
 * What the two indexes list that the seen-list does not. The blog's front page shows only recent
 * posts, so a slug missing from it has scrolled off, not gone — only the docs can report `gone`.
 */
function discover(seen, docsIndex, blogIndex) {
  const out = { newDocs: [], goneDocs: [], newPosts: [], unread: [], docs: null, posts: null };
  if (typeof docsIndex !== "string") out.unread.push({ source: DOCS_INDEX, reason: docsIndex.message });
  else {
    const live = docPages(docsIndex);
    if (!live.size) out.unread.push({ source: DOCS_INDEX, reason: "no pages found in the index" });
    else {
      out.docs = [...live.keys()].sort();
      out.newDocs = out.docs.filter((p) => !seen.docs.includes(p)).map((p) => ({ path: p, title: live.get(p) }));
      out.goneDocs = seen.docs.filter((p) => !live.has(p));
    }
  }
  if (typeof blogIndex !== "string") out.unread.push({ source: BLOG_INDEX, reason: blogIndex.message });
  else {
    const live = blogPosts(blogIndex);
    if (!live.size) out.unread.push({ source: BLOG_INDEX, reason: "no posts found on the page" });
    else {
      out.posts = [...new Set([...seen.blog, ...live])].sort();
      out.newPosts = [...live].filter((p) => !seen.blog.includes(p)).sort();
    }
  }
  return out;
}

function readSeen() {
  try {
    const seen = JSON.parse(readFileSync(seenAt, "utf8"));
    return { docs: seen.docs ?? [], blog: seen.blog ?? [] };
  } catch {
    return { docs: [], blog: [] };
  }
}

/** Fetch `url`, or with --pages read `<dir>/<fixture>` in its place. Returns the text or an Error. */
async function readText(url, fixture) {
  if (pagesAt) {
    const file = join(pagesAt, fixture);
    try {
      return readFileSync(file, "utf8");
    } catch {
      return new Error(`no fixture at ${file}`);
    }
  }
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) return new Error(`HTTP ${res.status}`);
    return await res.text();
  } catch (e) {
    return new Error(e?.cause?.code ?? e?.name ?? String(e));
  }
}

const readPage = (source) => readText(`${source}.md`, `${source.split("/").pop()}.md`);

async function main() {
  const sources = [...new Set(RULES.map((r) => r.source))];
  const pages = new Map();
  const [docsIndex, blogIndex] = await Promise.all([
    readText(DOCS_INDEX, "llms.txt"),
    readText(BLOG_INDEX, "blog.html"),
    ...sources.map(async (s) => pages.set(s, await readPage(s))),
  ]);
  const { stale, unchecked, newKeys } = judge(RULES, pages);
  const found = discover(readSeen(), docsIndex, blogIndex);
  const fresh = found.newDocs.length + found.newPosts.length;

  if (accept) {
    if (found.unread.length) {
      for (const u of found.unread) process.stderr.write(`could not read ${u.source} (${u.reason})\n`);
      process.stderr.write("Nothing recorded: accepting a list that was not read would hide whatever is on it.\n");
      process.exit(2);
    }
    const seen = { checked: new Date().toISOString().slice(0, 10), docs: found.docs, blog: found.posts };
    writeFileSync(seenAt, `${JSON.stringify(seen, null, 2)}\n`);
    process.stdout.write(`Recorded ${found.docs.length} docs pages and ${found.posts.length} blog posts as seen (${fresh} new).\n`);
    return;
  }

  const code = stale.length ? 1 : unchecked.length || found.unread.length ? 2 : fresh ? 3 : 0;

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
      discovered: {
        newDocs: found.newDocs,
        goneDocs: found.goneDocs,
        newPosts: found.newPosts,
        unread: found.unread,
      },
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
    if (fresh || found.goneDocs.length || found.unread.length) out.push("");
    for (const d of found.newDocs) out.push(`new    docs page: ${DOCS_ROOT}${d.path} — ${d.title}`);
    for (const p of found.newPosts) out.push(`new    blog post: ${BLOG_INDEX}/${p}`);
    for (const p of found.goneDocs) out.push(`gone   docs page: ${DOCS_ROOT}${p} (informational)`);
    for (const u of found.unread) out.push(`  ?      ${u.source} — could not check (${u.reason})`);
    if (found.unread.length) out.push("", "An index could not be read, so new pages went unlooked for — this is not a pass.");
    if (fresh) {
      out.push("", `${fresh} page(s) Cortex has not seen. Read them, decide what Cortex owes each one, then record`);
      out.push("them with: node tools/cortex-claude-docs.mjs --accept");
    }
    process.stdout.write(`${out.join("\n")}\n`);
  }
  process.exit(check ? code : 0);
}

await main();
