#!/usr/bin/env node
// cortex-frontmatter.mjs — is every ritual's frontmatter something a router can actually read?
//
//   node tools/cortex-frontmatter.mjs            # report every skill, exit 1 on any violation
//   node tools/cortex-frontmatter.mjs --check    # print only violations; same exit code
//   node tools/cortex-frontmatter.mjs --check <skills-dir>   # validate another tree (the tests do)
//
// The failure this exists for has no error state. A `description:` written as a YAML block scalar
// (`|`, `>-`) parses to the one or two characters of the indicator, so the router sees an empty
// description and the skill is never suggested — it still runs when typed by name, which is exactly
// why nobody notices. A peer harness had fifteen skills in that state behind a validator that
// demoted every frontmatter finding to a warning "until the backlog was cleaned up". It never was.
// So this one is strict from the first commit, with no warn mode to leave switched on.
//
// It is also the ONE frontmatter reader in tools/. cortex-capability.mjs imports parseFrontmatter
// from here, and core/test/plugin.test.js runs this file rather than carrying its own regex — it
// cannot import it, because core/ (tests included) may not reach outside core/, and this is not
// kernel code. index/lib/claude-setup.mjs reads a USER's skill frontmatter with a tolerant reader of
// real YAML — a different job from this strict one over Cortex's own skills.
//
// The grammar is a deliberate subset of YAML, not a YAML parser (ADR 0004 — no dependencies):
// flat `key: value` lines, each value on ONE line, plain or quoted. That subset is not a limitation
// of this file so much as a promise the rest of the repo already relies on — the capability table,
// the skill graph and several shell tests read these keys one line at a time, and a continuation
// line would be invisible to every one of them.

import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { triggerPhrasing } from "../core/claude-code.js";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const KEY_RE = /^([A-Za-z0-9_-]+):(?:[ \t]+(.*?))?[ \t]*$/;
const BLOCK_SCALAR_RE = /^[|>][0-9]?[+-]?[0-9]?$/;
// A plain scalar may not START with these; YAML reads each as structure, not text.
const INDICATORS = new Set(["@", "`", "[", "{", "*", "&", "!", "%", "|", ">"]);
const MIN_DESCRIPTION = 40;

/**
 * Unquote one scalar. Returns { value } or { error } — never throws.
 * Double-quoted uses JSON escapes (a strict subset of YAML's); single-quoted doubles its quote.
 */
function scalar(raw) {
  if (raw.startsWith('"')) {
    if (raw.length < 2 || !raw.endsWith('"')) return { error: "opens a double quote it never closes" };
    try {
      return { value: JSON.parse(raw), quoted: true };
    } catch {
      return { error: "is not a valid double-quoted string (unescaped \" or a bad \\ escape)" };
    }
  }
  if (raw.startsWith("'")) {
    if (raw.length < 2 || !raw.endsWith("'")) return { error: "opens a single quote it never closes" };
    const inner = raw.slice(1, -1);
    if (/'(?!')/.test(inner.replace(/''/g, ""))) return { error: "has a lone ' inside single quotes (write it as '')" };
    return { value: inner.replace(/''/g, "'"), quoted: true };
  }
  return { value: raw, quoted: false };
}

/**
 * Parse a SKILL.md's frontmatter. Never throws: a caller that only wants a key (the capability
 * table) reads `data`; a caller that must judge the file (the check below) reads `errors`.
 *
 * @returns {{ found: boolean, data: Record<string,string>, errors: {line:number,msg:string}[] }}
 */
