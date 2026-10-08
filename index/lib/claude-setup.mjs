// index/lib/claude-setup.mjs — does this repo's Claude setup follow Anthropic's own docs?
//
// Grades what a repo gives Claude Code — CLAUDE.md and what it imports, skills, subagents, hooks,
// and any direct Messages API calls — against the rules in core/claude-code.js, each of which
// carries the sentence on the official page that states it. Every finding names its rule id and
// source URL, so a reader can check the claim rather than trust it.
//
// These are FINDINGS, never failures (spec D3): a user's repo is theirs, and Cortex reports what
// the docs say and where the repo departs from it. Severity is `medium` for a breach of a stated
// rule and `low` for a Cortex heuristic (emphasis count, a small max_tokens, reasoning phrasing),
// and the detail says which it is. Nothing here writes anything.
//
// Table-driven on purpose: one CHECKS row per finding kind, so a new rule is a row, not a branch.
// Each row returns evidence lines; a row with none produces no finding, and one finding per kind
// lists every file it applies to — forty-four skills with the same unknown key are one fact.

import { existsSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, posix } from "node:path";
import { rule, limit, triggerPhrasing } from "../../core/claude-code.js";
import { textSource } from "./repo-text.mjs";

const PREFIX = "claude-setup/";
const MAX_EVIDENCE = 25;

/** Cortex's own thresholds — judgement calls, not documented numbers, and every finding says so. */
export const EMPHASIS_LINES = 3;
export const MIN_MAX_TOKENS = 4096;

export const EDIT_TOOLS = ["Edit", "Write", "MultiEdit", "NotebookEdit"];
const SCRIPT_EXT = /\.(?:sh|bash|mjs|cjs|js|ts|py|ps1|rb)$/;

// ---------------------------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------------------------

const unquote = (v) => {
  const t = v.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) return t.slice(1, -1);
  return t;
};

/**
 * A tolerant reader for the YAML frontmatter real repos write: top-level keys, one-line scalars,
 * block scalars (`|`, `>`), lists (`- x`) and nested maps. It reads what a check needs — the keys
 * present and the scalar/list values — and is not a YAML parser. A BOM and CRLF line endings are
 * normalised first, since both are ordinary in a repo edited on Windows.
 *
 * Returns { state: "none" } when the file opens without `---`, { state: "broken", reason } when it
 * opens one and never closes it, else { state: "ok", keys, data, loose, body }.
 *
 * `loose` marks a block with an unindented line that is not a key, or a key given twice — prose
 * pasted into a description without indenting it, as some published plugins do. A strict YAML
 * parser rejects that; what Claude Code makes of it is not documented. So the key checks skip a
 * loose block rather than report its prose lines ("Context", "user") as unknown keys.
 */
