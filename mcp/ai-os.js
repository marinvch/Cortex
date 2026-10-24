#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadManifest, buildPlan, formatCommands, formatStatus, tierStatus } from "./lib/setup-plugins.js";
import { pluginsDir, readRegistry } from "../core/plugin-registry.js";
import { initTeamBrain } from "./lib/team.js";
import { checkProjects, joinProject, listTeamProjects, removeProject } from "./lib/project-files.js";
import { listProjects } from "./lib/projects.js";
import { stamp } from "../core/date.js";
import { digest } from "./lib/digest.js";
import { CatchUpRefused, catchUp } from "./lib/catchup.js";
import { openBrain, NoRootError } from "./lib/brain.js";
import { askFrom, inboxFrom, answerFrom, memberFrom } from "./lib/asks.js";
import { assertPublishable } from "./lib/tools.js";
import { contractFrom, publishFrom } from "./lib/contract.js";
import { genNoteId } from "./lib/noteid.js";

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url))); // mcp/ai-os.js -> repo root
const WIN = process.platform === "win32";

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      const key = argv[i].slice(2);
      const next = argv[i + 1];
      out[key] = next && !next.startsWith("--") ? (i++, next) : true;
    }
  }
  return out;
}

function claudeAvailable() {
  const r = spawnSync("claude", ["--version"], { stdio: "ignore", shell: WIN });
  return r.status === 0;
}

/**
 * `setup-plugins --status` — which tiers are already installed. Read-only: it reads the bundle
 * manifest and Claude Code's plugin registry, starts no `claude` and installs nothing. The findings
 * offer a tier from the index alone (the index may not read the machine), so this is what a ritual
 * asks before it offers one (#548). `--plugins-dir` is where the registry is looked for.
 */
function cmdPluginStatus(args) {
  // A flag with no value must not fall back to the real registry: a caller that meant another
  // directory would be answered about this machine and never know.
  if (args["plugins-dir"] === true) throw new Error("--plugins-dir needs a directory");
  const dir = args["plugins-dir"] ?? pluginsDir();
  const tier = typeof args.tier === "string" ? args.tier : null;
  const status = tierStatus(loadManifest(REPO_ROOT), readRegistry(dir), { tier, cwd: process.cwd() });
  if (args.json) console.log(JSON.stringify(status, null, 2));
  else for (const line of formatStatus(status, dir)) console.log(line);
  return 0;
}

function cmdSetupPlugins(args) {
  if (args.status) return cmdPluginStatus(args);
  const tier = args.tier || "core";
  const scope = args.scope || "user";
  if (!["user", "project", "local"].includes(scope)) throw new Error(`invalid scope: ${scope} (use user|project|local)`);
  const plan = buildPlan(loadManifest(REPO_ROOT), tier, scope);
  if (!claudeAvailable()) {
    console.log(`# 'claude' CLI not found — run these to install the '${tier}' tier (scope ${scope}):`);
    for (const c of formatCommands(plan)) console.log(c);
    return 0;
  }
  for (const a of [...plan.marketplaceAdds, ...plan.installs]) {
    const r = spawnSync("claude", a, { stdio: "inherit", shell: WIN });
    if (r.status !== 0) console.error(`failed: claude ${a.join(" ")}`);
  }
  console.log(`Done: installed the '${tier}' tier (scope ${scope}).`);
  return 0;
}

