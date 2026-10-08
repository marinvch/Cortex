#!/usr/bin/env node
// cortex-skill-links.mjs — every link a ritual makes to a file or a heading resolves.
//
//   node tools/cortex-skill-links.mjs                # the dead links, or that there are none
//   node tools/cortex-skill-links.mjs --check        # exit 1 if any link is dead
//   node tools/cortex-skill-links.mjs --json         # for a tool to read
//   node tools/cortex-skill-links.mjs <repo root>    # another checkout (the tests' fixtures)
//
// A ritual's body is kept short by moving detail into a supporting file beside it (`RUNS.md`,
// `TEAM.md`) and linking to the section. That link is the only way the detail is reached: a model
// that follows `RUNS.md#running-unattended` to a heading someone renamed finds nothing, reads on
// without it, and nothing fails. Splitting `skills/cortex/SKILL.md` made twelve such links in one
// change. The same failure, for `docs/changing-cortex.md`, already broke eight ADR links once
// (tools/test/changing-cortex.test.sh).
//
// What is checked: every markdown link in every `.md` under `skills/` whose target is a path. The
// path resolves FROM THE LINKING FILE'S DIRECTORY and must exist. A `#heading` on a markdown target,
// or alone for the same file, must be a heading of that file, by the slug GitHub gives it.
//
// What is not: a link inside a code fence or a code span, which is an example of what a ritual
// writes into someone else's repo; a URL; and a target holding a placeholder (`<`, `{`, `$`).

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function walk(dir, out = []) {
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.toLowerCase().endsWith(".md")) out.push(p);
  }
  return out;
}

/** The file's lines with fenced blocks blanked, so line numbers still hold. */
function unfenced(text) {
  let fence = null;
  return text.split(/\r?\n/).map((line) => {
    const m = /^\s*(`{3,}|~{3,})/.exec(line);
    if (fence) {
      if (m && m[1][0] === fence[0] && m[1].length >= fence.length) fence = null;
      return "";
    }
    if (m) {
      fence = m[1];
      return "";
    }
    return line;
  });
}

/** `unfenced`, with code spans blanked too. For finding links: a heading keeps its spans, since they are in its slug. */
const prose = (text) => unfenced(text).map((line) => line.replace(/(`+)[^`]*?\1/g, (s) => " ".repeat(s.length)));

/** GitHub's heading slug: lower case, punctuation dropped, spaces to hyphens. */
export function slug(heading) {
  return heading
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[`*_~]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s/g, "-");
}

/** Every anchor a markdown file offers: its headings, a repeat numbered -1, -2, and explicit ids. */
export function anchorsOf(text) {
  const seen = new Map();
  const out = new Set();
  for (const line of unfenced(text)) {
    const h = /^ {0,3}#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
    if (h) {
      const s = slug(h[1]);
      const n = seen.get(s) ?? 0;
      seen.set(s, n + 1);
      out.add(n ? `${s}-${n}` : s);
    }
    for (const m of line.matchAll(/<a\s+(?:id|name)="([^"]+)"/g)) out.add(m[1]);
  }
  return out;
}

/**
 * `{ dead: [{ file, line, target, why }], checked }` for the links under `<root>/skills`, in file and
 * line order. `checked` is how many links were followed: a check that looked at none passes for the
 * wrong reason, so the caller treats 0 as a failure.
 */
export function checkLinks(root) {
  const dead = [];
  let checked = 0;
  const anchors = new Map();
  const anchorsFor = (p) => {
    if (!anchors.has(p)) anchors.set(p, anchorsOf(readFileSync(p, "utf8")));
    return anchors.get(p);
  };
  for (const file of walk(join(root, "skills"))) {
    const text = readFileSync(file, "utf8");
    // Joined, so a link whose text wraps across lines is still one link. Offsets map back to lines.
    const lines = prose(text);
    const body = lines.join("\n");
    for (const m of body.matchAll(/\]\(\s*([^)\s]+)(?:\s+"[^"]*")?\s*\)/g)) {
      const target = m[1];
      if (/^[a-z][a-z0-9+.-]*:/i.test(target) || /[<{$]/.test(target)) continue;
      checked++;
      const line = body.slice(0, m.index).split("\n").length;
      const rel = relative(root, file).replace(/\\/g, "/");
      const hash = target.indexOf("#");
      const path = hash === -1 ? target : target.slice(0, hash);
      const anchor = hash === -1 ? "" : decodeURIComponent(target.slice(hash + 1));
      const abs = path ? resolve(dirname(file), decodeURIComponent(path)) : file;
      if (!existsSync(abs)) {
        dead.push({ file: rel, line, target, why: `no file at ${relative(root, abs).replace(/\\/g, "/")}` });
        continue;
      }
      if (!anchor || !abs.toLowerCase().endsWith(".md") || statSync(abs).isDirectory()) continue;
      if (!anchorsFor(abs).has(anchor)) {
        dead.push({ file: rel, line, target, why: `no heading "#${anchor}" in ${relative(root, abs).replace(/\\/g, "/")}` });
      }
    }
  }
  return { dead, checked };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const root = args.find((a) => !a.startsWith("--")) ?? REPO_ROOT;
  const { dead, checked } = checkLinks(root);
  if (args.includes("--json")) {
    console.log(JSON.stringify({ checked, dead }, null, 2));
  } else if (!checked) {
    console.log("no link was found under skills/ — the check read nothing, which is not a pass.");
  } else if (dead.length) {
    for (const d of dead) console.log(`${d.file}:${d.line}  ${d.target}  — ${d.why}`);
    console.log(`\n${dead.length} of ${checked} links from a ritual lead nowhere.`);
  } else {
    console.log(`all ${checked} links from a ritual to a file or a heading resolve.`);
  }
  if (args.includes("--check") && (dead.length || !checked)) process.exit(1);
}