export function parseFrontmatter(src) {
  const lines = src.split(/\r?\n/);
  const data = {};
  const errors = [];
  if (lines[0] !== "---") return { found: false, data, errors: [{ line: 1, msg: "no frontmatter — the file must open with a --- line" }] };
  const end = lines.indexOf("---", 1);
  if (end === -1) return { found: false, data, errors: [{ line: 1, msg: "frontmatter is never closed with a --- line" }] };

  for (let i = 1; i < end; i++) {
    const line = lines[i];
    const n = i + 1;
    if (/^\s*(#|$)/.test(line)) continue;
    if (/^\s/.test(line)) {
      errors.push({ line: n, msg: "indented line — frontmatter here is flat, one key per line, each value on one line" });
      continue;
    }
    const m = line.match(KEY_RE);
    if (!m) {
      errors.push({ line: n, msg: "not a `key: value` line, so the frontmatter does not parse as a mapping" });
      continue;
    }
    const [, key, raw = ""] = m;
    if (key in data) errors.push({ line: n, msg: `duplicate key '${key}' — YAML keeps one and drops the other silently` });

    if (BLOCK_SCALAR_RE.test(raw)) {
      errors.push({ line: n, msg: `'${key}' is a block scalar (${raw}) — it parses to the indicator, not the text below it` });
      data[key] = "";
      continue;
    }
    const s = scalar(raw);
    if (s.error) {
      errors.push({ line: n, msg: `'${key}' ${s.error}` });
      data[key] = raw;
      continue;
    }
    if (!s.quoted && raw) {
      if (INDICATORS.has(raw[0])) {
        errors.push({ line: n, msg: `'${key}' starts with the YAML indicator ${raw[0]} — quote the value` });
      }
      if (raw.includes(": ") || raw.endsWith(":")) {
        errors.push({ line: n, msg: `'${key}' is unquoted and contains ": " — a YAML parser reads a second mapping and rejects the file; reword or quote it` });
      }
      if (raw.includes(" #")) {
        errors.push({ line: n, msg: `'${key}' is unquoted and contains " #" — YAML drops everything after it as a comment; quote the value` });
      }
    }
    data[key] = s.value;
  }
  return { found: true, data, errors };
}

// The trigger-phrasing heuristic lives in core/claude-code.js beside the rule it serves, because
// index/lib/claude-setup.mjs applies the same test to a user's skills. Re-exported for callers here.
export { triggerPhrasing };

/** Every rule a skill's frontmatter must meet. `dirName` is the directory the SKILL.md sits in. */
export function validateSkill(src, dirName) {
  const { found, data, errors } = parseFrontmatter(src);
  const out = [...errors];
  if (!found) return out;
  for (const key of ["name", "description"]) {
    if (!(key in data)) out.push({ line: 1, msg: `no '${key}:' key` });
    else if (!data[key].trim()) out.push({ line: 1, msg: `'${key}' is empty` });
  }
  if (data.name?.trim() && data.name.trim() !== dirName) {
    out.push({ line: 1, msg: `declares name '${data.name.trim()}' — must match its directory '${dirName}'` });
  }
  const desc = data.description?.trim() ?? "";
  if (desc && desc.length < MIN_DESCRIPTION) {
    out.push({ line: 1, msg: `description is ${desc.length} characters — too short to trigger on (min ${MIN_DESCRIPTION})` });
  }
  // A skill only a human can fire has no router to feed, so its description is a one-line summary
  // for the person reading the / menu (SKILL-MECHANICS.md). Trigger lists there are dead weight that
  // reads as if the model could reach it; four skills carried them for months.
  if (data["disable-model-invocation"]?.trim() === "true" && triggerPhrasing(desc)) {
    out.push({ line: 1, msg: `disable-model-invocation skill carries trigger phrasing ("${triggerPhrasing(desc)}") — a user-invoked description is a one-line summary, trigger lists stripped` });
  }
  return out;
}

/** Validate every skills/<name>/SKILL.md under `dir`. */
export function checkSkills(dir) {
  const results = [];
  for (const name of readdirSync(dir).sort()) {
    const d = join(dir, name);
    try {
      if (!statSync(d).isDirectory()) continue;
    } catch {
      continue;
    }
    const file = join(d, "SKILL.md");
    if (!existsSync(file)) {
      results.push({ name, problems: [{ line: 0, msg: "no SKILL.md" }] });
      continue;
    }
    results.push({ name, problems: validateSkill(readFileSync(file, "utf8"), name) });
  }
  return results;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const quiet = args.includes("--check");
  const dir = resolve(args.find((a) => !a.startsWith("--")) ?? join(REPO_ROOT, "skills"));
  if (!existsSync(dir)) {
    console.error(`no such directory: ${dir}`);
    process.exit(2);
  }
  const results = checkSkills(dir);
  const bad = results.filter((r) => r.problems.length);
  for (const r of results) {
    if (!r.problems.length) {
      if (!quiet) console.log(`  ok    ${r.name}`);
      continue;
    }
    for (const p of r.problems) console.log(`  FAIL  ${r.name}/SKILL.md:${p.line}: ${p.msg}`);
  }
  const verdict = `${results.length} skills, ${bad.length} with frontmatter a router cannot trust`;
  if (bad.length) {
    console.error(verdict);
    process.exit(1);
  }
  console.log(verdict);
}