// `brain` is opened by the entry switch below, never re-derived here. The CLI is the second adapter
// over these operations and it used to read `process.env.AI_OS_ROOT` raw — the bare variable, with
// no walk up to a `.cortex/` and no connector — while the server resolved a root properly. Two
// adapters over the same operations answering "which root" differently is the seam this closes.
// `init` is the only branch that pushes (lib/team.js:70), and it was the only one that had reached
// for the profile, which is why the asymmetry read as deliberate rather than as a gap.
function cmdTeam(teamSub, args, brain) {
  const root = brain.root;
  if (teamSub === "init") {
    const usage = "usage: ai-os team init --name <team> --repo <git-url> [--projects a,b] [--source <owner/repo|git-url>]";
    if (!args.name || !args.repo || args.source === true) throw new Error(usage);
    const projects = typeof args.projects === "string" ? args.projects.split(",").map((s) => s.trim()).filter(Boolean) : [];
    const source = typeof args.source === "string" ? args.source : null;
    const { dir, pushed, error } = initTeamBrain(root, {
      name: args.name, repo: args.repo, projects, outwardSync: brain.policy.outwardSync, source,
    });
    if (source) console.log(`Cortex source for this team: ${source.trim()} (team.json). Every \`team add\` copies it into the repo's connector.`);
    if (!pushed) {
      console.log(`Team-brain seeded at ${dir}, but NOT pushed: ${error} (profile ${brain.profile}).`);
      return 0;
    }
    console.log(`Team-brain initialized at ${dir} and pushed to ${args.repo}.`);
    return 0;
  }
  if (teamSub === "add") {
    // `--slug` is the old spelling of `--project`, kept so a script written against it still joins.
    // It always meant the project; the connector it wrote was read as the team, which is the bug the
    // two named fields close (lib/team.js).
    const project = args.project ?? args.slug;
    if (!args.name || !args.repo || !project || project === true) throw new Error(TEAM_ADD_USAGE);
    const fields = {};
    for (const [flag, key] of Object.entries(PROJECT_FIELD_FLAGS)) {
      if (args[flag] === undefined) continue;
      if (args[flag] === true) throw new Error(`--${flag} needs a value\n${TEAM_ADD_USAGE}`);
      fields[key] = args[flag];
    }
    // The order (project file, then connector) is `joinProject`'s: a refused join writes no connector.
    const { dir, cloned, file, connector, source } = joinProject(root, {
      team: args.name, teamRepo: args.repo, project, cwd: process.cwd(), today: stamp(), policy: brain.policy, fields,
    });
    console.log(describeProjectFile(file, brain));
    for (const w of file.warnings) console.log(`  warning: ${w.msg}`);
    console.log(`Team-brain ${cloned ? "cloned to" : "already at"} ${dir}. Wrote ${connector}.`);
    if (source) console.log(`The team runs Cortex from ${source}: the connector names it, so /cortex stamps that source here.`);
    console.log("Next: commit the connector into THIS repo →  git add .cortex/connector.json");
    return 0;
  }
  if (teamSub === "member") {
    const list = (flag) => {
      if (args[flag] === undefined) return undefined;
      if (args[flag] === true) throw new Error(`--${flag} needs a value\n${TEAM_MEMBER_USAGE}`);
      return args[flag].split(",").map((s) => s.trim()).filter(Boolean);
    };
    for (const flag of ["handle", "github", "team"]) if (args[flag] === true) throw new Error(`--${flag} needs a value\n${TEAM_MEMBER_USAGE}`);
    const input = { roles: list("roles") ?? [], projects: list("projects") ?? [] };
    if (typeof args.handle === "string") input.handle = args.handle;
    if (typeof args.github === "string") input.github = args.github;
    const res = memberFrom(brain, input, { env: process.env, cwd: process.cwd() }, { team: typeof args.team === "string" ? args.team : null });
    const m = res.member;
    const what = `${m.handle}: roles ${m.roles.join(", ") || "(none)"}; projects ${m.projects.join(", ") || "(none)"}`;
    if (res.action === "unchanged") { console.log(`Member already in team.json as given — ${what}. Nothing to commit.`); return 0; }
    console.log(`Member ${res.action} in team.json — ${what}, ${describePublish(res, brain)}.`);
    return 0;
  }
  throw new Error("usage: ai-os team init|add|member ...");
}

const TEAM_MEMBER_USAGE = "usage: ai-os team member [--handle <handle>] --roles <role,role> [--projects <slug,slug>] [--github <login>] [--team <name>]";

