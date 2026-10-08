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
import { categoryOf, detectLanguage } from "./langs.mjs";
import { protectedClaudePath } from "../../core/claude-code.js";
import { sharedPluginStatus, teamServed } from "./shared-plugin.mjs";
import { TEAM_STAMPS, teamState } from "./team.mjs";

// Where /cortex stamps its verifier. The verifier row stamps it here, and the team row offers the
// agent found here the upgrade to the Reviewer (T9) — one location, read by both.
const VERIFIER_AT = ".claude/agents/verifier.md";

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

/** Whether any GitHub workflow in this repo names `needle` — a command it runs, not a file it is. */
function workflowsRunning(root, needle) {
  return filesIn(root, ".github/workflows", ".yml")
    .concat(filesIn(root, ".github/workflows", ".yaml"))
    .some((f) => (read(root, `.github/workflows/${f}`) ?? "").includes(needle));
}

const named = (ids) => labelsFor(ids ?? []).join(", ");

// Whether either hook template would do anything here: protected-paths.sh needs a path to block,
// format-changed.sh a formatter to run. Nothing else — a test command is not hook work, because no
// template acts on one.
const hooksHaveWork = (s) => s.protectedPaths.length > 0 || s.formatters.length > 0;

// The team row's evidence: what is offered, what already plays a role and by which agent, and what
// waits. Agents are named by their `name`, the identity Claude Code uses, never by file.
function teamWhy(t) {
  if (!t) return "no index yet, so the agents already here are unread rather than absent";
  const parts = [];
  const byRole = (role) => (t.covered[role] ?? []).map((a) => a.name).join(" and ");
  const covered = Object.keys(t.covered);
  if (t.playbook) parts.push("the team is in CLAUDE.md under Working as a team");
  if (t.offer.length) parts.push(`${t.playbook ? "still on offer" : "offers"}: ${t.offer.map((o) => o.role).join(", ")} — each picked on its own`);
  if (covered.length) parts.push(`already played: ${covered.map((r) => `${r} by ${byRole(r)}`).join(", ")}`);
  if (t.upgrade) parts.push(`${t.upgrade.name} is offered the upgrade to the Reviewer`);
  const pm = t.withheld.find((w) => w.role === "project-manager" && !t.covered["project-manager"]);
  if (pm) parts.push(`project-manager waits: ${pm.why}`);
  if (t.proposals.length) parts.push(`${t.proposals.length} existing agent${t.proposals.length === 1 ? " has" : "s have"} proposed edits, asked one agent at a time`);
  return parts.length ? parts.join("; ") : "every role is played by an agent already here";
}

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

// Lint goes by a family of names, not one word. pmndrs/zustand and pmndrs/jotai both run `eslint .`
// as `test:lint`, one leg of `test: pnpm run "/^test:.*/"`, and both reported `lint: null`. The
// aggregate wins — `lint` usually runs every `lint:*` — then `test:lint`, then a `lint:*` part only
// when it is the ONLY one: of `lint:js` and `lint:css` with no aggregate, either would be a lint
// command that checks half the repo and exits 0, so neither is guessed. A fixer (`lint:fix`,
// `fix:lint`) is never a lint command; it rewrites files rather than failing on them. `check` stays
// the last resort it always was.
function lintScript(scripts, declared) {
  if (declared("lint")) return "lint";
  if (declared("test:lint")) return "test:lint";
  const parts = Object.keys(scripts)
    .filter((n) => n.startsWith("lint:") && !/(^|:)fix($|:)/.test(n) && declared(n))
    .sort();
  if (parts.length === 1) return parts[0];
  if (parts.length > 1) return null;
  return declared("check") ? "check" : null;
}

