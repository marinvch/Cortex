// Which parts of the AI-native SDLC loop this repo already has, and which it is missing.
//
// The install sequence used to be a menu. `/cortex-install` wrote a context layer, `/cortex-skills`
// wrote skills, `/cortex-brief` wrote leaves, and each of those was a separate command the user had
// to know to type — which is why `/cortex-next` exists at all. A menu is not an answer, and the
// eleven-commands-sorted-by-nothing problem was never in the ordering. It was that nothing owned
// the *shape* a served repo is supposed to end up in.
//
// This module owns that shape. The loop is the artifact chain: an intent becomes a spec, a spec
// becomes a plan, a plan becomes a diff with tests, the diff becomes a PR judged against a written
// review policy, the release passes a gate, and production writes the next intent. Each stage ends
// by committing a file the next stage reads, so "is this repo served" is a question about files on
// disk — which makes it answerable here, deterministically, with no model and no clock.
//
// Declarative for the same reason `offers()` and `SKILL_CANDIDATES` are: every artifact states its
// own trigger, so the full set is enumerable without reading any bodies and a new one is a row
// rather than another branch. Rank is control flow — `/cortex` walks this list top-down, so
// re-ranking an artifact changes what the user is offered first, not just a document.
//
// What this module does NOT do is write bodies. It names what is missing and cites what it
// detected; the ritual writes the file, because a useful CLAUDE.md quotes this repo's real commands
// and a useful REVIEW.md names this repo's real generated paths. Inventing those is exactly the
// failure a deterministic module cannot detect in itself.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { labelsFor } from "./stack.mjs";

/** The six stages, in loop order. A row belongs to exactly one. */
export const STAGES = ["plan", "design", "build", "test", "deploy", "maintain"];

const has = (root, rel) => existsSync(join(root, rel));

const read = (root, rel) => {
  try {
    return readFileSync(join(root, rel), "utf8");
  } catch {
    return null;
  }
};

/** A directory that exists and holds at least one entry. An empty dir is not a served artifact. */
function nonEmptyDir(root, rel) {
  try {
    return statSync(join(root, rel)).isDirectory() && readdirSync(join(root, rel)).length > 0;
  } catch {
    return false;
  }
}

/** Every `.md` under a dir, sorted. Used for the intent home and the eval suite. */
function filesIn(root, rel, ext = ".md") {
  try {
    return readdirSync(join(root, rel))
      .filter((f) => f.endsWith(ext))
      .sort();
  } catch {
    return [];
  }
}

const named = (ids) => labelsFor(ids ?? []).join(", ");

// Every evidence sentence is built through this. A `why` is the one part of a report a reader can
// check against their own repo, so a sentence that reads "null runs here" does not merely look
// untidy — it discredits the rows they cannot check. That exact string printed on the first real
// run of this module, from `s.commands.test ?? s.commands.build` where the repo declares neither,
// because `why` is rendered for PRESENT rows too and `when` had never guarded it.
//
// So the fallback is a value, never a hole, and `evidence()` refuses to interpolate an empty one.
const evidence = (value, fallback) => {
  const ok = value !== null && value !== undefined && String(value).trim() !== "";
  return ok ? String(value) : fallback;
};

// What a row is waiting on, as only the prerequisites that are actually UNMET. A static list shipped
// first, and on `got` and `fzf` — both with `.github/workflows` — the evals row printed ".github/
// workflows is present" directly above "needs: a CI system to run the suite". Both halves were true
// of the row and false of the repo: it was blocked on the missing AGENTS.md, and the one prerequisite
// it named was the one already met. A row with a single prerequisite may keep a plain array, because
// if it is blocked that one is necessarily the unmet one.
function unmet(row, s) {
  const list = typeof row.needs === "function" ? row.needs(s) : (row.needs ?? []);
  return list.filter(Boolean);
}