/** How far a write to the team-brain got: committed and pushed, or which step it stopped at. */
function describePublish(res, brain) {
  if (res.pushed) return "committed and pushed";
  if (res.committed) return `committed, but NOT pushed: ${res.error} (profile ${brain.profile})`;
  return `NOT committed: ${res.error ?? "nothing changed"}`;
}

const ASK_USAGE = "usage: ai-os ask --to <role|project> --title <title> --body <text> [--links <url,url>]";
const ANSWER_USAGE = "usage: ai-os answer --id <ask-id> --body <text> [--status answered|decided|wontfix]";

// The CLI half of the ask tools (#620). The gate is the declaration's, the same one the server's
// dispatch applies: what `ask` and `answer` write is pushed to a remote the team pulls.
function cmdAsk(args, brain) {
  for (const k of ["to", "body"]) if (typeof args[k] !== "string") throw new Error(ASK_USAGE);
  if (args.title === true || args.links === true) throw new Error(ASK_USAGE);
  const a = {
    to: args.to,
    content: args.body,
    title: typeof args.title === "string" ? args.title : undefined,
    links: typeof args.links === "string" ? args.links.split(",").map((s) => s.trim()).filter(Boolean) : [],
  };
  assertPublishable("ask", a);
  const res = askFrom(brain, a, { env: process.env, cwd: process.cwd(), id: genNoteId(), today: stamp() });
  console.log(`Ask ${res.id} sent to ${res.toKind} '${res.to}' — ${describePublish(res, brain)}.`);
  console.log(res.path);
  return 0;
}

function cmdInbox(args, brain) {
  const res = inboxFrom(brain, { env: process.env, cwd: process.cwd() });
  if (args.json) { console.log(JSON.stringify(res, null, 2)); return 0; }
  if (!res.pull.ok) console.log(`Pull failed, showing the local clone: ${res.pull.error}`);
  if (res.notice) console.log(res.notice);
  for (const e of res.rosterErrors ?? []) console.log(`team.json: ${e}`);
  console.log(`Waiting for you (${res.waiting.length}):`);
  for (const a of res.waiting) console.log(`  ${a.id}  to ${a.toKind} ${a.to}, from ${a.from || "?"}${a.fromProject ? ` in ${a.fromProject}` : ""} — ${a.title}`);
  console.log(`Sent by you (${res.sent.length}):`);
  for (const a of res.sent) console.log(`  ${a.id}  ${a.status}, to ${a.toKind} ${a.to}, ${a.answers.length} answer${a.answers.length === 1 ? "" : "s"} — ${a.title}`);
  if (res.truncated) console.log("(more than shown; use --json for the text, and answer or close the oldest)");
  return 0;
}

function cmdAnswer(args, brain) {
  if (typeof args.id !== "string" || typeof args.body !== "string" || args.status === true) throw new Error(ANSWER_USAGE);
  const a = { id: args.id, content: args.body, status: typeof args.status === "string" ? args.status : undefined };
  assertPublishable("answer", a);
  const res = answerFrom(brain, a, { env: process.env, cwd: process.cwd(), today: stamp() });
  console.log(`Answered ${res.id} (${res.status}) — ${describePublish(res, brain)}.`);
  return 0;
}

const CONTRACT_USAGE =
  "usage: ai-os contract publish|show|who-calls|list ...\n" +
  "  ai-os contract publish --file <contract.json> [--project <slug>] [--team <name>]\n" +
  "                                                 write projects/<slug>/contract.json + .md; commit, push when changed\n" +
  "  ai-os contract show --project <slug> [--path </items>] [--json]\n" +
  "  ai-os contract who-calls --path <[METHOD] /items> [--json]\n" +
  "  ai-os contract list [--json]";

