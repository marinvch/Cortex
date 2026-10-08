// skill-drift.mjs — which lines of a repo's own skills the repo on disk now contradicts.
//
// `/cortex-skills` writes `.claude/skills/<id>/SKILL.md` into a target repo, quoting that repo's
// real paths, commands and state. Then the repo moves on. `/cortex` keeps existing files by design,
// so a re-run upgraded the loop and left the skills alone — and on the first repo upgraded from an
// August install, two of them told every agent the repo had no tests (it had 83), sent it to
// `src/components/` paths that had moved, and named files that were deleted (#462). A skill is the
// most-followed text Cortex writes: it fires on a trigger and is read as an instruction.
//
// Three checks, each one a claim the disk can refute without a model:
//
//   - path    — a backticked repo path the skill names that is neither in the index nor on disk
//   - tests   — the skill says the repo has no tests, and the index counts test files
//   - script  — `npm run X` / `pnpm X` / `yarn X` names a script no package.json declares, or
//               `./mvnw` / `./gradlew` names a wrapper that is not there
//
// And three more from the first field report (#548), each as narrow as the disk allows:
//
//   - no-script — the skill says a script does not exist, and a package.json declares it
//   - tests     — also "no test runner installed", beside a detected runner and real test files
//   - premise   — a setup skill Cortex proposes (`gone` in skills.mjs) whose premise the index
//                 refutes; the entry carries `retire`, a proposal the ritual asks about
//
// The description is read for paths only, and such a finding is marked `frontmatter: true`: a
// refresh never edits frontmatter, so it is reported and asked about, not fixed in passing.
//
// The direction of error is chosen, as in `orphans.mjs`: every rule below can only DROP a candidate.
// A missed stale line costs what the repo already had; an invented one costs trust in every other
// finding, and a user who is told a correct skill is wrong stops reading the report. Prose — "lint
// has two baseline errors" — is where most drift actually lives and is deliberately not chased:
// the same line `citationDrift` draws in review.mjs, for the same reason.
//
// Reads files; writes nothing. Deterministic for a given tree and index — the outside questions it
// asks are both git's: `git check-ignore`, the repo's own declaration of what is generated, and the
// history of each drifted skill file.
//
// That history is `edited`: whether a person worked on the skill since it was written. More than
// the commit that added it, or an uncommitted change, means someone did, and their edit may be the
// only correct part. /cortex puts the fact on the playback row (`editedNote`), so its one
// confirmation covers a skill the user was told about; before, the question came after the
// confirmation, on nearly every skill in an active repo (#548). `null` when git cannot say — a
// directory that is no checkout — which is unanswered, never "not edited".

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { premiseGone } from "./skills.mjs";
import { labelsFor } from "./stack.mjs";

export const SKILLS_REL = ".claude/skills";

// --- paths -----------------------------------------------------------------------------------------

// The same shape `citationDrift` accepts, plus a trailing `:line` or `:line-line` — a skill cites
// `src/x.tsx:10-11` far more often than a brief does, and the line suffix must not hide the path.
const BACKTICKED = /`([A-Za-z0-9_.\/-]+?)(?::\d+(?:-\d+)?)?`/g;