// Root manifests first, then by depth, then by name. On `flask` the brief cited
// `examples/celery/pyproject.toml` as the source of the stack, because the list is sorted
// alphabetically and `examples/` sorts before `pyproject.toml` — the evidence named a sample app's
// manifest over the project's own. Evidence the reader can check is the part they will check.
function byNearness(paths) {
  const depth = (p) => p.split("/").length;
  return [...paths].sort((a, b) => depth(a) - depth(b) || a.localeCompare(b));
}

// ---------------------------------------------------------------------------
// Commands — the one fact the whole Test stage rests on
// ---------------------------------------------------------------------------

// The feedback-loop play asks for a single command per check that exits non-zero on failure, and
// for CLAUDE.md to name it. Everything downstream depends on that: the verifier subagent runs it,
// the "done means verified" instruction cites it, and the eval suite allowlists it as a tool.
//
// So the commands are detected, never assumed. A CLAUDE.md that tells an agent to run `npm test` in
// a repo whose package.json has no test script is worse than one that says nothing — the agent runs
// it, gets "Missing script", and learns to distrust the file. Where nothing is declared the fields
// stay null and the ritual has to ask, which is the honest outcome.

const NPM_SCRIPTS = { build: ["build", "compile"], test: ["test", "tests"], lint: ["lint", "check"] };

// The runner that owns the scripts. `npm test` in a pnpm workspace resolves none of its
// `workspace:` dependencies, so the manager is read off the repo: the `packageManager` field first,
// because Corepack obeys it and a lockfile left over from before a switch is the stale one; then the
// lockfile each manager writes. `pnpm-workspace.yaml` counts because a workspace can exist before
// its first install.
const LOCKFILES = [
  ["pnpm", ["pnpm-lock.yaml", "pnpm-workspace.yaml"]],
  ["yarn", ["yarn.lock"]],
  ["bun", ["bun.lockb", "bun.lock"]],
];

function packageManager(root, pkg) {
  const field = typeof pkg?.packageManager === "string" ? /^(npm|pnpm|yarn|bun)@/.exec(pkg.packageManager) : null;
  if (field) return field[1];
  for (const [pm, files] of LOCKFILES) if (files.some((f) => has(root, f))) return pm;
  return "npm";
}

function npmCommands(root, text) {
  if (!text) return {};
  let pkg;
  try {
    pkg = JSON.parse(text);
  } catch {
    return {}; // A manifest we cannot parse tells us nothing; it must not tell us something wrong.
  }
  const scripts = pkg?.scripts;
  if (!scripts || typeof scripts !== "object") return {};
  const pm = packageManager(root, pkg);
  const out = {};
  for (const [kind, names] of Object.entries(NPM_SCRIPTS)) {
    const hit = names.find((n) => typeof scripts[n] === "string" && scripts[n].trim());
    if (hit) out[kind] = `${pm} run ${hit}`;
  }
  // npm, pnpm and yarn give the test script a bare verb, and it is what a reader expects to see.
  // Bun does not: `bun test` is Bun's own runner and ignores the script entirely.
  if (out.test === `${pm} run test` && pm !== "bun") out.test = `${pm} test`;
  return out;
}

// A JVM build file declares its lifecycle, so the commands are the lifecycle's: Maven always has
// `verify` and `test`, Gradle always has `build` and `test`. The wrapper wins when it is committed,
// because it pins the tool version CI runs and needs nothing installed. A wrapper with no build file
// beside it declares nothing — it would fail on the first command.
function jvmCommands(root) {
  if (has(root, "pom.xml")) {
    const mvn = has(root, "mvnw") ? "./mvnw" : "mvn";
    return { build: `${mvn} -q verify`, test: `${mvn} test` };
  }
  const gradleFiles = ["build.gradle", "build.gradle.kts", "settings.gradle", "settings.gradle.kts"];
  if (gradleFiles.some((f) => has(root, f))) {
    const gradle = has(root, "gradlew") ? "./gradlew" : "gradle";
    return { build: `${gradle} build`, test: `${gradle} test` };
  }
  return {};
}