// The CLI half of contracts (#621). `publish` is the write; its gate is inside `publishContract`,
// the one function that writes, because no tool row publishes a contract. The reads are the
// `contract` tool's, through the same `contractFrom`.
function cmdContract(sub, args, brain) {
  for (const k of ["file", "project", "team", "path"]) if (args[k] === true) throw new Error(`--${k} needs a value\n${CONTRACT_USAGE}`);
  if (sub === "publish") {
    if (typeof args.file !== "string") throw new Error(CONTRACT_USAGE);
    const input = readFileSync(args.file, "utf8");
    const res = publishFrom(brain, { input, project: args.project ?? null, team: args.team ?? null });
    const what = `${res.source}: ${res.serves} served, ${res.calls} called, ${res.events} events`;
    if (res.action === "unchanged") { console.log(`Contract for ${res.project} unchanged (${what}). Nothing to commit.`); return 0; }
    console.log(`Contract for ${res.project} ${res.action} (${what}) — ${describePublish(res, brain)}.`);
    console.log(res.path);
    return 0;
  }
  let res;
  if (sub === "show") {
    if (typeof args.project !== "string") throw new Error(CONTRACT_USAGE);
    res = contractFrom(brain, { project: args.project, path: args.path });
  } else if (sub === "who-calls") {
    if (typeof args.path !== "string") throw new Error(CONTRACT_USAGE);
    res = contractFrom(brain, { calls: args.path });
  } else if (sub === "list") {
    res = contractFrom(brain, {});
  } else {
    throw new Error(CONTRACT_USAGE);
  }
  if (args.json) { console.log(JSON.stringify(res, null, 2)); return 0; }
  if (!res.pull.ok) console.log(`Pull failed, showing the local clone: ${res.pull.error}`);
  const ep = (r) => `${r.method.padEnd(6)} ${r.raw ?? r.path}`;
  if (sub === "list") {
    if (!res.contracts.length) console.log("No project has published a contract yet. /team-add publishes one.");
    for (const c of res.contracts) console.log(c.error ? `  ${c.project}: unreadable — ${c.error}` : `  ${c.project}: ${c.source}, ${c.serves} served, ${c.calls} called, ${c.events} events`);
    return 0;
  }
  if (sub === "show") {
    console.log(`Contract of ${res.project} (source ${res.source})${res.reason ? ` — ${res.reason}` : ""}`);
    console.log(`Serves (${res.serves.length}):`);
    for (const r of res.serves) console.log(`  ${ep(r)}${r.operationId ? `  ${r.operationId}` : ""}${r.response ? ` → ${r.response}` : ""}`);
    console.log(`Calls (${res.calls.length}):`);
    for (const r of res.calls) console.log(`  ${ep(r)}${r.host ? `  on ${r.host}` : ""}`);
    if (res.events.length) console.log(`Events: ${res.events.map((e) => `${e.kind} ${e.name}`).join(", ")}`);
    for (const u of res.unread) console.log(`  not read: ${u.what} — ${u.why}`);
    if (res.truncated) console.log("(more than shown; narrow with --path, or use --json)");
    return 0;
  }
  console.log(`${res.endpoint.method} ${res.endpoint.path} — read ${res.read} contract${res.read === 1 ? "" : "s"}`);
  console.log(`Called by (${res.callers.length}):`);
  for (const c of res.callers) console.log(`  ${c.project}: ${c.calls.map((r) => `${r.method} ${r.path}`).join(", ")}`);
  console.log(`Served by (${res.servedBy.length}):`);
  for (const s of res.servedBy) console.log(`  ${s.project}: ${ep(s)}${s.operationId ? `  ${s.operationId}` : ""}${s.response ? ` → ${s.response}` : ""}`);
  console.log(res.note);
  return 0;
}

const TEAM_ADD_USAGE =
  "usage: ai-os team add --name <team> --repo <git-url> --project <project-slug>\n" +
  "         [--title <text>] [--project-repo <url>] [--tracker <url>] [--design <url>] [--docs <url>] [--related <slug,slug>]";

// The flags that fill a project file, and the frontmatter key each one sets. `--repo` was already
// the team-brain's URL, so the project's own repository is `--project-repo`.
const PROJECT_FIELD_FLAGS = { title: "title", "project-repo": "repo", tracker: "tracker", design: "design", docs: "docs", related: "related" };

