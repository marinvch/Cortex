#!/usr/bin/env node
// cortex-placeholders.mjs — did a file Cortex stamped keep a placeholder from its template?
//
//   node tools/cortex-placeholders.mjs AGENTS.md CLAUDE.md REVIEW.md ...   # the files just written
//   node tools/cortex-placeholders.mjs --json <files>
//
// Exit 1 when any file still holds an unfilled placeholder, 0 otherwise. Writes nothing.
//
// The scaffold's check used to be "grep for `{{` and fix what you find", and on a real install it
// had three hits that were all correct files: `docs/adr/TEMPLATE.md` and `intent/TEMPLATE.md` are
// templates the repo keeps ON PURPOSE, and a workflow's `${{ github.ref }}` is GitHub Actions
// syntax. A check that is wrong three times on every run is one an agent learns to skip, and then it
// misses the fourth hit, the real one.
//
// So this looks for nothing generic. A hit is a string that is LITERALLY a placeholder in the
// template the file was stamped from — `{{NIT_CAP}}` in REVIEW.md, the prose placeholder about the
// project's purpose in AGENTS.md. A Vue repo's `{{ msg }}` cannot match, because no Cortex template
// contains it; `${{ … }}` cannot match, because the template's own dollar-sign expressions are not
// collected as placeholders. A file named TEMPLATE.md is a template by design and is reported as
// kept, not scanned. The cost of that design is the other direction — a placeholder the writer half
// edited slips through — which is a miss, and a miss does not teach anyone to ignore the check.
//
// The templates hold up their half. A placeholder in a prose template (the root brief, the glossary)
// is a PHRASE — `{{test command}}`, `{{an area}}` — never a bare identifier: `{{test}}` is a valid
// Handlebars, Vue and Jinja expression, so a brief that quotes one would have matched. A phrase with
// spaces is not an expression in any of them. `index/test/stamping.test.mjs` holds the templates to it.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
// What a placeholder IS lives in one place, shared with the renderer that fills templates when a
// stamped file is updated (`index/lib/stamps.mjs`) — so this check and that renderer cannot disagree.
import { placeholdersOf } from "../index/lib/placeholders.mjs";

const TEMPLATES = fileURLToPath(new URL("../templates/", import.meta.url));

// Where each stamped file comes from, by the path it lands at. `/cortex` step 7 and
// `/cortex-scaffold` step 3 are the tables this mirrors; a file not listed here was not stamped from
// a template (a scoped brief, a skill, GEMINI.md) and has no placeholders to leave behind.
const SOURCES = [
  { match: (p) => basename(p) === "TEMPLATE.md", template: null, kept: true },
  { match: (p) => /^AGENTS(\.generated)?\.md$/.test(basename(p)), template: "target-AGENTS.md" },
  { match: (p) => basename(p) === "CONTEXT.md", template: "CONTEXT.md" },
  { match: (p) => basename(p) === "CLAUDE.md", template: "loop/verification.md" },
  { match: (p) => /^REVIEW(\.generated)?\.md$/.test(basename(p)), template: "loop/REVIEW.md" },
  { match: (p) => /(^|\/)\.claude\/agents\/verifier\.md$/.test(p), template: "loop/verifier.md" },
  { match: (p) => /(^|\/)\.claude\/hooks\/format-changed\.sh$/.test(p), template: "loop/format-changed.sh" },
  { match: (p) => /(^|\/)\.claude\/hooks\/protected-paths\.sh$/.test(p), template: "loop/protected-paths.sh" },
  { match: (p) => /(^|\/)intent\/README\.md$/.test(p), template: "loop/intent-README.md" },
  { match: (p) => basename(p) === "agent-evals.yml", template: "loop/agent-evals.yml" },
  { match: (p) => basename(p) === "bands.yaml", template: "loop/bands.yaml" },
  // An ADR is stamped from adr.md; the template itself is caught by the TEMPLATE.md row above.
  { match: (p) => /(^|\/)adr\/\d{4}-[^/]+\.md$/.test(p), template: "adr.md" },
];

// A multi-line placeholder may be reflowed by the writer or a formatter, so whitespace runs match
// any whitespace run. Everything else is literal.
const toPattern = (token) =>
  new RegExp(token.trim().split(/\s+/).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+"), "g");

const templateCache = new Map();
function tokensFor(template) {
  if (!templateCache.has(template)) {
    const text = readFileSync(join(TEMPLATES, template), "utf8");
    templateCache.set(template, placeholdersOf(text).map((t) => ({ token: t, re: toPattern(t) })));
  }
  return templateCache.get(template);
}

/** Check one written file. `rel` is its repo-relative path with forward slashes. */
function checkFile(abs, rel) {
  const source = SOURCES.find((s) => s.match(rel));
  if (!source) return { path: rel, status: "untemplated", hits: [] };
  if (source.kept) return { path: rel, status: "kept", hits: [] };
  const text = readFileSync(abs, "utf8");
  const hits = [];
  for (const { token, re } of tokensFor(source.template)) {
    for (const m of text.matchAll(re)) {
      // `$` directly before the braces is an Actions expression that happens to share a name.
      if (m.index > 0 && text[m.index - 1] === "$") continue;
      hits.push({ line: text.slice(0, m.index).split("\n").length, token: token.replace(/\s+/g, " ") });
    }
  }
  hits.sort((a, b) => a.line - b.line);
  return { path: rel, template: source.template, status: hits.length ? "unfilled" : "ok", hits };
}

function expand(arg, cwd) {
  const abs = resolve(cwd, arg);
  if (!existsSync(abs)) return [{ abs, missing: true }];
  if (!statSync(abs).isDirectory()) return [{ abs }];
  const out = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name === ".git" || e.name === "node_modules") continue;
      const child = join(dir, e.name);
      if (e.isDirectory()) walk(child);
      else out.push({ abs: child });
    }
  };
  walk(abs);
  return out;
}

function main(argv) {
  const asJson = argv.includes("--json");
  const args = argv.filter((a) => !a.startsWith("--"));
  if (!args.length) {
    console.error("usage: node tools/cortex-placeholders.mjs [--json] <file|dir>...   (the files you just wrote)");
    return 2;
  }
  const cwd = process.cwd();
  const results = [];
  for (const arg of args) {
    for (const f of expand(arg, cwd)) {
      const rel = relative(cwd, f.abs).split("\\").join("/");
      results.push(f.missing ? { path: rel, status: "missing", hits: [] } : checkFile(f.abs, rel));
    }
  }
  const failed = results.some((r) => r.status === "unfilled" || r.status === "missing");

  if (asJson) {
    console.log(JSON.stringify({ ok: !failed, files: results }, null, 2));
    return failed ? 1 : 0;
  }
  const NOTE = {
    ok: "",
    kept: " — a template by design; its placeholders stay",
    untemplated: " — not stamped from a template, nothing to check",
    missing: " — does not exist; it was never written",
  };
  for (const r of results) {
    if (r.status === "unfilled") {
      for (const h of r.hits) console.log(`  unfilled     ${r.path}:${h.line}  ${h.token.length > 70 ? h.token.slice(0, 67) + "...}}" : h.token}`);
    } else {
      console.log(`  ${r.status.padEnd(11)}  ${r.path}${NOTE[r.status]}`);
    }
  }
  if (failed) console.log("\nFill each unfilled placeholder from the index or the user — or delete the line. Never guess a command.");
  return failed ? 1 : 0;
}

process.exit(main(process.argv.slice(2)));