export function readFrontmatter(src) {
  const text = src.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const lines = text.split("\n");
  if (lines[0].trim() !== "---") return { state: "none", keys: [], data: {}, body: text };
  const end = lines.findIndex((l, i) => i > 0 && /^(---|\.\.\.)\s*$/.test(l));
  if (end < 0) return { state: "broken", reason: "opens with --- and never closes it" };

  const keys = [];
  const data = {};
  let loose = false;
  for (let i = 1; i < end; i++) {
    const m = lines[i].match(/^([A-Za-z_][\w-]*)\s*:(.*)$/);
    if (!m) {
      if (lines[i].trim() && !/^\s*#/.test(lines[i])) loose = true;
      continue;
    }
    const key = m[1];
    if (keys.includes(key)) loose = true;
    const raw = m[2].trim();
    keys.push(key);
    // Collect the indented continuation, whatever it is.
    const cont = [];
    while (i + 1 < end && (/^\s+\S/.test(lines[i + 1]) || lines[i + 1].trim() === "")) cont.push(lines[++i]);
    const block = cont.map((l) => l.trim()).filter(Boolean);
    if (/^[|>][+-]?\d*$/.test(raw)) {
      data[key] = block.join(raw.startsWith(">") ? " " : "\n");
    } else if (raw === "" && block.length && block.every((l) => l.startsWith("- "))) {
      data[key] = block.map((l) => unquote(l.slice(2)));
    } else if (block.length && !raw.endsWith("]") && /^\[[\s\S]*\]$/.test([raw, ...block].join(" ").trim())) {
      // A flow list broken over lines, the way a formatter writes a long `tools: [...]`. One real
      // repo's `tools:` read as a nested map, so its agent looked as if it granted no tool at all.
      data[key] = [raw, ...block].join(" ").trim().slice(1, -1).split(",").map(unquote).filter(Boolean);
    } else if (raw === "") {
      data[key] = block.length ? { nested: true } : "";
    } else if (raw.startsWith("[") && raw.endsWith("]")) {
      data[key] = raw.slice(1, -1).split(",").map(unquote).filter(Boolean);
    } else {
      data[key] = unquote([raw, ...block].join(" "));
    }
  }
  return { state: "ok", keys, data, loose, body: lines.slice(end + 1).join("\n") };
}

/** A tools field — "Read, Grep", a YAML list, or absent — as a list of tool names. */
export function toolList(v) {
  if (v === undefined) return null;
  const items = Array.isArray(v) ? v : typeof v === "string" ? v.split(/[,\s]+/) : [];
  return items.map((t) => t.replace(/\(.*$/, "").trim()).filter(Boolean);
}

/** Markdown with fenced blocks and inline code removed, line count preserved. */
function prose(md) {
  let fenced = false;
  return md
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => {
      if (/^\s*(```|~~~)/.test(l)) {
        fenced = !fenced;
        return "";
      }
      return fenced ? "" : l.replace(/`[^`]*`/g, "");
    });
}

const lineCount = (s) => {
  const t = s.replace(/\r\n?/g, "\n").replace(/\n$/, "");
  return t === "" ? 0 : t.split("\n").length;
};

/** Split a hook command into shell words: quotes removed, `"$X"/rest` kept as one word. */
function shellWords(cmd) {
  const out = [];
  const re = /\s*((?:"[^"]*"|'[^']*'|[^\s"']+)+)/g;
  let m;
  while ((m = re.exec(cmd))) out.push(m[1].replace(/"([^"]*)"|'([^']*)'/g, "$1$2"));
  return out;
}

// ---------------------------------------------------------------------------------------------
// What the repo has
// ---------------------------------------------------------------------------------------------

function defaultModeOf(root) {
  return (rel) => {
    try {
      const out = execFileSync("git", ["ls-files", "-s", "--", rel], {
        cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
      }).trim();
      if (out) return out.split(/\s+/)[0];
    } catch { /* not a git repo — fall through */ }
    // Untracked: the filesystem only knows the bit on a system that has one.
    if (process.platform === "win32") return null;
    try {
      return statSync(join(root, rel)).mode & 0o111 ? "100755" : "100644";
    } catch {
      return null;
    }
  };
}

function gather(index, root, opts) {
  const paths = (index?.files ?? []).map((f) => f.path).sort();
  const known = new Set(paths);
  const text = opts.read ? null : textSource(root, { index });
  const read = opts.read ?? ((p) => text.read(p));
  const exists = opts.exists ?? ((p) => known.has(p) || (root ? existsSync(join(root, p)) : false));
  const modeOf = opts.modeOf ?? (root ? defaultModeOf(root) : () => null);
  const byPath = new Map((index?.files ?? []).map((f) => [f.path, f]));

  // Plugin roots: every directory holding a `.claude-plugin/` manifest — the repo root for a single
  // plugin, `plugins/<name>/` in a marketplace repo, which is where most public plugins live.
  const pluginRoots = [
    ...new Set(
      paths
        .filter((p) => /(^|\/)\.claude-plugin\/(plugin|marketplace)\.json$/.test(p))
        .map((p) => posix.dirname(posix.dirname(p))),
    ),
  ];
  /** The plugin root a path ships in (`.` for the repo root), or null when it is not plugin content. */
  const pluginRootOf = (p, shape) => {
    for (const pr of pluginRoots) {
      const rel = pr === "." ? p : p.startsWith(`${pr}/`) ? p.slice(pr.length + 1) : null;
      if (rel !== null && shape.test(rel)) return pr;
    }
    return null;
  };
  const PLUGIN_SKILL = /^skills\/[^/]+\/SKILL\.md$/;
  // Agent directories are scanned recursively, a plugin's included: "Claude Code scans
  // `.claude/agents/` and `~/.claude/agents/` recursively" and "Plugin `agents/` directories are also
  // scanned recursively" (code.claude.com/docs/en/sub-agents). A subfolder only organises them.
  const PLUGIN_AGENT = /^agents\/.+\.md$/;
  const PLUGIN_HOOKS = /^hooks\/hooks\.json$/;

  const claudeMd = paths.filter((p) => /(^|\/)CLAUDE(\.local)?\.md$/.test(p));
  const skills = paths.filter(
    (p) => /(^|\/)\.claude\/skills\/[^/]+\/SKILL\.md$/.test(p) || pluginRootOf(p, PLUGIN_SKILL) !== null,
  );
  const agents = paths.filter((p) => /(^|\/)\.claude\/agents\/.+\.md$/.test(p) || pluginRootOf(p, PLUGIN_AGENT) !== null);
  const settings = paths.filter(
    (p) => /(^|\/)\.claude\/settings(\.local)?\.json$/.test(p) || pluginRootOf(p, PLUGIN_HOOKS) !== null,
  );
  const code = paths.filter((p) => {
    const f = byPath.get(p);
    return f && (f.category === "code" || f.category === "script") && !f.isTest;
  });
  const plugin = {
    skill: (p) => pluginRootOf(p, PLUGIN_SKILL),
    agent: (p) => pluginRootOf(p, PLUGIN_AGENT),
    hooks: (p) => pluginRootOf(p, PLUGIN_HOOKS),
  };
  return { paths, read, exists, modeOf, plugin, claudeMd, skills, agents, settings, code };
}

/** `${CLAUDE_PLUGIN_ROOT}/rest` inside plugin root `pr`, as a repo path. */
const inPlugin = (pr, rest) => posix.normalize(pr === "." ? rest : `${pr}/${rest}`);

/** Every file CLAUDE.md loads: each CLAUDE.md, and its @imports up to five hops, deduplicated. */
function loadedMemory(r) {
  const seen = new Map(); // path → { from }
  const missing = [];
  const visit = (p, depth, from) => {
    if (seen.has(p) || depth > 5) return;
    seen.set(p, { from });
    const src = r.read(p);
    if (typeof src !== "string") return;
    prose(src).forEach((line, i) => {
      for (const m of line.matchAll(/(?:^|\s)@([^\s)\]>,;]+)/g)) {
        const target = m[1].replace(/[.:]+$/, "");
        if (!/[/.]/.test(target) || /[{<*$]/.test(target) || target.startsWith("~") || target.startsWith("/")) continue;
        if (!/\.\w+$/.test(target) && !target.includes("/")) continue;
        const resolved = posix.normalize(posix.join(posix.dirname(p), target));
        if (resolved.startsWith("..")) continue; // outside the repo — Claude Code asks, we cannot see
        if (!r.exists(resolved)) missing.push({ at: `${p}:${i + 1}`, target });
        else visit(resolved, depth + 1, p);
      }
    });
  };
  for (const p of r.claudeMd) visit(p, 0, null);
  return { files: [...seen.keys()].sort(), missing };
}

function frontmatterOf(r, p) {
  const src = r.read(p);
  if (typeof src !== "string") return null;
  return readFrontmatter(src);
}

// ---------------------------------------------------------------------------------------------
// The checks — one row per finding kind
// ---------------------------------------------------------------------------------------------

// What the agent does: these can only describe the agent, wherever they stand.
const READ_ONLY_ACT =
  /\bchanges? nothing\b|\bmakes? no changes\b|\bdiagnoses only\b|\bnever (?:edits?|modif(?:y|ies)) anything\b|\bdoes not (?:edit|modify) (?:any|the code)/gi;
// An adjective, which can describe anything — so it counts only where the agent is described.
const READ_ONLY_ADJ = /\bread[- ]only\b|\breport[- ]only\b/gi;

// A conditional opens the sentence or a clause before the match ("If the brief is wrong, change
// nothing"), or follows it ("change nothing until it is approved").
const CONDITION_BEFORE = /(?:^|[,;]\s*|\b(?:and|then)\s+)(?:if|when|whenever|unless|otherwise|in case)\b/i;
const CONDITION_AFTER = /^\s*,?\s*(?:if|when|whenever|unless|until|otherwise)\b/i;

/** The sentence `text` is in up to `at`: back to the last sentence end, blank line or list item. */
function sentenceTo(text, at) {
  let start = 0;
  for (const m of text.slice(0, at).matchAll(/[.!?:;](?=\s)|\n\s*\n|\n\s*(?:[-*+]|\d+\.)\s/g)) start = m.index + m[0].length;
  return text.slice(start, at).replace(/\s+/g, " ").replace(/^[\s*_>#-]+/, "");
}

/** The opening statement of an agent's role: the body's first paragraph, headings skipped. */
function openingOf(body) {
  const lines = prose(body);
  const prose_ = (l) => !/^\s*$/.test(l) && !/^\s*#/.test(l);
  const from = lines.findIndex(prose_);
  if (from === -1) return "";
  const to = lines.findIndex((l, i) => i > from && !prose_(l));
  return lines.slice(from, to === -1 ? undefined : to).join("\n");
}

/**
 * Does the agent claim to be read-only? "Change nothing" and its kin describe what the agent does,
 * so they count anywhere in the body. "Read-only" and "report-only" are adjectives, and below the
 * description and the opening statement of its role they describe something else: a CSP's
 * report-only mode, read-only workflow state, operations a policy should not gate. Reading them
 * from the whole body reported 8 agents in wshobson/agents, all 8 wrong (#523). Code is stripped,
 * and two mentions never count:
 * - a negated one — "marks destructive, not read-only" is an agent that edits saying so. Found on
 *   this repo's own docs-owner, which the first version of this check reported as read-only;
 * - a conditional one — "if the brief cannot be verified, change nothing" guards one failure in an
 *   agent built to edit. Found on four editing agents in one real repo, all four reported (#523).
 */
export function claimsReadOnly(description, body = "") {
  const claims = (text, re) => {
    const plain = prose(text).join("\n");
    return [...plain.matchAll(re)].some((m) => {
      if (/\b(?:not|no|never|isn't|aren't)\s+$/i.test(plain.slice(Math.max(0, m.index - 12), m.index))) return false;
      if (CONDITION_BEFORE.test(sentenceTo(plain, m.index))) return false;
      return !CONDITION_AFTER.test(plain.slice(m.index + m[0].length));
    });
  };
  const head = `${description ?? ""}\n\n`;
  return claims(head + openingOf(body), READ_ONLY_ADJ) || claims(head + body, READ_ONLY_ACT);
}
const REASONING =
  // "your" and not "the": "explain the reasoning so the model understands" is advice to a skill
  // author, found in a published skill-creator, and asks the model to reveal nothing.
  /\b(?:write out|show|explain|include|output|print)\s+your\s+(?:full\s+|entire\s+|step[- ]by[- ]step\s+)?(?:reasoning|chain[- ]of[- ]thought|thought process)\b|\b(?:reason|think) (?:out loud|aloud)\b|\bshow your work\b/i;
const ANTHROPIC = /anthropic|\/v1\/messages|messages\.create|\bclaude-(?:opus|sonnet|haiku|fable)/i;
const EMPHASIS = /\b(?:IMPORTANT|CRITICAL|MUST|NEVER|ALWAYS)\b/;

// "At the top" has to be a number to be checked. Forty lines is a title, an introduction and the
// list itself; the number is Cortex's, and the finding says so.
const CONTENTS_WITHIN = 40;

/** Does a reference file open with a table of contents: a "Contents" heading, or three in-page links? */
function hasContents(md) {
  const head = prose(md).slice(0, CONTENTS_WITHIN);
  if (head.some((l) => /^#{1,6}\s+(?:table of )?contents\s*$/i.test(l.trim()))) return true;
  return head.join("\n").match(/\]\(#[^)\s]+\)/g)?.length >= 3;
}

const CHECKS = [
  // --- CLAUDE.md and what it loads ------------------------------------------------------------
  {
    kind: "claude-md-too-long",
    rule: "claude-md.max-lines",
    severity: "medium",
    title: (n) => `${n} memory file${n === 1 ? "" : "s"} over ${limit("claude-md.max-lines")} lines`,
    what: "Every CLAUDE.md and every file it imports loads on every turn. Past this length adherence drops — move what only one area needs into a scoped file or a skill.",
    run: (r, mem) =>
      mem.files.flatMap((p) => {
        const src = r.read(p);
        const n = typeof src === "string" ? lineCount(src) : 0;
        return n > limit("claude-md.max-lines") ? [`${p} — ${n} lines`] : [];
      }),
  },
  {
    kind: "claude-md-emphasis",
    rule: "claude-md.emphasis-one-line",
    severity: "low",
    title: (n) => `${n} memory file${n === 1 ? "" : "s"} shouting on many lines`,
    what: `Emphasis works on one line and stops working when many lines carry it. Flagged above ${EMPHASIS_LINES} lines with an uppercase IMPORTANT / CRITICAL / MUST / NEVER / ALWAYS — Cortex's threshold, not a documented number.`,
    run: (r, mem) =>
      mem.files.flatMap((p) => {
        const src = r.read(p);
        if (typeof src !== "string") return [];
        const n = prose(src).filter((l) => EMPHASIS.test(l)).length;
        return n > EMPHASIS_LINES ? [`${p} — ${n} emphasised lines`] : [];
      }),
  },
  {
    kind: "claude-md-import-missing",
    rule: "claude-md.imports",
    severity: "medium",
    title: (n) => `${n} @import${n === 1 ? "" : "s"} to a file that does not exist`,
    what: "An @path import loads the file at launch; one that names no file loads nothing and says nothing about it.",
    run: (r, mem) => mem.missing.map((m) => `${m.at} — @${m.target}`),
  },

  // --- skills ---------------------------------------------------------------------------------
  {
    kind: "skill-frontmatter-unreadable",
    rule: "skill.frontmatter.malformed",
    severity: "medium",
    title: (n) => `${n} skill${n === 1 ? "" : "s"} with frontmatter that cannot be read`,
    what: "A frontmatter block that never closes does not parse, so the skill keeps working by name while the router never sees its description.",
    run: (r) =>
      r.skills.flatMap((p) => {
        const fm = frontmatterOf(r, p);
        return fm?.state === "broken" ? [`${p} — ${fm.reason}`] : [];
      }),
  },
  {
    kind: "skill-description-too-long",
    rule: "skill.description.max-chars",
    severity: "medium",
    title: (n) => `${n} skill description${n === 1 ? "" : "s"} over ${limit("skill.description.max-chars").toLocaleString("en-US")} characters`,
    what: "The skill listing truncates description + when_to_use at this length, so whatever sits past it never reaches the router. Counted in characters, not bytes.",
    run: (r) =>
      r.skills.flatMap((p) => {
        const fm = frontmatterOf(r, p);
        if (fm?.state !== "ok") return [];
        const text = [fm.data.description, fm.data.when_to_use].filter((v) => typeof v === "string").join("");
        const n = [...text].length;
        return n > limit("skill.description.max-chars") ? [`${p} — ${n} characters`] : [];
      }),
  },
  {
    kind: "skill-body-too-long",
    rule: "skill.body.max-lines",
    severity: "medium",
    title: (n) => `${n} SKILL.md bod${n === 1 ? "y" : "ies"} over ${limit("skill.body.max-lines")} lines`,
    what: "Move detailed reference material into supporting files the skill points at.",
    run: (r) =>
      r.skills.flatMap((p) => {
        const fm = frontmatterOf(r, p);
        if (!fm || fm.state === "broken") return [];
        const n = lineCount(fm.body);
        return n > limit("skill.body.max-lines") ? [`${p} — ${n} lines`] : [];
      }),
  },
  {
    kind: "skill-unknown-key",
    rule: "skill.frontmatter.keys",
    severity: "medium",
    title: (n) => `${n} skill${n === 1 ? "" : "s"} with frontmatter keys Claude Code does not recognise`,
    what: "An unrecognised key is ignored without an error. Custom data belongs under `metadata:`.",
    run: (r) =>
      r.skills.flatMap((p) => {
        const fm = frontmatterOf(r, p);
        if (fm?.state !== "ok" || fm.loose) return [];
        const unknown = fm.keys.filter((k) => !limit("skill.frontmatter.keys").includes(k));
        return unknown.length ? [`${p} — ${unknown.join(", ")}`] : [];
      }),
  },
  {
    kind: "skill-user-invoked-with-triggers",
    rule: "skill.disable-model-invocation",
    severity: "medium",
    title: (n) => `${n} user-invoked skill${n === 1 ? "" : "s"} still carrying trigger phrases`,
    what: "With disable-model-invocation: true, Claude never loads the skill on its own, so trigger phrasing in its description only costs listing space.",
    run: (r) =>
      r.skills.flatMap((p) => {
        const fm = frontmatterOf(r, p);
        if (fm?.state !== "ok" || String(fm.data["disable-model-invocation"]).trim() !== "true") return [];
        const hit = triggerPhrasing(String(fm.data.description ?? ""));
        return hit ? [`${p} — "${hit}"`] : [];
      }),
  },
  {
    kind: "skill-name-not-portable",
    rule: "skill.name.charset",
    severity: "low",
    title: (n) => `${n} skill name${n === 1 ? "" : "s"} the Agent Skills format refuses`,
    what: `Claude Code still loads these. The Agent Skills format, which the API and a claude.ai upload read, takes a name of at most ${limit("skill.name.max-chars")} characters, in ${limit("skill.name.charset")}, holding neither of ${limit("skill.name.reserved-words").map((w) => `"${w}"`).join(" and ")} (\`skill.name.max-chars\`, \`skill.name.reserved-words\`). It matters only for a skill that is meant to move there.`,
    run: (r) =>
      r.skills.flatMap((p) => {
        const fm = frontmatterOf(r, p);
        if (!fm || fm.state === "broken") return [];
        // With no `name`, Claude Code names the skill after its directory.
        const name = typeof fm.data?.name === "string" && fm.data.name.trim() ? fm.data.name.trim() : posix.basename(posix.dirname(p));
        const why = [];
        if (!/^[a-z0-9-]+$/.test(name)) why.push("characters other than lowercase letters, numbers and hyphens");
        if ([...name].length > limit("skill.name.max-chars")) why.push(`${[...name].length} characters`);
        for (const w of limit("skill.name.reserved-words")) if (name.toLowerCase().includes(w)) why.push(`contains the reserved word "${w}"`);
        return why.length ? [`${p} — "${name}": ${why.join("; ")}`] : [];
      }),
  },
  {
    kind: "skill-description-not-portable",
    rule: "skill.description.portable-max-chars",
    severity: "low",
    title: (n) => `${n} skill description${n === 1 ? "" : "s"} over the Agent Skills format's ${limit("skill.description.portable-max-chars").toLocaleString("en-US")} characters`,
    what: `Claude Code still loads these and truncates later, at ${limit("skill.description.max-chars").toLocaleString("en-US")}. The Agent Skills format, which the API and a claude.ai upload read, stops at this length. It matters only for a skill that is meant to move there.`,
    run: (r) =>
      r.skills.flatMap((p) => {
        const fm = frontmatterOf(r, p);
        if (fm?.state !== "ok" || typeof fm.data.description !== "string") return [];
        const n = [...fm.data.description].length;
        return n > limit("skill.description.portable-max-chars") ? [`${p} — ${n} characters`] : [];
      }),
  },
  {
    kind: "skill-reference-no-contents",
    rule: "skill.reference.contents-over-lines",
    severity: "low",
    title: (n) => `${n} long reference file${n === 1 ? "" : "s"} with no table of contents`,
    what: `A skill's reference file can be previewed with a partial read. Over ${limit("skill.reference.contents-over-lines")} lines, a contents list at the top is what lets Claude see everything the file holds before deciding to read on. Looked for in the first ${CONTENTS_WITHIN} lines: a "Contents" heading, or three links to headings in the file.`,
    run: (r) =>
      r.skills.flatMap((p) => {
        const src = r.read(p);
        if (typeof src !== "string") return [];
        const dir = posix.dirname(p);
        const out = [];
        for (const line of prose(src)) {
          for (const m of line.matchAll(/\]\(([^)\s]+)\)/g)) {
            const target = m[1].split("#")[0];
            if (!/\.md$/i.test(target) || /^[a-z]+:/i.test(target) || /[{<*$]/.test(target)) continue;
            let ref;
            try {
              ref = posix.normalize(posix.join(dir, decodeURI(target)));
            } catch {
              continue;
            }
            // A reference file is one the skill ships, so it is inside the skill's own directory. A
            // link out to the repo's docs is somebody else's file.
            if (!ref.startsWith(dir + "/")) continue;
            const body = r.read(ref);
            if (typeof body !== "string") continue;
            const n = lineCount(body);
            if (n > limit("skill.reference.contents-over-lines") && !hasContents(body)) out.push(`${ref} — ${n} lines`);
          }
        }
        return out;
      }),
  },
  {
    kind: "skill-reference-missing",
    rule: "skill.supporting-files.referenced",
    severity: "medium",
    title: (n) => `${n} skill reference${n === 1 ? "" : "s"} to a file that does not exist`,
    what: "A skill points Claude at supporting files by path; a path to nothing sends it looking for a file that is not there.",
    run: (r) =>
      r.skills.flatMap((p) => {
        const src = r.read(p);
        if (typeof src !== "string") return [];
        const dir = posix.dirname(p);
        const pr = r.plugin.skill(p);
        const out = [];
        prose(src).forEach((line, i) => {
          for (const m of line.matchAll(/\]\(([^)\s]+)\)/g)) {
            const target = m[1].split("#")[0];
            // A file reference has an extension or a directory; `[Title](URL)` in an example does not.
            if (!/[./]/.test(target) || /^[a-z]+:/i.test(target) || target.startsWith("/") || /[{<*$]/.test(target)) continue;
            let resolved, fromRoot;
            try {
              resolved = posix.normalize(posix.join(dir, decodeURI(target)));
              fromRoot = posix.normalize(decodeURI(target));
            } catch {
              continue;
            }
            if (resolved.startsWith("..") || r.exists(resolved)) continue;
            // A project skill runs with the repo root as Claude's working directory, so a link written
            // from the root is followed too (#522). A plugin skill's working directory is the user's
            // project, never the plugin, so a link only the plugin's root can resolve stays reported.
            if (pr === null && !fromRoot.startsWith("..") && r.exists(fromRoot)) continue;
            out.push(`${p}:${i + 1} — ${target}`);
          }
        });
        if (pr !== null) {
          src.replace(/\r\n?/g, "\n").split("\n").forEach((line, i) => {
            for (const m of line.matchAll(/\$\{CLAUDE_PLUGIN_ROOT\}\/([^\s`"'),\]]+)/g)) {
              const target = m[1].replace(/[.:;]+$/, "");
              if (/[{<*$]/.test(target)) continue;
              if (!r.exists(inPlugin(pr, target))) out.push(`${p}:${i + 1} — \${CLAUDE_PLUGIN_ROOT}/${target}`);
            }
          });
        }
        return out;
      }),
  },

  // --- subagents ------------------------------------------------------------------------------
  {
    kind: "subagent-frontmatter-unreadable",
    rule: "subagent.frontmatter.malformed",
    severity: "medium",
    title: (n) => `${n} subagent${n === 1 ? "" : "s"} with frontmatter that cannot be read`,
    what: "A frontmatter block that never closes does not parse, and a subagent whose frontmatter does not parse is not loaded at all.",
    run: (r) =>
      r.agents.flatMap((p) => {
        const fm = frontmatterOf(r, p);
        return fm?.state === "broken" ? [`${p} — ${fm.reason}`] : [];
      }),
  },
  {
    kind: "subagent-missing-required",
    rule: "subagent.frontmatter.required",
    severity: "medium",
    title: (n) => `${n} subagent${n === 1 ? "" : "s"} missing name or description`,
    what: "Claude Code needs both to load a subagent and decide when to delegate to it.",
    run: (r) =>
      r.agents.flatMap((p) => {
        const fm = frontmatterOf(r, p);
        if (!fm || fm.state === "broken") return [];
        const missing = limit("subagent.frontmatter.required").filter((k) => !String(fm.data[k] ?? "").trim());
        return missing.length ? [`${p} — no ${missing.join(", no ")}`] : [];
      }),
  },
  {
    kind: "subagent-unknown-key",
    rule: "subagent.frontmatter.keys",
    severity: "medium",
    title: (n) => `${n} subagent${n === 1 ? "" : "s"} with frontmatter keys Claude Code does not recognise`,
    what: "Subagent keys are camelCase and must match the reference table exactly; anything else is ignored silently.",
    run: (r) =>
      r.agents.flatMap((p) => {
        const fm = frontmatterOf(r, p);
        if (fm?.state !== "ok" || fm.loose) return [];
        const unknown = fm.keys.filter((k) => !limit("subagent.frontmatter.keys").includes(k));
        return unknown.length ? [`${p} — ${unknown.join(", ")}`] : [];
      }),
  },
  {
    kind: "subagent-name-colon",
    rule: "subagent.name.no-colon",
    severity: "medium",
    title: (n) => `${n} subagent name${n === 1 ? "" : "s"} containing ':'`,
    what: "':' is reserved for plugin-scoped names; a file whose name contains one is not loaded.",
    run: (r) =>
      r.agents.flatMap((p) => {
        const fm = frontmatterOf(r, p);
        return fm?.state === "ok" && String(fm.data.name ?? "").includes(":") ? [`${p} — name: ${fm.data.name}`] : [];
      }),
  },
  {
    kind: "subagent-plugin-ignored-key",
    rule: "subagent.plugin.ignored-keys",
    severity: "medium",
    title: (n) => `${n} plugin subagent${n === 1 ? "" : "s"} setting keys a plugin agent ignores`,
    what: "hooks, mcpServers and permissionMode are ignored when the agent ships in a plugin — the protection they look like they give is not there.",
    run: (r) =>
      r.agents
        .filter((p) => r.plugin.agent(p) !== null)
        .flatMap((p) => {
          const fm = frontmatterOf(r, p);
          if (fm?.state !== "ok") return [];
          const hit = fm.keys.filter((k) => limit("subagent.plugin.ignored-keys").includes(k));
          return hit.length ? [`${p} — ${hit.join(", ")}`] : [];
        }),
  },
  {
    kind: "subagent-read-only-can-edit",
    rule: "subagent.tools.inherit-when-omitted",
    severity: "medium",
    title: (n) => `${n} subagent${n === 1 ? "" : "s"} described as read-only that can still edit`,
    what: "The prose says it changes nothing, but its tool list — or no list at all, which inherits every tool — still grants Edit or Write. Add them to disallowedTools, or list only read tools.",
    run: (r) =>
      r.agents.flatMap((p) => {
        const fm = frontmatterOf(r, p);
        if (fm?.state !== "ok") return [];
        if (!claimsReadOnly(fm.data.description, fm.body)) return [];
        const tools = toolList(fm.data.tools);
        const denied = new Set(toolList(fm.data.disallowedTools) ?? []);
        const canEdit = (tools ?? EDIT_TOOLS).filter((t) => EDIT_TOOLS.includes(t) && !denied.has(t));
        if (!canEdit.length) return [];
        return [`${p} — ${tools ? `tools grant ${canEdit.join(", ")}` : `no tools: line, so it inherits ${canEdit.join(", ")}`}`];
      }),
  },

  // --- hooks ----------------------------------------------------------------------------------
  {
    kind: "settings-not-json",
    rule: "hook.settings.json",
    severity: "medium",
    title: (n) => `${n} settings file${n === 1 ? "" : "s"} that is not valid JSON`,
    what: "Nothing in a settings file that does not parse takes effect — no hook in it runs, and none of them reports that it did not.",
    run: (r, _m, hooks) => hooks.unreadable,
  },
  {
    kind: "hook-script-missing",
    rule: "hook.exit.other-codes-non-blocking",
    severity: "medium",
    title: (n) => `${n} hook command${n === 1 ? "" : "s"} naming a script that does not exist`,
    what: "The shell exits non-zero when the script is not there, and a non-zero exit other than 2 does not block — the hook fails on every event without stopping anything, so nothing surfaces it.",
    run: (r, _m, hooks) => hooks.missing,
  },
  {
    kind: "hook-script-not-executable",
    rule: "hook.exit.other-codes-non-blocking",
    severity: "medium",
    title: (n) => `${n} hook script${n === 1 ? "" : "s"} run directly without its executable bit`,
    what: "Run as the command itself, a script without the bit fails with 'permission denied' — a non-blocking error, so the hook silently does nothing. Invoke it through its interpreter (`bash \"…\"`) or commit it as 100755.",
    run: (r, _m, hooks) => hooks.notExecutable,
  },
  {
    kind: "post-tool-use-exit-2",
    rule: "hook.post-tool-use.cannot-block",
    severity: "medium",
    title: (n) => `${n} PostToolUse hook${n === 1 ? "" : "s"} that exit 2 expecting to block`,
    what: "PostToolUse runs after the tool already ran; exit 2 there only shows stderr to Claude. A guard that must stop an edit belongs in PreToolUse.",
    run: (r, _m, hooks) => hooks.postExit2,
  },

  // --- mods -----------------------------------------------------------------------------------
  {
    kind: "mod-modules-not-one",
    rule: "mod.hooks-json.modules",
    severity: "medium",
    title: (n) => `${n} mod${n === 1 ? "" : "s"} whose modules key is not one path`,
    what: "A mod's hooks.json names its hooks module as an array holding one path. Anything else is not the shape the reference describes.",
    run: (r, _m, hooks) => hooks.modNotOne,
  },
  {
    kind: "mod-module-missing",
    rule: "mod.hooks-json.modules",
    severity: "medium",
    title: (n) => `${n} mod${n === 1 ? "" : "s"} naming a hooks module that does not exist`,
    what: "The path is relative to hooks.json. A mod whose module is not there has no entry point, so none of its hooks is registered.",
    run: (r, _m, hooks) => hooks.modMissing,
  },
  {
    kind: "mod-module-extension",
    rule: "mod.module.extensions",
    severity: "medium",
    title: (n) => `${n} hooks module${n === 1 ? "" : "s"} with an extension a mod cannot use`,
    what: "A hooks module is an ES module with one of the listed JavaScript or TypeScript extensions.",
    run: (r, _m, hooks) => hooks.modExtension,
  },
  {
    kind: "mod-present",
    rule: "mod.not-sandboxed",
    severity: "low",
    title: (n) => `${n} mod${n === 1 ? "" : "s"} shipped from this repo`,
    what: `Not a defect: a statement of what installing this plugin grants. A mod's handlers run inside Claude Code with the user's permissions, on Claude Code v${limit("mod.min-version")} or later. Run "claude plugin validate <plugin dir>" to list the events it handles and the calls it makes; Cortex does not read the module's code.`,
    run: (r, _m, hooks) => hooks.modPresent,
  },

  // --- direct Messages API use ----------------------------------------------------------------
  {
    kind: "api-first-block-as-text",
    rule: "model.response.read-by-block-type",
    severity: "medium",
    title: (n) => `${n} Messages API call${n === 1 ? "" : "s"} reading content[0] as the text`,
    what: "A model that thinks can open its response with a thinking block, so the first block is not the text. Select the block whose type is text.",
    run: (r) =>
      r.code.flatMap((p) => {
        const src = r.read(p);
        if (typeof src !== "string" || !ANTHROPIC.test(src)) return [];
        return linesMatching(src, /\bcontent\s*\[\s*0\s*\]\s*(?:\??\.\s*text\b|\[\s*["']text["']\s*\])/).map((n) => `${p}:${n}`);
      }),
  },
  {
    kind: "api-max-tokens-small",
    rule: "model.thinking.counts-toward-max-tokens",
    severity: "low",
    title: (n) => `${n} Messages API request${n === 1 ? "" : "s"} with a small max_tokens`,
    what: `Thinking counts toward max_tokens, so a limit sized for the reply alone can end the turn before any text is written. Flagged under ${MIN_MAX_TOKENS.toLocaleString("en-US")} — Cortex's threshold, not a documented number.`,
    run: (r) =>
      r.code.flatMap((p) => {
        const src = r.read(p);
        if (typeof src !== "string" || !ANTHROPIC.test(src)) return [];
        const out = [];
        src.replace(/\r\n?/g, "\n").split("\n").forEach((line, i) => {
          for (const m of line.matchAll(/\bmax_tokens["']?\s*[:=]\s*(\d[\d_]*)/g)) {
            const v = Number(m[1].replace(/_/g, ""));
            if (v < MIN_MAX_TOKENS) out.push(`${p}:${i + 1} — max_tokens ${v}`);
          }
        });
        return out;
      }),
  },
  {
    kind: "api-thinking-disabled",
    rule: "model.thinking.cannot-disable",
    severity: "medium",
    title: (n) => `${n} request${n === 1 ? "" : "s"} disabling thinking`,
    what: "Opus 5.5 does not accept thinking disabled; lower the effort level instead.",
    run: (r) =>
      r.code.flatMap((p) => {
        const src = r.read(p);
        if (typeof src !== "string" || !ANTHROPIC.test(src)) return [];
        const lines = src.replace(/\r\n?/g, "\n").split("\n");
        const out = [];
        lines.forEach((line, i) => {
          if (!/["']?type["']?\s*:\s*["']disabled["']/.test(line)) return;
          const near = lines.slice(Math.max(0, i - 3), i + 1).join("\n");
          if (/thinking/.test(near)) out.push(`${p}:${i + 1}`);
        });
        return out;
      }),
  },
  {
    kind: "prompt-asks-for-reasoning",
    rule: "model.prompt.no-reasoning-in-response",
    severity: "low",
    title: (n) => `${n} prompt${n === 1 ? "" : "s"} asking the model to write out its reasoning`,
    what: "A prompt that pushes the model to reproduce its reasoning in the response can be declined. Read summarized thinking instead. A phrase match, so worth checking rather than certain.",
    run: (r, mem) => {
      const agentFacing = [...mem.files, ...r.skills, ...r.agents];
      const apiCode = r.code.filter((p) => {
        const src = r.read(p);
        return typeof src === "string" && ANTHROPIC.test(src);
      });
      return [...new Set([...agentFacing, ...apiCode])].sort().flatMap((p) => {
        const src = r.read(p);
        if (typeof src !== "string") return [];
        const body = p.endsWith(".md") ? prose(src).join("\n") : src;
        return linesMatching(body, REASONING).map((n) => `${p}:${n}`);
      });
    },
  },
];

function linesMatching(src, re) {
  const out = [];
  src.replace(/\r\n?/g, "\n").split("\n").forEach((line, i) => {
    if (re.test(line)) out.push(i + 1);
  });
  return out;
}

const noHooks = () => ({
  unreadable: [], missing: [], notExecutable: [], postExit2: [],
  modNotOne: [], modMissing: [], modExtension: [], modPresent: [],
});

/**
 * A plugin's `hooks/hooks.json` that names a hooks module is a mod. Only what a file listing proves
 * is judged here — the shape of `modules`, that the path names a file, and its extension. What the
 * module's code handles and calls is `claude plugin validate`'s to say, and a regex copy of it
 * would disagree with the real one.
 */
function inspectMod(res, r, p, modules) {
  const one = Array.isArray(modules) && modules.length === 1 && typeof modules[0] === "string";
  if (!one) {
    const got = Array.isArray(modules) ? `${modules.length} entries` : `a ${modules === null ? "null" : typeof modules}`;
    res.modNotOne.push(`${p} — modules is ${got}`);
  }
  const named = (Array.isArray(modules) ? modules : []).filter((m) => typeof m === "string");
  let sound = one;
  for (const m of named) {
    const rel = posix.normalize(posix.join(posix.dirname(p), m));
    if (rel.startsWith("..")) continue; // outside the repo — cannot be seen from here
    if (!r.exists(rel)) {
      res.modMissing.push(`${p} → ${m} — ${rel} not found`);
      sound = false;
    } else if (!limit("mod.module.extensions").includes(posix.extname(rel))) {
      res.modExtension.push(`${p} → ${m} — ${posix.extname(rel) || "no extension"}`);
      sound = false;
    }
  }
  if (sound) res.modPresent.push(`${p} → ${modules[0]}`);
}

/** Walk every hook command once; the hook rows read the result. */
function inspectHooks(r) {
  const res = noHooks();
  for (const p of r.settings) {
    const src = r.read(p);
    if (typeof src !== "string") continue;
    let json;
    try {
      json = JSON.parse(src.replace(/^﻿/, ""));
    } catch (e) {
      res.unreadable.push(`${p} — ${String(e.message).split("\n")[0]}`);
      continue;
    }
    // A plugin's hooks resolve against its plugin root; a settings file's against the project dir,
    // which for `<dir>/.claude/settings.json` is `<dir>`.
    const pr = r.plugin.hooks(p);
    const modules = limit("mod.hooks-json.modules");
    if (pr !== null && json && typeof json === "object" && modules in json) inspectMod(res, r, p, json[modules]);
    const hooks = json && typeof json === "object" ? json.hooks : null;
    if (!hooks || typeof hooks !== "object") continue;
    const project = pr ?? posix.dirname(posix.dirname(p));
    for (const [event, groups] of Object.entries(hooks)) {
      for (const g of Array.isArray(groups) ? groups : []) {
        for (const h of Array.isArray(g?.hooks) ? g.hooks : []) {
          if (h?.type !== "command" || typeof h.command !== "string") continue;
          const words = shellWords(h.command);
          words.forEach((w, i) => {
            if (!SCRIPT_EXT.test(w)) return;
            let rel = null;
            const projectVar = w.match(/^\$\{?CLAUDE_PROJECT_DIR\}?\/(.+)$/);
            const pluginVar = w.match(/^\$\{?CLAUDE_PLUGIN_ROOT\}?\/(.+)$/);
            if (projectVar) rel = inPlugin(project, projectVar[1]);
            else if (pluginVar) rel = pr !== null ? inPlugin(pr, pluginVar[1]) : null;
            else if (!/^[~/$%]|^[A-Za-z]:/.test(w)) rel = inPlugin(project, w.replace(/^\.\//, ""));
            if (!rel || rel.startsWith("..")) return;
            const where = `${p} → ${event}: ${h.command}`;
            if (!r.exists(rel)) {
              res.missing.push(`${where} — ${rel} not found`);
              return;
            }
            if (i === 0) {
              const mode = r.modeOf(rel);
              if (mode && !/755$|775$|777$|711$|751$/.test(mode)) res.notExecutable.push(`${where} — ${rel} is ${mode}`);
            }
            if (event === "PostToolUse") {
              const body = r.read(rel);
              const exits2 = (l) => !/^\s*#/.test(l) && /(^|[\s;&|])exit\s+2\b/.test(l);
              if (typeof body === "string" && body.split(/\r?\n/).some(exits2)) res.postExit2.push(`${where} — ${rel} exits 2`);
            }
          });
        }
      }
    }
  }
  return res;
}

// ---------------------------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------------------------

function detailFor(check, evidenceCount) {
  const r = rule(check.rule);
  const extra = evidenceCount > MAX_EVIDENCE ? ` The first ${MAX_EVIDENCE} of ${evidenceCount} are listed.` : "";
  return `${check.what} Rule \`${r.id}\` (${r.source}): "${r.evidence}"${extra}`;
}

/**
 * Findings about this repo's Claude setup. `opts.read(path) → string|null` supplies file text
 * (defaults to reading `root`); `opts.exists(path)` and `opts.modeOf(path) → "100755"|"100644"|null`
 * answer file-state questions (default: the index, the filesystem, and git's recorded mode).
 */
export function claudeSetupFindings(index, root, opts = {}) {
  const r = gather(index, root, opts);
  const mem = loadedMemory(r);
  const hooks = inspectHooks(r);
  const out = [];
  for (const check of CHECKS) {
    const evidence = [...new Set(check.run(r, mem, hooks))].sort();
    if (!evidence.length) continue;
    out.push({
      severity: check.severity,
      kind: PREFIX + check.kind,
      title: check.title(evidence.length),
      detail: detailFor(check, evidence.length),
      evidence: evidence.slice(0, MAX_EVIDENCE),
      offer: null,
    });
  }
  return out;
}

/**
 * The same checks, one subagent at a time — for `agents.mjs`, which grades each agent before it maps
 * it to a role (spec T6). Every row runs against a view of the repo holding that one agent and
 * nothing else, so a finding here is exactly the line `claudeSetupFindings` would list for the file,
 * with no evidence cap and no second copy of any rule.
 *
 * Returns `[{ path, plugin, text, frontmatter, findings: [{ kind, rule, severity, evidence }] }]`
 * for every file the checker counts as a subagent, sorted by path.
 */
export function subagentGrades(index, root, opts = {}) {
  const r = gather(index, root, opts);
  const none = { files: [], missing: [] };
  const empty = noHooks();
  return r.agents.map((p) => {
    const one = { ...r, agents: [p], skills: [], claudeMd: [], code: [], settings: [] };
    const findings = CHECKS.flatMap((check) => {
      const evidence = [...new Set(check.run(one, none, empty))].sort();
      return evidence.length ? [{ kind: PREFIX + check.kind, rule: check.rule, severity: check.severity, evidence }] : [];
    });
    const text = r.read(p);
    return {
      path: p,
      plugin: r.plugin.agent(p) !== null,
      text: typeof text === "string" ? text : null,
      frontmatter: typeof text === "string" ? readFrontmatter(text) : null,
      findings,
    };
  });
}

/** The kinds this module can report — for the docs, the view and the tests. */
export const CLAUDE_SETUP_KINDS = CHECKS.map((c) => PREFIX + c.kind);