/** One line saying what happened to the project file, including the push that did not happen. */
function describeProjectFile(file, brain) {
  if (file.action === "skipped") return `No project file written: ${file.reason}`;
  if (file.action === "unchanged") return `Project file already at ${file.path}${file.status ? ` (${file.status})` : ""}; left as it is.`;
  const did = `Project file ${file.action}: ${file.path}`;
  if (file.pushed) return `${did}, committed and pushed.`;
  if (file.committed) return `${did}, committed, but NOT pushed: ${file.error} (profile ${brain.profile}).`;
  return `${did}, but NOT committed: ${file.error}`;
}

const PROJECT_USAGE =
  "usage: ai-os project list|check|remove ...\n" +
  "  ai-os project list [--team <name>]             every project the brain knows, as JSON\n" +
  "  ai-os project check [--team <name>]            validate the team's project files; exit 1 on any error\n" +
  "  ai-os project remove --project <slug> [--team <name>]\n" +
  "                                                 delete a project file (git rm, commit, push)";

// A workspace is the project files in one team-brain (docs/adr/0024), and the clone lives under
// the vault — so none of this exists in repo mode, where the root is a product repo's `.cortex/`.
// The team is the connector's, exactly as it is for capture and catch-up; `--team` is the override
// for a person standing outside any joined repo.
function cmdProject(projectSub, args, brain) {
  if (!["list", "check", "remove"].includes(projectSub)) throw new Error(PROJECT_USAGE);
  if (brain.isRepo) {
    // The variable that was set, as MissingRootError names it: CORTEX_ROOT, or AI_OS_ROOT on an
    // older registration. That is the line in the user's config to change.
    const v = brain.sources.root;
    throw new Error(`\`ai-os project\` reads the team-brain clone under a vault, and ${v} points at a repo's .cortex/. Set ${v} to your vault.`);
  }
  const team = (typeof args.team === "string" ? args.team : null) ?? brain.team;

  if (projectSub === "list") {
    console.log(JSON.stringify(listProjects(brain.root, { team, policy: brain.policy }), null, 2));
    const skipped = team ? listTeamProjects(brain.root, { team, policy: brain.policy }).skipped : 0;
    if (skipped) console.error(`${skipped} other .md file${skipped === 1 ? "" : "s"} under the team-brain's projects/ ${skipped === 1 ? "is" : "are"} not project files and ${skipped === 1 ? "was" : "were"} skipped.`);
    return 0;
  }

  if (!team) throw new Error(`no team: run this inside a repo joined with \`ai-os team add\`, or pass --team <name>\n${PROJECT_USAGE}`);

  if (projectSub === "check") {
    // What counts as a problem is `checkProjects`'s; this prints its rows.
    const { rows, listed, skipped, problems } = checkProjects(brain.root, { team, policy: brain.policy });
    for (const p of rows) {
      if (p.state === "unregistered") { console.log(`${p.slug}: unregistered — a notes folder with no project file`); continue; }
      if (p.state === "withheld") { console.log(`${p.slug}: withheld on profile ${brain.profile} — ${p.withheld}. It belongs in a work install; nothing was changed.`); continue; }
      console.log(`${p.slug}: ${p.state === "invalid" ? "INVALID" : "ok"}`);
      for (const e of p.errors) console.log(`  error ${p.slug}.md:${e.line}: ${e.msg}`);
      for (const w of p.warnings) console.log(`  warning ${p.slug}.md:${w.line}: ${w.msg}`);
    }
    console.log(`${listed} listed, ${skipped} other .md skipped, ${problems} problem${problems === 1 ? "" : "s"}.`);
    return problems ? 1 : 0;
  }

  const project = args.project;
  if (!project || project === true) throw new Error("usage: ai-os project remove --project <slug> [--team <name>]");
  const res = removeProject(brain.root, { team, project, policy: brain.policy });
  const how = res.pushed ? "committed and pushed"
    : res.committed ? `committed, but NOT pushed: ${res.error} (profile ${brain.profile})`
    : `NOT committed: ${res.error ?? "the file was never tracked"}`;
  console.log(`Removed ${res.path} — ${how}.`);
  console.log("Left as it was:");
  console.log(res.left.notes ? `  - ${res.left.notes} — the project's notes. Memory is never deleted.` : "  - no notes folder for this project");
  for (const slug of res.left.relatedIn) console.log(`  - projects/${slug}.md still names '${project}' in related:. It was not edited; it now validates with a warning.`);
  console.log(`  - ${res.left.connector}`);
  return 0;
}

