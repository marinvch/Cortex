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

const EDIT_TOOLS = ["Edit", "Write", "MultiEdit", "NotebookEdit"];
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
function toolList(v) {
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
  const PLUGIN_AGENT = /^agents\/[^/]+\.md$/;
  const PLUGIN_HOOKS = /^hooks\/hooks\.json$/;

  const claudeMd = paths.filter((p) => /(^|\/)CLAUDE(\.local)?\.md$/.test(p));
  const skills = paths.filter(
    (p) => /(^|\/)\.claude\/skills\/[^/]+\/SKILL\.md$/.test(p) || pluginRootOf(p, PLUGIN_SKILL) !== null,
  );
  const agents = paths.filter((p) => /(^|\/)\.claude\/agents\/[^/]+\.md$/.test(p) || pluginRootOf(p, PLUGIN_AGENT) !== null);
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

const READ_ONLY =
  /\bread[- ]only\b|\bchanges? nothing\b|\bmakes? no changes\b|\breport[- ]only\b|\bdiagnoses only\b|\bnever (?:edits?|modif(?:y|ies)) anything\b|\bdoes not (?:edit|modify) (?:any|the code)/gi;

/**
 * Does the prose claim the agent is read-only? Code is stripped and a negated mention does not
 * count — "marks destructive, not read-only" is an agent that edits saying so. Found on this repo's
 * own docs-owner, which the first version of this check reported as read-only.
 */
function claimsReadOnly(text) {
  const plain = prose(text).join("\n");
  return [...plain.matchAll(READ_ONLY)].some((m) => !/\b(?:not|no|never|isn't|aren't)\s+$/i.test(plain.slice(Math.max(0, m.index - 12), m.index)));
}
const REASONING =
  // "your" and not "the": "explain the reasoning so the model understands" is advice to a skill
  // author, found in a published skill-creator, and asks the model to reveal nothing.
  /\b(?:write out|show|explain|include|output|print)\s+your\s+(?:full\s+|entire\s+|step[- ]by[- ]step\s+)?(?:reasoning|chain[- ]of[- ]thought|thought process)\b|\b(?:reason|think) (?:out loud|aloud)\b|\bshow your work\b/i;
const ANTHROPIC = /anthropic|\/v1\/messages|messages\.create|\bclaude-(?:opus|sonnet|haiku|fable)/i;
const EMPHASIS = /\b(?:IMPORTANT|CRITICAL|MUST|NEVER|ALWAYS)\b/;

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
        const out = [];
        prose(src).forEach((line, i) => {
          for (const m of line.matchAll(/\]\(([^)\s]+)\)/g)) {
            const target = m[1].split("#")[0];
            // A file reference has an extension or a directory; `[Title](URL)` in an example does not.
            if (!/[./]/.test(target) || /^[a-z]+:/i.test(target) || target.startsWith("/") || /[{<*$]/.test(target)) continue;
            let resolved;
            try {
              resolved = posix.normalize(posix.join(dir, decodeURI(target)));
            } catch {
              continue;
            }
            if (!resolved.startsWith("..") && !r.exists(resolved)) out.push(`${p}:${i + 1} — ${target}`);
          }
        });
        const pr = r.plugin.skill(p);
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
        if (!claimsReadOnly(`${fm.data.description ?? ""}\n${fm.body}`)) return [];
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

/** Walk every hook command once; the hook rows read the result. */
function inspectHooks(r) {
  const res = { unreadable: [], missing: [], notExecutable: [], postExit2: [] };
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
    const hooks = json && typeof json === "object" ? json.hooks : null;
    if (!hooks || typeof hooks !== "object") continue;
    // A plugin's hooks resolve against its plugin root; a settings file's against the project dir,
    // which for `<dir>/.claude/settings.json` is `<dir>`.
    const pr = r.plugin.hooks(p);
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

/** The kinds this module can report — for the docs, the view and the tests. */
export const CLAUDE_SETUP_KINDS = CHECKS.map((c) => PREFIX + c.kind);