// A test command that never exits is worse than none. `"test": "vitest"` is the default a Vite app
// ships with, and in a terminal it starts watch mode and waits for edits — so the verification block,
// the verifier subagent and agent-evals.yml all named a command that hangs, and cortex-loop went on
// printing `npm test` after the block had been written by hand with `test:run`. Vitest decides by
// TTY and by `CI`, so the same script runs once in a pipeline and forever in a shell; "exits
// somewhere" is not "exits", and a command we cannot prove exits is not one we may name.
//
// Detection errs one way only. Calling a one-shot command a watcher costs a question the ritual asks
// anyway; calling a watcher one-shot costs a hung session. So anything not recognised here is taken
// at its word, and every rule below names a runner that really does default to watching:
//   - an explicit `--watch` / `--watchAll` (Jest, Mocha, `node --test`), unless `=false`
//   - `vitest` without `run`/`list`, `--run`, `--no-watch` or a `CI=true` in front of it
//   - `react-scripts test` and its wrappers (craco, react-app-rewired) — Jest in watch mode
//   - `ng test`, whose Karma config watches unless told `--watch=false`
//   - `nodemon`, which exists only to watch
// A script that calls another script of the SAME manifest (`npm run x`, `pnpm x`, pnpm's
// `"/^test:.*/"`, `run-s test:*`) is followed; one that reaches into another package (`--filter`,
// `-C`, `workspace`) is not, because which manifest answers is a workspace question — a documented
// limit, and it errs toward taking the script at its word.
const ONE_SHOT_TEST_SCRIPTS = ["test:run", "test:ci", "test:once"];

const SCRIPT_RUNNERS = new Set(["npm", "pnpm", "yarn", "bun"]);
const OTHER_PACKAGE = /^(--filter|-F|-C|--dir|--prefix|--workspace|-w|--recursive|-r|workspace|workspaces)$/;
const TRUTHY_CI = /^CI=(true|1)$/i;