function cmdDigest(args) {
  if (!args.repo || !args.since || !args.out) {
    throw new Error("usage: ai-os digest --repo <path> --since <YYYY-MM-DD> --out <file>");
  }
  const out = digest(args.repo, args.since, args.out);
  console.log(`Digest appended to ${out}.`);
  return 0;
}

const CATCH_UP_USAGE = "usage: ai-os catch-up --since <YYYY-MM-DD> [--project <slug>] [--team <name>]";

// Which sources are read, which repo and which project is `catchUp`'s (lib/catchup.js). This parses
// the flags, prints the document, and turns a refusal into this command's own words.
function cmdCatchUp(args, brain) {
  if (!args.since || args.since === true) throw new Error(CATCH_UP_USAGE);
  try {
    const res = catchUp({
      brain,
      since: args.since,
      project: args.project && args.project !== true ? args.project : undefined,
      team: args.team,
      cwd: process.cwd(),
    });
    console.log(JSON.stringify(res, null, 2));
    return 0;
  } catch (e) {
    if (e instanceof CatchUpRefused && e.code === "no_project") throw new Error(CATCH_UP_USAGE);
    throw e;
  }
}

/**
 * Open the brain for the commands that talk to one — root, mode, audience, team clone and profile
 * together, at entry, before the command picks a branch. The same module `server.js` opens, so the
 * two adapters cannot resolve the same inputs differently (lib/brain.js).
 *
 * `setup-plugins` and `digest` are deliberately not here: neither reads the brain, and demanding
 * a root to install plugins would be a new requirement, not a fix.
 */
function open(what, { rootOptional = false } = {}) {
  try {
    const brain = openBrain({ cwd: process.cwd(), env: process.env });
    // stderr, as the server does: stdout is what a caller parses.
    for (const line of brain.notices) console.error(line);
    return brain;
  } catch (e) {
    // Only a command that writes nothing and reads no vault it was not given may go on without a
    // root — today that is `catch-up` alone. The profile was settled before this error was thrown
    // (lib/brain.js), so a misspelt CORTEX_PROFILE still fails here rather than riding along.
    if (e instanceof NoRootError && rootOptional) return null;
    if (e instanceof NoRootError) throw new Error(`${e.message} (required for ${what})`);
    throw e; // an unknown CORTEX_PROFILE already says exactly what is wrong
  }
}

const [sub, ...rest] = process.argv.slice(2);
const args = parseArgs(rest);
try {
  switch (sub) {
    case "setup-plugins":
      process.exit(cmdSetupPlugins(args));
    case "team":
      process.exit(cmdTeam(rest[0], args, open("team operations")));
    case "project":
      process.exit(cmdProject(rest[0], args, open("project operations")));
    case "digest":
      process.exit(cmdDigest(args));
    case "catch-up":
      process.exit(cmdCatchUp(args, open("catch-up", { rootOptional: true })));
    case "ask":
      process.exit(cmdAsk(args, open("ask")));
    case "inbox":
      process.exit(cmdInbox(args, open("inbox")));
    case "answer":
      process.exit(cmdAnswer(args, open("answer")));
    case "contract":
      process.exit(cmdContract(rest[0], args, open("contract")));
    default:
      console.error("usage: ai-os <setup-plugins|team|project|digest|catch-up|ask|inbox|answer|contract> [--flags]");
      process.exit(sub ? 1 : 2);
  }
} catch (e) {
  console.error(`error: ${e.message}`);
  process.exit(1);
}