// Only genuine targets. A Makefile's first colon-bearing line is often a variable assignment or a
// pattern rule, and `.PHONY: test` names a target without defining one — matching it would print a
// command that does nothing.
function makeCommands(text) {
  if (!text) return {};
  const targets = new Set();
  for (const line of text.split("\n")) {
    const m = /^([A-Za-z0-9_.-]+)\s*:(?!=)/.exec(line);
    if (m && m[1] !== ".PHONY") targets.add(m[1]);
  }
  const out = {};
  for (const kind of Object.keys(NPM_SCRIPTS)) if (targets.has(kind)) out[kind] = `make ${kind}`;
  return out;
}

/**
 * Build, test and lint as this repo actually declares them.
 *
 * Make wins over everything: a repo carrying a Makefile is almost always wrapping the other tools
 * in it, and the wrapper is the command a human on the team types. A root pom.xml or Gradle build
 * wins over a package.json beside it, which in a JVM repo is tooling the build already drives. The
 * merge is per kind, so a lint script survives a build file that declares no lint.
 */
export function detectCommands(root) {
  const fromMake = makeCommands(read(root, "Makefile") ?? read(root, "makefile"));
  const fromJvm = jvmCommands(root);
  const fromNpm = npmCommands(root, read(root, "package.json"));
  const out = { build: null, test: null, lint: null, ...fromNpm, ...fromJvm, ...fromMake };
  return out;
}

// ---------------------------------------------------------------------------
// Formatters — what the after-edit hook may run on the one file that changed
// ---------------------------------------------------------------------------

// The same rule as commands: declared, never assumed. Running Prettier over a Go repo, or `black`
// where the team formats with ruff, rewrites every file an agent touches in a style nobody chose.
// Each detector reads a config file the formatter itself reads, so it can be wrong only toward
// "not found" — and an empty list stamps a hook that does nothing, which is the honest outcome.
//
// Order is the order the hook's `case` tries them: specific extensions first, Prettier last,
// because its `*` pattern with `--ignore-unknown` would otherwise shadow every one after it.

const PRETTIER_CONFIGS = [
  ".prettierrc", ".prettierrc.json", ".prettierrc.yaml", ".prettierrc.yml", ".prettierrc.json5",
  ".prettierrc.js", ".prettierrc.cjs", ".prettierrc.mjs", ".prettierrc.toml",
  "prettier.config.js", "prettier.config.cjs", "prettier.config.mjs",
];

/**
 * Formatters this repo declares, as `{ glob, command }` rows for the format-changed hook. The hook
 * appends the quoted file path to `command`.
 */