const tokensOf = (segment) =>
  (segment.match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map((t) => t.replace(/^(["'])(.*)\1$/, "$2"));

/** Script names a runner invocation refers to, in this manifest — or null when it runs a binary. */
function scriptsNamed(tokens, scripts) {
  const [runner, ...rest] = tokens;
  if (/^(run-s|run-p|npm-run-all)$/.test(runner)) {
    const globs = rest.filter((t) => !t.startsWith("-"));
    // npm-run-all's globs: `*` stops at a `:`, `**` does not.
    const re = (g) =>
      new RegExp(`^${g.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replaceAll("**", "\0").replaceAll("*", "[^:]*").replaceAll("\0", ".*")}$`);
    return Object.keys(scripts).filter((n) => globs.some((g) => re(g).test(n)));
  }
  if (!SCRIPT_RUNNERS.has(runner)) return null;
  if (rest.some((t) => OTHER_PACKAGE.test(t))) return []; // another package's script: not ours to read
  const args = rest.filter((t) => !t.startsWith("-"));
  let name = args[0];
  if (name === "run" || name === "run-script") name = args[1];
  if (name === undefined) return [];
  // pnpm runs every script a /regex/ matches: zustand's `test` is `pnpm run "/^test:.*/"`.
  const rx = /^\/(.+)\/$/.exec(name);
  if (rx) {
    try {
      const re = new RegExp(rx[1]);
      return Object.keys(scripts).filter((n) => re.test(n));
    } catch {
      return [];
    }
  }
  if (typeof scripts[name] === "string") return [name];
  // `npm test` with no test script, or `bun test` (Bun's own runner): nothing of ours to follow.
  // Anything else is a binary — `yarn vitest` — and the caller reads it as one.
  return name === "test" ? [] : null;
}

const WATCH_FLAG = /^--watch(All)?(=(true|1))?$/;
const WATCH_OFF = /^(--no-watch|--watch(All)?=(false|0))$/;

/** Whether one command, with its env prefix stripped, starts a runner that waits for edits. */
function commandWatches(tokens, ci) {
  const bin = (tokens[0] ?? "").split("/").pop();
  const off = tokens.some((t) => WATCH_OFF.test(t));
  if (bin === "vitest") {
    // `includes`, not "the first positional": `vitest --config x.ts run` is the one-shot form too,
    // and mistaking it the other way would drop a command that works rather than name one that hangs.
    return !(tokens.includes("run") || tokens.includes("list") || tokens.includes("--run") || off || ci);
  }
  if (/^(react-scripts|craco|react-app-rewired)$/.test(bin) && tokens[1] === "test") return !(off || ci);
  if (bin === "ng" && tokens[1] === "test") return !(off || ci);
  return bin === "nodemon";
}

/** Whether a script, followed through the scripts it calls in this manifest, starts a watcher. */
function scriptWatches(name, scripts, seen = new Set()) {
  if (seen.has(name) || typeof scripts[name] !== "string") return false;
  seen.add(name);
  for (const segment of scripts[name].split(/&&|\|\||;|\|/)) {
    let tokens = tokensOf(segment.trim());
    // An explicit watch flag wins wherever it sits — `npm run test:unit -- --watch` included.
    if (tokens.some((t) => WATCH_FLAG.test(t))) return true;
    let ci = false;
    // Environment in front of the command: `CI=true vitest`, `cross-env PORT=4100 react-scripts test`.
    while (tokens.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[0]) || /^(cross-env|env)$/.test(tokens[0]))) {
      if (TRUTHY_CI.test(tokens[0])) ci = true;
      tokens = tokens.slice(1);
    }
    // A package runner in front of a binary: `npx vitest`, `pnpm exec vitest`.
    if (/^(npx|pnpx|bunx)$/.test(tokens[0])) tokens = tokens.slice(1);
    else if (SCRIPT_RUNNERS.has(tokens[0]) && tokens[1] === "exec") tokens = tokens.slice(2);
    while (tokens[0]?.startsWith("-")) tokens = tokens.slice(1);

    const named = scriptsNamed(tokens, scripts);
    if (named !== null) {
      if (named.some((n) => scriptWatches(n, scripts, seen))) return true;
      continue;
    }
    // `yarn vitest` with no script of that name runs the binary, so read it as the binary.
    if (SCRIPT_RUNNERS.has(tokens[0])) tokens = tokens.slice(1);
    if (commandWatches(tokens, ci)) return true;
  }
  return false;
}

/**
 * The test script to name, and a sentence when the choice needs one. A watcher is passed over for a
 * one-shot script when the manifest declares one; when it does not, there is no test command —
 * the ritual asks, which is the outcome `detectCommands` already gives a repo that declares none.
 */
function testScript(scripts, declared) {
  const first = NPM_SCRIPTS.test.find(declared);
  if (!first || !scriptWatches(first, scripts)) return { hit: first ?? null, note: null };
  const shown = `the \`${first}\` script (\`${scripts[first].trim()}\`) starts a watcher that does not exit`;
  const once = ONE_SHOT_TEST_SCRIPTS.find((n) => declared(n) && !scriptWatches(n, scripts));
  if (once) return { hit: once, note: `${shown}, so \`${once}\` — which runs once — is the test command` };
  return {
    hit: null,
    note: `${shown}, and no script that runs once is declared (looked for ${ONE_SHOT_TEST_SCRIPTS.join(", ")}) — ask for a test command that exits`,
  };
}

function npmCommands(root, text) {
  const none = { commands: {}, notes: {} };
  if (!text) return none;
  let pkg;
  try {
    pkg = JSON.parse(text);
  } catch {
    return none; // A manifest we cannot parse tells us nothing; it must not tell us something wrong.
  }
  const scripts = pkg?.scripts;
  if (!scripts || typeof scripts !== "object") return none;
  const pm = packageManager(root, pkg);
  const out = {};
  const notes = {};
  const declared = (n) => typeof scripts[n] === "string" && scripts[n].trim();
  for (const [kind, names] of Object.entries(NPM_SCRIPTS)) {
    let hit;
    if (kind === "lint") hit = lintScript(scripts, declared);
    else if (kind === "test") {
      const t = testScript(scripts, declared);
      hit = t.hit;
      if (t.note) notes.test = t.note;
    } else hit = names.find(declared);
    if (hit) out[kind] = `${pm} run ${hit}`;
  }
  // npm, pnpm and yarn give the test script a bare verb, and it is what a reader expects to see.
  // Bun does not: `bun test` is Bun's own runner and ignores the script entirely.
  if (out.test === `${pm} run test` && pm !== "bun") out.test = `${pm} test`;
  return { commands: out, notes };
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
  return commandsWithNotes(root).commands;
}

// The commands and, per kind, the sentence saying why a choice was not the obvious one — today only
// a watching `test` script passed over or refused. A note is kept only while its kind is still the
// npm answer: a Makefile's `test` target wins the merge, and then the script's watcher is not ours
// to mention.
function commandsWithNotes(root) {
  const fromMake = makeCommands(read(root, "Makefile") ?? read(root, "makefile"));
  const fromJvm = jvmCommands(root);
  const npm = npmCommands(root, read(root, "package.json"));
  const commands = { build: null, test: null, lint: null, ...npm.commands, ...fromJvm, ...fromMake };
  const notes = {};
  for (const [kind, note] of Object.entries(npm.notes)) {
    if (!fromMake[kind] && !fromJvm[kind]) notes[kind] = note;
  }
  return { commands, notes };
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
  // vendor.mod declares the module where go.mod is only made at build time, as in docker/cli (#533).
  if (read(root, "go.mod") !== null || read(root, "vendor.mod") !== null) out.push({ glob: "*.go", command: "gofmt -w" });

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
    // --no-install: a hook that downloads a formatter mid-edit stalls that edit for the download.
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
const MIGRATIONS_HINT = /(^|\/)(migrations?|db\/migrate)\//;
const GENERATED_HINTS = [
  /(^|\/)(gen|generated|__generated__)\//,
  /(^|\/)(dist|build|out|target)\//,
  /(^|\/)node_modules\//,
  MIGRATIONS_HINT,
  /\.(pb|generated)\.(go|ts|js|py)$/,
];

// For every other hint the directory name is the evidence. For migrations it is only a hint, and
// the FILE is the evidence: a migration tool writes SQL or code (`prisma/migrations/*/migration.sql`,
// Rails `db/migrate/*.rb`, Django and Alembic `.py`, Flyway `db/migration/V1__*.sql`), so a file of
// any other kind proves nothing, and nothing under a docs tree is a migration whatever it holds.
// pmndrs/zustand keeps two hand-written upgrade guides in `docs/reference/migrations/`; the bare
// name made /cortex propose a hook refusing edits to them and list them in REVIEW.md's
// do-not-report section.
const DOCS_TREE = /(^|\/)(docs?|documentation)\//i;

function isMigrationEvidence(path) {
  if (DOCS_TREE.test(path)) return false;
  const cat = categoryOf(detectLanguage(path));
  return cat === "code" || cat === "schema";
}

// A lockfile is generated by definition — the package manager writes it and a hand edit is
// overwritten by the next install — yet no install protected one: every repo had to add
// `pnpm-lock.yaml` or `package-lock.json` to REVIEW.md's out-of-scope list by hand. Matched on the
// exact file name, never a suffix: `yarn.lock.md` is prose and `my-package-lock.json` is not npm's.
export const LOCKFILE_NAMES = new Set([
  "pnpm-lock.yaml", "package-lock.json", "npm-shrinkwrap.json", "yarn.lock", "bun.lock", "bun.lockb",
  "deno.lock", "Cargo.lock", "poetry.lock", "uv.lock", "Pipfile.lock", "pdm.lock", "composer.lock",
  "Gemfile.lock", "go.sum", "mix.lock", "pubspec.lock", "Podfile.lock", "flake.lock",
  "packages.lock.json", "gradle.lockfile",
]);

// Where a lockfile can sit: beside the manifest that asked for it. The index is NOT enough on its
// own, and this is the half a fixture cannot show — `walk.mjs` drops every `*.lock` and `*-lock.json`
// and anything over its size cap, so on a real repo `yarn.lock`, `Cargo.lock` and a large
// `pnpm-lock.yaml` never reach `index.files`. The index says which directories hold a manifest; the
// disk says whether a lockfile is beside it. Root is always asked, since it is where one usually is.
const MANIFEST_NAMES = new Set([
  "package.json", "deno.json", "deno.jsonc", "Cargo.toml", "pyproject.toml", "Pipfile", "composer.json",
  "Gemfile", "go.mod", "mix.exs", "pubspec.yaml", "Podfile", "flake.nix", "build.gradle", "build.gradle.kts",
]);

const baseName = (p) => p.slice(p.lastIndexOf("/") + 1);

function lockfiles(root, files) {
  const found = new Set();
  const dirs = new Set([""]);
  for (const p of files) {
    const name = baseName(p);
    if (LOCKFILE_NAMES.has(name)) found.add(p); // the index saw it: `go.sum`, a small pnpm-lock.yaml
    else if (MANIFEST_NAMES.has(name) || name.endsWith(".csproj")) dirs.add(p.slice(0, p.length - name.length));
  }
  for (const dir of dirs) {
    for (const name of LOCKFILE_NAMES) if (has(root, dir + name)) found.add(dir + name);
  }
  return byNearness(found);
}

// The Maven and Gradle wrappers are generated as well: `mvn wrapper:wrapper` and `gradle wrapper`
// write them, and the next wrapper upgrade overwrites a hand edit. Missing them left every Maven repo
// reading "no generated paths", so /cortex offered no hook and REVIEW.md named nothing (#482). Found
// the way lockfiles are, and for the same reason: on DISK, beside a build file, by exact name and
// kind — the scripts are files, the wrapper homes are directories. `.mvn/` and the wrapper jar are
// exactly what a walker drops, and a repo is often looked at before it has an index at all.
export const WRAPPER_FILES = ["mvnw", "mvnw.cmd", "gradlew", "gradlew.bat"];
export const WRAPPER_DIRS = [".mvn/wrapper", "gradle/wrapper"];
const JVM_BUILD_NAMES = new Set(["pom.xml", "build.gradle", "build.gradle.kts", "settings.gradle", "settings.gradle.kts"]);

const isKind = (root, rel, dir) => {
  try {
    const st = statSync(join(root, rel));
    return dir ? st.isDirectory() : st.isFile();
  } catch {
    return false;
  }
};

function wrappers(root, files) {
  const dirs = new Set([""]);
  for (const p of files) {
    const name = baseName(p);
    if (JVM_BUILD_NAMES.has(name)) dirs.add(p.slice(0, p.length - name.length));
  }
  // One project's wrapper stays together, nearest project first, so the cap drops whole far projects.
  // Sorted flat by depth, `.mvn/wrapper/` came after every nested `gradlew`, and gs-rest-service's
  // four sample projects pushed every wrapper directory — the root's too — off the list.
  const out = [];
  for (const dir of byNearness(dirs)) {
    const found = [];
    for (const name of WRAPPER_FILES) if (isKind(root, dir + name, false)) found.push(dir + name);
    // A tree, so a trailing slash: the hook matches it as `*/.mvn/wrapper/*`, like `dist/`.
    for (const name of WRAPPER_DIRS) if (isKind(root, dir + name, true)) found.push(dir + name + "/");
    out.push(...byNearness(found));
  }
  return out;
}

function protectedPaths(root, index) {
  const files = (index?.files ?? []).map((f) => f?.path ?? f).filter((p) => typeof p === "string");
  const dirs = new Set();
  for (const p of files) {
    for (const re of GENERATED_HINTS) {
      const m = re.exec(p);
      if (m && re === MIGRATIONS_HINT && !isMigrationEvidence(p)) continue;
      if (m) {
        // The matched directory prefix, not the whole file path — a hook matches a tree.
        dirs.add(p.slice(0, m.index + m[0].length).replace(/[^/]*$/, ""));
        break;
      }
    }
  }
  // Trees, lockfiles and wrappers are capped apart, so a monorepo with a lockfile per package cannot
  // push its generated trees or its build wrapper off the list, nor the other way round. A lockfile
  // or wrapper script entry is a FILE path — no trailing slash — and the hook matches it by name.
  return [
    ...[...dirs].filter(Boolean).sort().slice(0, 8),
    ...lockfiles(root, files).slice(0, 8),
    ...wrappers(root, files).slice(0, 8),
  ];
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
  const detected = commandsWithNotes(root);

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
    commands: detected.commands,
    // Why a command is not the obvious one, by kind — `{ test: "the `test` script … starts a
    // watcher …" }`. Empty when every command was taken as declared.
    commandNotes: detected.notes,
    formatters: detectFormatters(root),
    protectedPaths: protectedPaths(root, index),
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
    // Any workflow that runs cortex-review counts, whatever it is called: a team that wired the
    // review into its own ci.yml is served, and stamping a second workflow would run it twice.
    reviewCi: workflowsRunning(root, "cortex-review"),
    intentHome: nonEmptyDir(root, "intent"),
    intents: filesIn(root, "intent"),
    subagents: nonEmptyDir(root, ".claude/agents"),
    // Settings may exist without a hooks block; the gate is the block, not the file.
    hooks: /"hooks"\s*:/.test(read(root, ".claude/settings.json") ?? ""),
    evals: nonEmptyDir(root, "evals"),
    bands: has(root, "bands.yaml") || has(root, ".cortex/bands.yaml"),
    memory: filesIn(root, ".cortex/memory"),
    // Whether this repo is served for a team (the `work` profile or a team-brain connector), and
    // what its settings.json already says about the shared plugin. The profile is this machine's
    // environment; `overrides.team` is how a test states it instead.
    team: teamServed(root),
    sharedPlugin: sharedPluginStatus(root),
    // The agent team (plan step 14): which roles the repo's agents already play, what is offered,
    // and the values each file would be rendered with. `null` without an index — the agents are
    // listed from it, and "no agents" must not be read off an index nobody built.
    agentTeam: teamState(root, index, {
      testCmd: overrides.commands?.test ?? detected.commands.test,
      verifierPath: VERIFIER_AT,
      as: overrides.agentsAs ?? {},
    }),
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
 *   stamps    — the whole files this row writes from a loop template, as { path, template }. These
 *               are what the stamp record tracks and what adoption looks for (`stamps.mjs`). A block
 *               appended or merged into a shared file (CLAUDE.md, settings.json) is not one.
 *   present   — (s) => already there. A file fact, never a quality judgment.
 *   applies   — (s) => optional. False drops the row from every bucket and every count: it is not
 *               this kind of repo, which is different from waiting on a prerequisite (`when`).
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
      // A watching test script passed over or refused is said here, because this is the row that
      // writes the command down — and a reader who knows `npm test` exists will otherwise ask why
      // the block names something else, or nothing.
      const note = s.commandNotes?.test ? `; ${s.commandNotes.test}` : "";
      if (found.length) {
        return `${found.map((k) => `${k}: ${s.commands[k]}`).join(" · ")} — detected, so the block can name real commands${note}`;
      }
      if (s.greenfield) return "greenfield, so the commands come from the interview rather than a manifest";
      return `no build, test or lint command at the root — ask for them, or name the per-package ones${note}`;
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
    paths: [VERIFIER_AT],
    rank: 30,
    template: "verifier.md",
    stamps: [{ path: VERIFIER_AT, template: "loop/verifier.md" }],
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
    id: "team",
    stage: "build",
    title: "The agent team — one job per agent, each role picked on its own",
    // The directory, because which roles land is the developer's pick; `state.agentTeam.offer` names
    // each file. The playbook is a block appended to CLAUDE.md and, like the verification block, is
    // not a stamp; every whole file is (`TEAM_STAMPS`), and none is ever adopted.
    paths: [".claude/agents/", ".claude/hooks/test-paths.sh", ".claude/skills/team/SKILL.md", "CLAUDE.md#Working as a team"],
    rank: 35,
    template: "../team/playbook.md",
    stamps: TEAM_STAMPS,
    // A repo has a team once the playbook is in CLAUDE.md — the block every session loads. Roles the
    // developer declined do not hold the row open: T4 makes each one their pick.
    present: (s) => Boolean(s.agentTeam?.playbook),
    when: (s) => Boolean(s.agentTeam) && !s.greenfield,
    needs: (s) => [
      !s.agentTeam && "an index — the team is matched against the agents already here, and the index lists them",
      s.greenfield && "code in the repo — a team has nothing yet to plan, test or review",
    ],
    why: (s) => teamWhy(s.agentTeam),
    // The largest behaviour change in the pass, and a path cannot show it (#548): the playbook is
    // loaded by every session, and it stops each one before a code task. The words are the
    // playbook's own (templates/team/playbook.md), and loop.test.mjs fails if they part.
    effect:
      'Every later session in this repo stops before a task that changes code, says what ' +
      '`/cortex-impact --size` recommends, asks "Single agent or team?", and plans or edits nothing ' +
      "until you answer. Deleting the CLAUDE.md section undoes it.",
    brief:
      "Ask per role, never as one bundle: every role in state.agentTeam.offer is its own yes/no (T4). " +
      "A covered role is not offered; say which agent covers it. The verifier's upgrade to the Reviewer " +
      "is one more yes/no, and a no keeps the verifier as the reviewer. Each existing agent's proposals " +
      "are one question per agent, with the diff, never covered by [a]ll. Get the files, values and " +
      "roster with `cortex-loop.mjs . --team <roles>`; every value in its needs is a question, never a guess.",
  },
  {
    id: "review",
    stage: "deploy",
    title: "REVIEW.md — the review policy every PR is judged against",
    paths: ["REVIEW.md"],
    rank: 40,
    template: "REVIEW.md",
    stamps: [{ path: "REVIEW.md", template: "loop/REVIEW.md" }],
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
    id: "review-ci",
    stage: "deploy",
    title: "cortex-review.yml — every PR read against the repo's own documents, in CI",
    paths: [".github/workflows/cortex-review.yml"],
    rank: 45,
    template: "cortex-review.yml",
    stamps: [{ path: ".github/workflows/cortex-review.yml", template: "loop/cortex-review.yml" }],
    present: (s) => s.reviewCi,
    // A review against no documents has nothing to say, and the template is a GitHub workflow — on
    // any other CI it is a file nothing runs.
    when: (s) => s.ci === ".github/workflows" && s.rootBrief,
    needs: (s) => [
      s.ci !== ".github/workflows" &&
        `GitHub Actions — the template is a GitHub workflow${s.ci ? `, and this repo's CI is ${s.ci}` : ""}`,
      !s.rootBrief && "AGENTS.md — the documents a pull request is reviewed against",
    ],
    why: (s) => {
      if (s.reviewCi) return "a workflow in .github/workflows already runs cortex-review";
      if (s.ci === ".github/workflows") {
        return s.rootBrief
          ? "AGENTS.md and .github/workflows are both here, so every PR can be read against the documents it may have made wrong — deterministic, no API key"
          : ".github/workflows is here, but there is no AGENTS.md yet for a PR to be read against";
      }
      return s.ci
        ? `this repo's CI is ${s.ci}, and the template is a GitHub workflow`
        : "no CI detected, and a review that runs only when someone remembers it is the one that gets skipped";
    },
    brief:
      "Pin CORTEX_REF to the Cortex release doing the stamping. Advisory by default: it reports in " +
      "the log, the run summary and as annotations, and fails nothing unless the repo sets the " +
      "CORTEX_REVIEW_BLOCKING variable — then only a provable broken citation fails the PR.",
  },
  {
    id: "hooks",
    stage: "deploy",
    title: "Hooks — the deterministic layer behind the advisory ones",
    paths: [".claude/settings.json"],
    rank: 50,
    template: "settings.hooks.json",
    // settings.hooks.json itself is merged into settings.json, so only the two scripts are whole files.
    stamps: [
      { path: ".claude/hooks/protected-paths.sh", template: "loop/protected-paths.sh" },
      { path: ".claude/hooks/format-changed.sh", template: "loop/format-changed.sh" },
    ],
    // The row promises exactly what its two templates do — protected-paths.sh blocks edits to the
    // detected paths, format-changed.sh formats the file that changed — and nothing else. It once
    // offered "the test-file lock during a fix" on every repo with a test script, a hook no template
    // provides, so a repo with no generated path and no formatter was stamped with two scripts that
    // do nothing and the row was reported done. Where neither has work the row does not apply, and a
    // hooks block already on disk does not make it served: counting it would report the same no-op
    // stamp as closed that this condition exists to stop writing.
    present: (s) => s.hooks && hooksHaveWork(s),
    when: (s) => hooksHaveWork(s),
    needs: ["a generated path or lockfile to protect, or a declared formatter — without either, both hooks would do nothing"],
    why: (s) => {
      const fmt = s.formatters.length
        ? `after-edit formatting with ${s.formatters.map((f) => f.command.split(" ").find((w) => !/^(npx|--)/.test(w))).join(", ")}`
        : "";
      if (s.protectedPaths.length) {
        return `protected paths to block: ${s.protectedPaths.slice(0, 3).join(", ")}${fmt ? `; ${fmt}` : ""}`;
      }
      if (fmt) return `no generated paths to block, so protected-paths.sh starts empty; ${fmt}`;
      return s.hooks
        ? "no generated paths and no declared formatter, so no Cortex hook has work to do here — the hooks block already in .claude/settings.json is left as it is"
        : "no generated paths and no declared formatter, so no hook has work to do here";
    },
    brief:
      "Build-phase hooks are fast and scoped to the file that changed; the full suite belongs at " +
      "the commit. A block must explain itself — the reason and the route to approval go in the " +
      "message, or the user learns only that Claude stopped. protected-paths.sh gets one pattern " +
      "per detected path: a directory entry (ending /) as */<dir>*, a lockfile entry as */<name>. " +
      "format-changed.sh gets one case line per detected formatter and none when nothing was " +
      "detected — it then does nothing.",
  },
  {
    id: "intent",
    stage: "plan",
    title: "intent/ — the home for the artifact chain",
    paths: ["intent/README.md", "intent/TEMPLATE.md"],
    rank: 60,
    template: "intent.md",
    stamps: [
      { path: "intent/README.md", template: "loop/intent-README.md" },
      { path: "intent/TEMPLATE.md", template: "loop/intent.md" },
    ],
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
    stamps: [{ path: ".github/workflows/agent-evals.yml", template: "loop/agent-evals.yml" }],
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
    stamps: [{ path: "bands.yaml", template: "loop/bands.yaml" }],
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
  {
    id: "team-plugin",
    stage: "maintain",
    title: "Cortex for the whole team — its marketplace and plugin in the committed settings",
    paths: [".claude/settings.json"],
    rank: 90,
    template: null,
    // A block merged into a shared file, like the hooks: no `stamps`, and not in the stamp record.
    // Only a team's repo: on one person's `home` or `lab` repo there is nobody to share it with,
    // and a row named there would be noise every run.
    applies: (s) => s.team.team,
    present: (s) => s.sharedPlugin.served,
    when: (s) => s.sharedPlugin.settings !== "unreadable",
    needs: [".claude/settings.json that parses as JSON — Cortex merges into it and never overwrites it"],
    why: (s) => {
      if (s.sharedPlugin.settings === "unreadable") return s.sharedPlugin.problem;
      const who = evidence(s.team.why, "not a team repo (no work profile, no connector)");
      if (s.sharedPlugin.served) return `${who}; both entries are in .claude/settings.json`;
      return `${who}, so every teammate should run the same Cortex; .claude/settings.json lacks ${s.sharedPlugin.missing.join(" and ")}`;
    },
    brief:
      "Merge with `node \"${CLAUDE_PLUGIN_ROOT}/index/cortex-shared-plugin.mjs\" . --write`, never by hand: " +
      "it adds the marketplace (GitHub marinvch/Cortex) and cortex@cortex, keeps every other key, and " +
      "refuses a file that does not parse. Say in the offer what committing it does and does not do: " +
      "once a teammate trusts the folder Claude Code registers the marketplace, and the docs still have " +
      "each teammate install the plugin once — claude plugin install cortex@cortex --scope project. " +
      "Auto-update is a separate yes/no, unticked by default: only a yes adds --auto-update, which sets " +
      "\"autoUpdate\": true so every teammate's Claude Code pulls new Cortex releases in the background.",
  },
];

/**
 * Every whole file a loop row stamps, as `{ path, template, row }`, in rank order. One list, read by
 * the stamp record's adoption (`stamps.mjs`) and pinned to the /cortex skill's table by a test, so
 * "where does /cortex put verifier.md" has one answer.
 */
export const LOOP_STAMPS = [...LOOP_ARTIFACTS]
  .sort((a, b) => a.rank - b.rank || a.id.localeCompare(b.id))
  .flatMap((row) => (row.stamps ?? []).map((s) => ({ ...s, row: row.id })));

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
    if (row.applies && !row.applies(s)) continue;
    const entry = {
      id: row.id,
      stage: row.stage,
      title: row.title,
      paths: row.paths,
      template: row.template,
      why: row.why(s),
      // What the row changes beyond the files in `paths`, or null. A playback lists paths, and a
      // path does not say that a file changes how every later session behaves.
      effect: row.effect ?? null,
      brief: row.brief,
      // Carried on every entry, not only the blocked ones, so a caller rendering a blocked row
      // never has to reach back into LOOP_ARTIFACTS to find out what it is waiting on. "Waiting on
      // an earlier artifact" without naming it is the same failure as dropping the row: the user
      // learns an offer exists and not how to unlock it.
      needs: unmet(row, s),
      // The paths Claude Code will not let an unattended run write. Under `claude -p` a write to
      // .claude/ is refused and no allow rule changes that (core/claude-code.js,
      // permission.protected-path.*), so a headless /cortex that stamped everything else still
      // leaves these rows missing. Carried here so the ritual can tell that apart from a user who
      // declined the row, and say what to allow, instead of reporting a write that never landed.
      protectedWrites: row.paths.filter(protectedClaudePath),
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