// A file needs a slash and an extension, exactly as in review.mjs: that rule took a real repo's
// citation check from 157 findings to 7. A directory needs a trailing slash and two segments —
// `src/components/` is a claim about the tree, `dist/` is usually a word.
function candidatePath(token) {
  const t = token.replace(/^\.\//, "");
  if (!t.includes("/") || t.startsWith("/") || t.startsWith("../") || t.startsWith(".cortex/")) return null;
  if (t.endsWith("/")) {
    const segs = t.slice(0, -1).split("/").filter(Boolean);
    return segs.length >= 2 ? { path: t.slice(0, -1), dir: true } : null;
  }
  return /\.[A-Za-z0-9]{1,6}$/.test(t) ? { path: t, dir: false } : null;
}

// A skill that sets something up names the file it is about to create. "Create `src/test/setup.ts`"
// is correct BEFORE the file exists, which is exactly when the skill is meant to be read.
const INTRODUCES = /\b(?:create|creates|creating|add|adds|adding|write|writes|writing|generate|generates|scaffold|touch|mkdir|new)\s+(?:(?:a|an|the)\s+)?(?:(?:new|file|directory|folder|module|test)\s+)*(?:at\s+|in\s+|called\s+|named\s+)?$/i;

// Prose that states an absence is correct BECAUSE the thing is gone — review.mjs's rule.
const ABSENCE = /\b(?:deleted|removed|retired|no longer|used to|does not exist|doesn't exist|do not exist|not yet|once|until|missing)\b/i;

// Directories nobody commits. `git check-ignore` is the real answer; this is the floor for a repo
// that is not a git checkout, so `node_modules/.tmp/…` is never reported as a moved file.
const NEVER_COMMITTED = new Set(["node_modules", ".git", ".next", ".nuxt", ".turbo", ".cache", "coverage"]);

function defaultIsIgnored(root) {
  return (paths) => {
    if (!paths.length) return new Set();
    try {
      const out = execFileSync("git", ["check-ignore", "--no-index", "--stdin"], {
        cwd: root, input: paths.join("\n") + "\n", encoding: "utf8", stdio: ["pipe", "pipe", "ignore"],
      });
      return new Set(out.split(/\r?\n/).filter(Boolean));
    } catch (e) {
      // Exit 1 means "none of these is ignored" — still an answer, carried on the error object.
      if (e && typeof e.stdout === "string") return new Set(e.stdout.split(/\r?\n/).filter(Boolean));
      return new Set();
    }
  };
}

function defaultHistory(root) {
  const git = (args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  return (rel) => {
    try {
      // --porcelain first: it fails outside a checkout, where `git log` on some versions prints nothing.
      const uncommitted = git(["status", "--porcelain", "--", rel]).trim() !== "";
      const commits = git(["log", "--format=%h", "--", rel]).split(/\r?\n/).filter(Boolean).length;
      return { commits, uncommitted };
    } catch {
      return null;
    }
  };
}

/** `{ edited, editedNote }` for a skill file's history — see the header. */
function editedSince(h) {
  if (!h) return { edited: null, editedNote: null };
  const edited = h.commits > 1 || h.uncommitted;
  if (!edited) return { edited, editedNote: null };
  const parts = [];
  if (h.commits > 1) parts.push(`${h.commits} commits`);
  if (h.uncommitted) parts.push("uncommitted changes");
  return { edited, editedNote: `edited since it was written, ${parts.join(" and ")}` };
}

// --- tests -----------------------------------------------------------------------------------------

// A claim about THE REPO, not about a function. "no tests for the parser" is scoped and may well be
// true; the index can only refute a claim about the whole tree.
const NO_TESTS = [
  /\b(?:no|zero)\s+(?:test|spec)\s+(?:files?|suites?)\b/i,
  /\b(?:no|zero)\s+(?:automated\s+)?tests\b/i,
  /\b(?:repo|repository|project|codebase|app|package)\s+(?:has|contains)\s+no\s+tests?\b/i,
];
const SCOPED_AFTER = /^\s*(?:yet\s+)?(?:for|of|on|around|against|covering|cover|that|which|under|in\s+(?!(?:this|the)\s+(?:repo|repository|project|codebase)))\b/i;
const CONDITIONAL_BEFORE = /\b(?:if|when|whether|unless|where)\b[^.;:!?]*$/i;
const HISTORICAL = /\b(?:had|was|were|used to|until|previously|no longer|before)\b/i;

// --- commands --------------------------------------------------------------------------------------

// `npm test` / `npm start` are script shorthands; every other bare `npm <word>` is npm's own command.
const NPM_SHORTHAND = { test: "test", t: "test", tst: "test", start: "start", stop: "stop", restart: "restart" };

// pnpm and yarn run a script for any word that is not one of their own commands. The lists are the
// commands each ships; a word on them is never read as a script, which can only drop a finding.
const PNPM_BUILTINS = new Set(("add install i update up upgrade remove rm uninstall un link ln unlink import rebuild rb " +
  "prune fetch patch patch-commit patch-remove audit list ls ll outdated why licenses exec dlx create init publish " +
  "pack deploy store env setup server config c get set bin root doctor approve-builds ignored-builds cat-file cat-index " +
  "find-hash recursive r self-update help install-test it ci dedupe").split(" "));
const YARN_BUILTINS = new Set(("add install remove upgrade up dlx exec why info init create set config cache workspace " +
  "workspaces npm node plugin version pack patch patch-commit constraints bin link unlink explain dedupe search " +
  "import global outdated upgrade-interactive audit autoclean check generate-lock-entry licenses list login logout " +
  "owner policies publish tag team unplug rebuild stage sdks help").split(" "));

const PKG_CMD = /(?<![\w./-])(npm|pnpm|yarn|bun)\s+(?:(?:-{1,2}[\w-]+)\s+)*(?:(run|run-script)\s+(?:(?:-{1,2}[\w-]+)\s+)*)?([A-Za-z0-9][\w:.-]*)/g;
const WRAPPER_CMD = /(?<![\w/.-])(\.\/)?(mvnw|gradlew)(?![\w.-])/g;

// A line that talks ABOUT a command rather than telling you to run it: "`npm test` does not exist",
// "once `npm test` passes", "add a `lint` script". Setup skills are written before their scripts.
const ABOUT_A_COMMAND = /\b(?:does not exist|doesn't exist|do not exist|not exist|no longer|not yet|once|until|add|adds|adding|create|creates|missing|removed|deleted|retired|used to|instead of|rather than)\b/i;

// The opposite claim: prose saying a script is NOT there. Refuted only by a manifest that declares
// it, and only when the line names the script — in backticks, as `npm run X`, or by being the skill
// named after it ("not wired into a standalone npm script", in a skill called type-check, beside a
// `typecheck` script). A claim that names nothing a manifest declares is left alone.
const NO_SCRIPT = [
  /\bno\s+(?:[\w:-]+\s+){0,2}script\b/i,
  /\bnot\s+(?:yet\s+)?(?:wired|exposed|declared|defined|available|set\s+up)\s+(?:into|in|as|via|through)\s+(?:a|an|any)\s+(?:[\w-]+\s+){0,2}script\b/i,
  /\b(?:does\s+not|doesn't|do\s+not|don't)\s+exist\b/i,
];
const squash = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

// "no test runner installed" — refuted by a runner the index detected, beside test files.
const NO_RUNNER = /\bno\s+test(?:ing)?\s+(?:runner|framework|harness)\b/i;

// A path in a description is rarely backticked, so a bare token is read too. It still has to look
// like a repo path (`candidatePath`), and a first segment with a dot inside it is a host name. A
// bare token must also start in a directory the repo has: three-flatland's description says
// "canvas/WebGL/Three.js", which is prose with slashes and ends in what looks like an extension.
const BARE_PATH = /(?<![\w@:/.-])`?((?:\.{1,2}\/)?[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.*-]+)+\/?)`?/g;
const HOSTLIKE = /^[^./][^/]*\.[^/]+\//;

function scriptFor(tool, run, word) {
  if (run) return word;
  if (tool === "npm") return NPM_SHORTHAND[word] ?? null;
  if (tool === "bun") return null; // `bun test` is bun's own runner, not a script
  if (word === "run" || word === "run-script") return null;
  const builtins = tool === "pnpm" ? PNPM_BUILTINS : YARN_BUILTINS;
  return builtins.has(word) ? null : word;
}

// --- reading ---------------------------------------------------------------------------------------

/** The skills a repo carries, as `{ name, rel }`, sorted. A missing directory is zero, not an error. */
export function listRepoSkills(root) {
  const dir = join(root, ...SKILLS_REL.split("/"));
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && existsSync(join(dir, e.name, "SKILL.md")))
      .map((e) => ({ name: e.name, rel: `${SKILLS_REL}/${e.name}/SKILL.md` }))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

function declaredScripts(root, index) {
  const manifests = (index?.files ?? []).map((f) => f.path).filter((p) => p === "package.json" || p.endsWith("/package.json"));
  const scripts = new Map(); // script → the first manifest that declares it
  let unreadable = false;
  for (const rel of manifests) {
    try {
      const pkg = JSON.parse(readFileSync(join(root, rel), "utf8"));
      for (const k of Object.keys(pkg?.scripts ?? {})) if (!scripts.has(k)) scripts.set(k, rel);
    } catch {
      // A manifest that cannot be read might declare the very script in question, so while one
      // exists no script can be proven missing. An empty `scripts` is different: that is read.
      unreadable = true;
    }
  }
  return { manifests, scripts, unreadable };
}

/** The body's lines, each tagged with whether it sits in frontmatter or a code fence. */
function scan(text) {
  const lines = text.split(/\r?\n/);
  const out = [];
  let front = lines[0]?.trim() === "---";
  let fence = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (front) {
      if (i > 0 && line.trim() === "---") front = false;
      continue; // frontmatter is metadata, and a refresh never touches it
    }
    if (/^\s*(```|~~~)/.test(line)) { fence = !fence; continue; }
    out.push({ n: i + 1, line, fence });
  }
  return out;
}

/** The lines of the frontmatter's `description`, with their numbers: the key's line and its continuations. */
function descriptionLines(text) {
  const lines = text.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return [];
  const out = [];
  let inside = false;
  for (let i = 1; i < lines.length && lines[i].trim() !== "---"; i++) {
    const key = /^([A-Za-z_][\w-]*):/.exec(lines[i]);
    if (key) inside = key[1] === "description";
    if (inside) out.push({ n: i + 1, line: key ? lines[i].slice(key[0].length) : lines[i] });
  }
  return out;
}

// --- the check -------------------------------------------------------------------------------------

/**
 * Every provable contradiction between a repo's skills and the repo.
 *
 * Returns `{ checked, drifted }`: `checked` names every skill read, `drifted` holds only the ones
 * with findings — `{ skill, path, edited, editedNote, retire, findings: [{ line, kind, cited, why, text, hint?, frontmatter? }] }`.
 * `retire` is `{ successor }` when the skill's premise is gone, else `null`.
 * `edited` is whether a person worked on the file since it was written (`null`: git cannot say) and
 * `editedNote` the sentence a playback row carries when they did. Without an
 * index nothing can be proven, so it returns `null` rather than a clean bill: "not checked" and
 * "checked, nothing wrong" must stay two answers.
 */
export function skillDrift(root, index, { isIgnored = defaultIsIgnored(root), history = defaultHistory(root) } = {}) {
  if (!index || !Array.isArray(index.files)) return null;

  const known = new Set(index.files.map((f) => f.path));
  const dirs = new Set();
  const byBase = new Map();
  for (const f of index.files) {
    const parts = f.path.split("/");
    for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join("/"));
    const base = parts[parts.length - 1];
    if (!byBase.has(base)) byBase.set(base, []);
    byBase.get(base).push(f.path);
  }
  const onDisk = (p) => known.has(p) || dirs.has(p) || existsSync(join(root, ...p.split("/")));
  // A shortened path — `ui/badge.tsx` for `src/components/ui/badge.tsx` — is a claim about SOME file
  // ending that way. If one does, the skill abbreviated; it did not lie.
  const suffixOf = (p) => index.files.some((f) => f.path.endsWith("/" + p)) || [...dirs].some((d) => d.endsWith("/" + p));

  const tests = index.files.filter((f) => f.isTest).map((f) => f.path).sort();
  const testCount = index.stats?.tests ?? tests.length;
  const { manifests, scripts, unreadable } = declaredScripts(root, index);
  const runners = Array.isArray(index.stack?.test) ? index.stack.test : [];

  const checked = listRepoSkills(root);
  const drifted = [];
  const pendingPaths = []; // resolved against git check-ignore in one batch, below

  for (const skill of checked) {
    let text;
    try {
      text = readFileSync(join(root, ...skill.rel.split("/")), "utf8");
    } catch {
      continue;
    }
    const home = skill.rel.slice(0, skill.rel.lastIndexOf("/"));
    const findings = [];
    const add = (f) => findings.push({ ...f, text: f.text.trim().slice(0, 160) });

    // The description — paths only. It decides when the skill fires, so a path in it that is gone is
    // worth saying, and it is marked: a refresh leaves frontmatter as it is, so this one is asked about.
    for (const { n, line } of descriptionLines(text)) {
      const seen = new Set();
      for (const m of line.matchAll(BARE_PATH)) {
        const token = m[1].replace(/[.,;:]+$/, ""); // a path that ends the sentence
        const c = HOSTLIKE.test(token) || token.includes("*") ? null : candidatePath(token);
        if (!c || seen.has(c.path)) continue;
        seen.add(c.path);
        if (!m[0].startsWith("`") && !onDisk(c.path.split("/")[0])) continue;
        if (c.path.split("/").some((s) => NEVER_COMMITTED.has(s))) continue;
        if (onDisk(c.path) || onDisk(`${home}/${c.path}`) || suffixOf(c.path)) continue;
        pendingPaths.push({ findings, finding: { line: n, kind: "path", cited: token, path: c.path, dir: c.dir, text: line, frontmatter: true } });
      }
    }

    for (const { n, line, fence } of scan(text)) {
      // "no such script" — prose only, refuted by the manifest that declares it
      if (!fence && !unreadable && scripts.size) {
        const plain = line.replace(/[*_`]/g, "");
        const claim = NO_SCRIPT.map((re) => re.exec(plain)).find(Boolean);
        if (claim && !CONDITIONAL_BEFORE.test(plain.slice(0, claim.index)) && !HISTORICAL.test(plain)) {
          const named = [
            ...[...line.matchAll(/`([\w:.-]+)`/g)].map((m) => m[1]),
            ...[...line.matchAll(PKG_CMD)].map((m) => scriptFor(m[1], m[2], m[3].replace(/[.:]+$/, ""))).filter(Boolean),
          ];
          // "does not exist" is about whatever the line names; only the two script phrasings may
          // fall back to the skill's own name.
          const aboutScripts = /script/i.test(claim[0]);
          let script = named.find((w) => scripts.has(w));
          if (!script && aboutScripts && !named.length) script = [...scripts.keys()].find((k) => squash(k) === squash(skill.name));
          if (script) {
            add({
              line: n, kind: "no-script", cited: claim[0], text: line,
              why: `says there is no such script, and ${scripts.get(script)} declares a "${script}" script`,
            });
          }
        }
      }

      // "no test runner" — prose only, refuted by a detected runner beside real test files
      if (!fence && testCount > 0 && runners.length) {
        const plain = line.replace(/[*_`]/g, "");
        const m = NO_RUNNER.exec(plain);
        if (m && !CONDITIONAL_BEFORE.test(plain.slice(0, m.index)) && !HISTORICAL.test(plain)) {
          add({
            line: n, kind: "tests", cited: m[0], text: line,
            why: `says no test runner is installed, and the index detected ${labelsFor(runners).join(", ")} beside ${testCount} test file${testCount === 1 ? "" : "s"}`,
          });
        }
      }

      // paths — backticked, outside fences (a fence is a command, and its words are not citations)
      if (!fence) {
        const seen = new Set();
        for (const m of line.matchAll(BACKTICKED)) {
          const c = candidatePath(m[1]);
          if (!c || seen.has(c.path)) continue;
          seen.add(c.path);
          if (INTRODUCES.test(line.slice(0, m.index)) || ABSENCE.test(line)) continue;
          if (c.path.split("/").some((s) => NEVER_COMMITTED.has(s))) continue;
          if (onDisk(c.path) || onDisk(`${home}/${c.path}`) || suffixOf(c.path)) continue;
          pendingPaths.push({ findings, finding: { line: n, kind: "path", cited: m[1], path: c.path, dir: c.dir, text: line } });
        }
      }

      // "no tests" — prose only, with markdown emphasis stripped so **zero test files** still reads
      if (!fence && testCount > 0) {
        const plain = line.replace(/[*_`]/g, "");
        for (const re of NO_TESTS) {
          const m = re.exec(plain);
          if (!m) continue;
          const before = plain.slice(0, m.index);
          const after = plain.slice(m.index + m[0].length);
          if (SCOPED_AFTER.test(after) || CONDITIONAL_BEFORE.test(before)) continue;
          const sentence = before.slice(Math.max(before.lastIndexOf("."), before.lastIndexOf(";")) + 1) + m[0] + after.split(/[.;]/)[0];
          if (HISTORICAL.test(sentence)) continue;
          add({
            line: n, kind: "tests", cited: m[0], text: line,
            why: `says the repo has no tests, and the index counts ${testCount} test file${testCount === 1 ? "" : "s"}` +
              (tests.length ? ` (first: ${tests[0]})` : ""),
          });
          break;
        }
      }

      // commands — in fences and prose alike, unless the line is ABOUT the command
      if (ABOUT_A_COMMAND.test(line) && !fence) continue;
      for (const m of line.matchAll(PKG_CMD)) {
        const [, tool, run, raw] = m;
        const word = raw.replace(/[.:]+$/, "");
        const script = scriptFor(tool, run, word);
        if (!script || scripts.has(script)) continue;
        // An unreadable package.json proves nothing about what it declares.
        if (unreadable) continue;
        add({
          line: n, kind: "script", cited: m[0].trim(), text: line,
          why: manifests.length
            ? `no package.json in the repo declares a "${script}" script (read: ${manifests.join(", ")})`
            : `names the "${script}" script, and the repo has no package.json`,
        });
      }
      for (const m of line.matchAll(WRAPPER_CMD)) {
        const wrapper = m[2];
        if (known.has(wrapper) || existsSync(join(root, wrapper)) || index.files.some((f) => f.path.endsWith("/" + wrapper))) continue;
        add({ line: n, kind: "script", cited: m[0], text: line, why: `names the ${wrapper} wrapper, and the repo has none` });
      }
    }

    // A setup skill whose premise the index refutes has nothing left to say (skills.mjs, `gone`).
    const premise = premiseGone(skill.name, index);
    if (premise) {
      findings.push({
        line: 1, kind: "premise", cited: skill.name, text: skill.name,
        why: premise.why + (premise.successor ? ` — \`${premise.successor}\` is the skill for this repo now` : ""),
      });
    }
    drifted.push({ skill: skill.name, path: skill.rel, retire: premise ? { successor: premise.successor } : null, findings });
  }

  // One `git check-ignore` for every missing path in every skill: a path the repo declares generated
  // is absent by design, and the repo's own .gitignore is the witness for that, not a list of names.
  const ignored = isIgnored([...new Set(pendingPaths.map((p) => p.finding.path))]);
  for (const { findings, finding } of pendingPaths) {
    if (ignored.has(finding.path) || ignored.has(finding.path + "/")) continue;
    const base = finding.path.split("/").pop();
    const same = finding.dir ? [] : byBase.get(base) ?? [];
    findings.push({
      line: finding.line,
      kind: "path",
      cited: finding.cited,
      text: finding.text.trim().slice(0, 160),
      why: (finding.frontmatter ? "the description " : "") + (finding.dir
        ? `names the directory ${finding.path}/, which is not in the repo`
        : `names ${finding.path}, which is not in the repo`),
      ...(finding.frontmatter ? { frontmatter: true } : {}),
      // A hint, never a correction: one file with the same name is where it probably went, and the
      // refresh still has to open it and confirm.
      ...(same.length === 1 ? { hint: same[0] } : {}),
    });
  }

  for (const d of drifted) d.findings.sort((a, b) => a.line - b.line || a.kind.localeCompare(b.kind) || a.cited.localeCompare(b.cited));
  return {
    checked: checked.map((s) => s.name),
    drifted: drifted.filter((d) => d.findings.length).map((d) => ({ skill: d.skill, path: d.path, ...editedSince(history(d.path)), retire: d.retire, findings: d.findings })),
  };
}