export function detectFormatters(root) {
  const out = [];
  if (read(root, "go.mod") !== null) out.push({ glob: "*.go", command: "gofmt -w" });

  const pyproject = read(root, "pyproject.toml") ?? "";
  if (has(root, "ruff.toml") || has(root, ".ruff.toml") || /^\[tool\.ruff[\].]/m.test(pyproject)) {
    out.push({ glob: "*.py|*.pyi", command: "ruff format --quiet" });
  } else if (/^\[tool\.black\]/m.test(pyproject)) {
    out.push({ glob: "*.py|*.pyi", command: "black --quiet" });
  }

  let pkgPrettier = false;
  try {
    const pkg = JSON.parse(read(root, "package.json") ?? "null");
    pkgPrettier = Boolean(pkg && typeof pkg === "object" && pkg.prettier);
  } catch { /* unparseable manifest: says nothing, so it must not say "prettier" */ }
  if (pkgPrettier || PRETTIER_CONFIGS.some((f) => has(root, f))) {
    // --no-install: a hook that downloads a formatter mid-edit is not "well under a second".
    out.push({ glob: "*", command: "npx --no-install prettier --write --ignore-unknown" });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Protected paths — what a build-time hook should refuse to edit
// ---------------------------------------------------------------------------

// The hook play wants a deterministic block on generated and frozen paths. Guessing at them writes
// a hook that fires on nothing, so this reports only directories the index actually saw, and the
// ritual is told to confirm the list rather than trust it.
const GENERATED_HINTS = [
  /(^|\/)(gen|generated|__generated__)\//,
  /(^|\/)(dist|build|out|target)\//,
  /(^|\/)node_modules\//,
  /(^|\/)(migrations?|db\/migrate)\//,
  /\.(pb|generated)\.(go|ts|js|py)$/,
];

function protectedPaths(index) {
  const files = index?.files ?? [];
  const dirs = new Set();
  for (const f of files) {
    const p = f.path ?? f;
    if (typeof p !== "string") continue;
    for (const re of GENERATED_HINTS) {
      const m = re.exec(p);
      if (m) {
        // The matched directory prefix, not the whole file path — a hook matches a tree.
        dirs.add(p.slice(0, m.index + m[0].length).replace(/[^/]*$/, ""));
        break;
      }
    }
  }
  return [...dirs].filter(Boolean).sort().slice(0, 8);
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/**
 * Every fact the loop rows are allowed to branch on, read once off disk.
 *
 * `overrides` exists for tests and for the greenfield interview, where the commands come from the
 * user rather than from a manifest that does not exist yet.
 */
export function readLoopState(root, index = null, overrides = {}) {
  const stack = index?.stack ?? {
    languages: [], frameworks: [], data: [], services: [], test: [], delivery: [], manifests: [],
  };
  const files = index?.files ?? [];
  const stats = index?.stats ?? { files: files.length, tests: 0 };

  const claudeMd = read(root, "CLAUDE.md");
  const ciDir = ".github/workflows";
  // Whether an index was supplied at all, which is a different question from what it says. Kept
  // separate because every row that cites the stack has to be able to tell "detected nothing" from
  // "never looked", and one value cannot carry both.
  const indexed = index !== null && index !== undefined;

  return {
    root,
    stack,
    stats,
    indexed,
    // Greenfield is a property of the index, not a guess about the repo — and **not** something a
    // missing index may assert. Run against this repository before the indexer, `stats.files ?? 0`
    // was 0 and the header announced "Greenfield: no code yet" over several hundred files. An
    // unbuilt index is an unanswered question, so the honest default is "not greenfield": the cost
    // of treating a real greenfield repo as populated is one skipped offer, and the cost the other
    // way is telling a user their codebase does not exist.
    greenfield: indexed && (stats.files ?? 0) === 0,
    commands: detectCommands(root),
    formatters: detectFormatters(root),
    protectedPaths: protectedPaths(index),
    ci: has(root, ciDir) ? ciDir : has(root, ".gitlab-ci.yml") ? ".gitlab-ci.yml" : null,
    frontend: (stack.frameworks ?? []).some((f) => /next|react|vue|svelte|angular|remix|astro/i.test(f)),

    // Artifact presence. Each is a file fact — "does this repo have it" — never a judgment about
    // whether what is there is any good. A hollow REVIEW.md still counts as present, because a
    // ritual that silently overwrites a file someone wrote is the worse failure.
    rootBrief: has(root, "AGENTS.md"),
    claudeMd: claudeMd !== null,
    // The verification block is the half of CLAUDE.md the Test stage needs, and a CLAUDE.md can
    // exist for years without it. Checked by heading, which is what the template writes.
    verification: claudeMd !== null && /^##+\s+Verifying your work\s*$/m.test(claudeMd),
    review: has(root, "REVIEW.md"),
    intentHome: nonEmptyDir(root, "intent"),
    intents: filesIn(root, "intent"),
    subagents: nonEmptyDir(root, ".claude/agents"),
    // Settings may exist without a hooks block; the gate is the block, not the file.
    hooks: /"hooks"\s*:/.test(read(root, ".claude/settings.json") ?? ""),
    evals: nonEmptyDir(root, "evals"),
    bands: has(root, "bands.yaml") || has(root, ".cortex/bands.yaml"),
    memory: filesIn(root, ".cortex/memory"),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// The artifacts
// ---------------------------------------------------------------------------

/**
 * Every artifact `/cortex` can stamp. Each row is:
 *   id        — stable key; also the offer key the ritual records a yes/no against
 *   stage     — which of the six stages it belongs to
 *   title     — one line, shown in the offer
 *   paths     — what it would write, as the user will see them in the playback
 *   rank      — lower is offered first; ties broken by id, so the order is deterministic
 *   template  — under templates/loop/, or null where the body is written from the index
 *   present   — (s) => already there. A file fact, never a quality judgment.
 *   when      — (s) => is this repo a candidate at all. Pure predicate over the state.
 *   why       — (s) => the evidence sentence. Must name what was DETECTED.
 *   brief     — instructions to the writer, not the body itself.
 */
export const LOOP_ARTIFACTS = [
  {
    id: "brief",
    stage: "build",
    title: "The root brief — what a new joiner would need on day one",
    paths: ["AGENTS.md", "CLAUDE.md", "GEMINI.md"],
    rank: 10,
    template: "../target-AGENTS.md",
    present: (s) => s.rootBrief && s.claudeMd,
    when: () => true,
    why: (s) => {
      const what = named([...s.stack.languages, ...s.stack.frameworks]);
      if (!s.stack.manifests.length) {
        return s.indexed
          ? "no dependency manifest found, so the brief has to be written from the interview"
          : "no index yet, so the stack is unread rather than absent";
      }
      const where = byNearness(s.stack.manifests).slice(0, 2).join(", ");
      // "no framework detected — read from core/package.json" read as a contradiction: it names the
      // files it just said told it nothing. Say which of the two happened.
      return what ? `${what} — read from ${where}` : `manifests found (${where}) but no framework signal in them`;
    },
    brief:
      "Under ~120 lines. Commands, conventions, architecture, and the mistakes this repo actually " +
      "sees — detail belongs in scoped leaves. CLAUDE.md and GEMINI.md are one-line shims.",
  },
  {
    id: "verification",
    stage: "test",
    title: "The verification block — how Claude checks its own work",
    paths: ["CLAUDE.md#Verifying your work"],
    rank: 20,
    template: "verification.md",
    present: (s) => s.verification,
    // The block names commands. Offering it on a repo where none are declared writes an instruction
    // that fails the first time it runs, which is how a context file loses its reader.
    when: (s) => Boolean(s.commands.test || s.commands.build || s.commands.lint) || s.greenfield,
    needs: ["a declared build, test or lint command — the block must name real ones"],
    // Three cases, not two. The first version had a detected branch and an else that said
    // "greenfield, so the commands come from the interview" — and printed it on this repository,
    // which has several hundred files and simply keeps its manifests in core/, index/ and mcp/
    // rather than at the root. A populated repo told it had no code is the same class of error as
    // the greenfield-from-a-missing-index one, one layer down: an else branch asserting a cause it
    // never checked.
    why: (s) => {
      const found = ["build", "test", "lint"].filter((k) => s.commands[k]);
      if (found.length) {
        return `${found.map((k) => `${k}: ${s.commands[k]}`).join(" · ")} — detected, so the block can name real commands`;
      }
      if (s.greenfield) return "greenfield, so the commands come from the interview rather than a manifest";
      return "no build, test or lint command at the root — ask for them, or name the per-package ones";
    },
    brief:
      "Name only the commands that were detected, verbatim, with what a healthy run prints. Then " +
      "the rule that makes it a loop: run all of them before reporting done, and fix the code, " +
      "never the test.",
  },
  {
    id: "verifier",
    stage: "test",
    title: "The verifier subagent — a fresh context window that checks the work",
    paths: [".claude/agents/verifier.md"],
    rank: 30,
    template: "verifier.md",
    present: (s) => s.subagents,
    // Nothing to run means nothing to verify. The subagent's whole body is a command.
    when: (s) => Boolean(s.commands.test || s.commands.build),
    needs: ["a declared test or build command"],
    why: (s) =>
      `${evidence(s.commands.test ?? s.commands.build, "no runnable command declared yet")} — a verdict from a fresh context is not coloured by the assumptions that produced the code`,
    brief:
      "Report-only. It runs the change and the two nearest neighbouring flows, says what it ran " +
      "and what it saw, and fixes nothing — a verifier that repairs what it finds has no verdict.",
  },
  {
    id: "review",
    stage: "deploy",
    title: "REVIEW.md — the review policy every PR is judged against",
    paths: ["REVIEW.md"],
    rank: 40,
    template: "REVIEW.md",
    present: (s) => s.review,
    when: (s) => !s.greenfield,
    needs: ["code in the repo — there is nothing to write a review policy about yet"],
    why: (s) =>
      s.protectedPaths.length
        ? `${s.protectedPaths.length} generated path(s) detected (${s.protectedPaths.slice(0, 2).join(", ")}) — the do-not-report list can name them`
        : "no generated paths detected, so the exclusions list starts empty and grows",
    brief:
      "Three lenses — correctness, safety, fidelity to spec.md and plan.md. Say what makes a finding " +
      "blocking in THIS repo and cap the suggestions with a number. Put the generated paths detected " +
      "above under out-of-scope; a reviewer that flags generated code trains people to skim.",
  },
  {
    id: "hooks",
    stage: "deploy",
    title: "Hooks — the deterministic layer behind the advisory ones",
    paths: [".claude/settings.json"],
    rank: 50,
    template: "settings.hooks.json",
    present: (s) => s.hooks,
    when: (s) => s.protectedPaths.length > 0 || Boolean(s.commands.test) || s.formatters.length > 0,
    needs: ["a generated path worth protecting, a test command to lock during a fix, or a declared formatter"],
    why: (s) => {
      const fmt = s.formatters.length
        ? `; after-edit formatting with ${s.formatters.map((f) => f.command.split(" ").find((w) => !/^(npx|--)/.test(w))).join(", ")}`
        : "";
      return s.protectedPaths.length
        ? `protected paths to block: ${s.protectedPaths.slice(0, 3).join(", ")}${fmt}`
        : `no generated paths, so the hook that matters here is the test-file lock during a fix${fmt}`;
    },
    brief:
      "Build-phase hooks are fast and scoped to the file that changed; the full suite belongs at " +
      "the commit. A block must explain itself — the reason and the route to approval go in the " +
      "message, or the user learns only that Claude stopped. format-changed.sh gets one case line " +
      "per detected formatter and none when nothing was detected — it then does nothing.",
  },
  {
    id: "intent",
    stage: "plan",
    title: "intent/ — the home for the artifact chain",
    paths: ["intent/README.md", "intent/TEMPLATE.md"],
    rank: 60,
    template: "intent.md",
    present: (s) => s.intentHome,
    when: () => true,
    why: (s) =>
      s.review || s.rootBrief
        ? "the chain has somewhere to end; this is where it starts"
        : "an idea with no committed home is re-litigated every time it is raised",
    brief:
      "One folder in this repo, next to the code derived from it. A separate intent repo is only " +
      "worth the overhead when intent spans many repositories. Say who may write to it.",
  },
  {
    id: "evals",
    stage: "test",
    title: "evals/ — regression tests for the agent's own configuration",
    paths: ["evals/", ".github/workflows/agent-evals.yml"],
    rank: 70,
    template: "agent-evals.yml",
    present: (s) => s.evals,
    // Config to regress against, and somewhere to run it. Without CI this is a file nobody runs.
    when: (s) => Boolean(s.ci) && (s.claudeMd || s.rootBrief),
    needs: (s) => [
      !s.ci && "a CI system to run the suite",
      !(s.claudeMd || s.rootBrief) && "CLAUDE.md or AGENTS.md — the configuration an eval regresses against",
    ],
    why: (s) =>
      `${evidence(s.ci, "no CI detected")} is present — CLAUDE.md, skills and hooks steer the agent, so they deserve the regression testing code gets`,
    brief:
      "Seed it with real tasks from recent work, each with the checks that define acceptable. " +
      "Gate on the pass rate. Every production incident becomes an eval and stays one.",
  },
  {
    id: "bands",
    stage: "maintain",
    title: "bands.yaml — what closes the loop back to intent",
    paths: ["bands.yaml"],
    rank: 80,
    template: "bands.yaml",
    present: (s) => s.bands,
    // Last in the chain and it means it: the tiers escalate to a PR, so the review gate has to
    // exist before anything is allowed to open one.
    when: (s) => s.review && Boolean(s.ci),
    needs: (s) => [
      !s.review && "REVIEW.md — the gate a 3σ breach escalates into",
      !s.ci && "a CI system to run the detection script",
    ],
    why: (s) =>
      s.review && s.ci
        ? `REVIEW.md and ${s.ci} are both in place, so a 3σ breach has a gate to escalate into`
        : "a breach with no review gate has nowhere safe to escalate, so this stays closed for now",
    brief:
      "Detection stays deterministic — mean and standard deviation over a rolling window, unit " +
      "tested, no model. The model is what diagnoses AFTER a band is breached. 1σ logs, 2σ " +
      "diagnoses read-only, 3σ may open a PR or trigger a pre-approved runbook. Never more.",
  },
];

// ---------------------------------------------------------------------------
// The plan
// ---------------------------------------------------------------------------

/**
 * What `/cortex` would offer this repo, ranked.
 *
 * Three buckets, and the distinction matters to the ritual: `missing` is the worklist, `present` is
 * what to report as already served, and `blocked` is an artifact whose prerequisite is absent. A
 * blocked row is not a failure and is never silently dropped — it is told to the user by name, with
 * the artifact it is waiting on, because an offer that vanishes looks like Cortex forgot it.
 */
export function loopPlan(root, index = null, overrides = {}) {
  const s = readLoopState(root, index, overrides);
  const rows = [...LOOP_ARTIFACTS].sort((a, b) => a.rank - b.rank || a.id.localeCompare(b.id));

  const missing = [];
  const present = [];
  const blocked = [];

  for (const row of rows) {
    const entry = {
      id: row.id,
      stage: row.stage,
      title: row.title,
      paths: row.paths,
      template: row.template,
      why: row.why(s),
      brief: row.brief,
      // Carried on every entry, not only the blocked ones, so a caller rendering a blocked row
      // never has to reach back into LOOP_ARTIFACTS to find out what it is waiting on. "Waiting on
      // an earlier artifact" without naming it is the same failure as dropping the row: the user
      // learns an offer exists and not how to unlock it.
      needs: unmet(row, s),
    };
    if (row.present(s)) present.push(entry);
    else if (row.when(s)) missing.push(entry);
    else blocked.push(entry);
  }

  return {
    root,
    greenfield: s.greenfield,
    state: s,
    stages: STAGES,
    missing,
    present,
    blocked,
    // The loop is closed when nothing that applies to this repo is missing. Blocked rows do not
    // hold it open: a repo with no CI is legitimately finished without an eval suite, and reporting
    // it as incomplete forever would train the user to ignore the number.
    complete: missing.length === 0,
    served: present.length,
    total: present.length + missing.length,
  };
}

/** One line for a CLI footer: what the loop is still missing, or that it is closed. */
export function loopLine(root, index = null) {
  const plan = loopPlan(root, index);
  if (plan.complete) return `Loop closed — ${plan.served}/${plan.total} artifacts in place`;
  const first = plan.missing[0];
  return `Loop ${plan.served}/${plan.total} — next: ${first.paths[0]} (${first.stage})`;
}
