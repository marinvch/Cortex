#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadManifest, buildPlan, formatCommands } from "./lib/setup-plugins.js";
import { initTeamBrain, writeConnector } from "./lib/team.js";
import { addProject, listTeamProjects, removeProject } from "./lib/project-files.js";
import { listProjects } from "./lib/projects.js";
import { stamp } from "../core/date.js";
import { digest } from "./lib/digest.js";
import { catchMeUp, catchUpRepo } from "./lib/catchup.js";
import { repoTop } from "./lib/gitsync.js";
import { openBrain, NoRootError } from "./lib/brain.js";

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

function cmdSetupPlugins(args) {
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
    if (!args.name || !args.repo) throw new Error("usage: ai-os team init --name <team> --repo <git-url> [--projects a,b]");
    const projects = typeof args.projects === "string" ? args.projects.split(",").map((s) => s.trim()).filter(Boolean) : [];
    const { dir, pushed, error } = initTeamBrain(root, {
      name: args.name, repo: args.repo, projects, outwardSync: brain.policy.outwardSync,
    });
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
    // The project file first, the connector last. A refusal — an invalid field, an employer-shaped
    // link on a profile that refuses it, a credential — throws out of here, so a repo that may not
    // be registered is not half-joined either.
    const fields = {};
    for (const [flag, key] of Object.entries(PROJECT_FIELD_FLAGS)) {
      if (args[flag] === undefined) continue;
      if (args[flag] === true) throw new Error(`--${flag} needs a value\n${TEAM_ADD_USAGE}`);
      fields[key] = args[flag];
    }
    const { dir, cloned, file } = addProject(root, {
      team: args.name, teamRepo: args.repo, project, cwd: process.cwd(), today: stamp(), policy: brain.policy, fields,
    });
    console.log(describeProjectFile(file, brain));
    for (const w of file.warnings) console.log(`  warning: ${w.msg}`);
    const conn = writeConnector(process.cwd(), { team: args.name, project, teamBrainRepo: args.repo });
    console.log(`Team-brain ${cloned ? "cloned to" : "already at"} ${dir}. Wrote ${conn}.`);
    console.log("Next: commit the connector into THIS repo →  git add .cortex/connector.json");
    return 0;
  }
  throw new Error("usage: ai-os team init|add ...");
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
    throw new Error("`ai-os project` reads the team-brain clone under a vault, and AI_OS_ROOT points at a repo's .cortex/. Set AI_OS_ROOT to your vault.");
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
    const { projects, skipped } = listTeamProjects(brain.root, { team, policy: brain.policy });
    let failed = 0;
    for (const p of projects) {
      if (p.unregistered) { console.log(`${p.slug}: unregistered — a notes folder with no project file`); continue; }
      if (p.withheld) { failed++; console.log(`${p.slug}: withheld on profile ${brain.profile} — ${p.withheld}. It belongs in a work install; nothing was changed.`); continue; }
      console.log(`${p.slug}: ${p.errors.length ? "INVALID" : "ok"}`);
      for (const e of p.errors) { failed++; console.log(`  error ${p.slug}.md:${e.line}: ${e.msg}`); }
      for (const w of p.warnings) console.log(`  warning ${p.slug}.md:${w.line}: ${w.msg}`);
    }
    console.log(`${projects.length} listed, ${skipped} other .md skipped, ${failed} problem${failed === 1 ? "" : "s"}.`);
    return failed ? 1 : 0;
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

// Two sources, and either may be absent. The REPO — the git work tree the cwd sits in, its
// committed `.cortex/memory/` and its log — is what a plugin install has, because a plugin install
// has no vault. The VAULT — notes and a team-brain clone — is what AI_OS_ROOT points at, when it is
// set to one. This command used to demand the vault and read no repo at all, so on a plugin install
// `/catch-me-up` failed on its first command in exactly the place it is most often run.
//
// A missing root is a degradation here, not a guess: nothing is read from a vault that was not
// named, nothing is written anywhere, and `skipped` says which half is missing so an empty result
// cannot pass for a quiet week.
function cmdCatchUp(args, brain) {
  if (!args.since || args.since === true) throw new Error(CATCH_UP_USAGE);
  const cwd = process.cwd();
  // A repo-mode root IS a repo's `.cortex/`, so its repo is the directory above it, whatever the cwd.
  const repoDir = brain?.isRepo ? dirname(resolve(brain.root)) : repoTop(cwd);
  // In vault mode, a cwd inside the vault's own checkout is not a repo to catch up on — its log is
  // the vault's notes arriving, which the notes half already reports.
  const isTheVault = brain && !brain.isRepo && repoDir && samePath(repoDir, brain.root);
  const repo = repoDir && !isTheVault ? catchUpRepo(repoDir, { since: args.since }) : null;

  if (!brain) {
    if (!repo) {
      throw new Error(
        "catch-up found nothing to read: the current directory is not inside a git repository and AI_OS_ROOT is not set. " +
        "Run it from the repo to catch up on, or set AI_OS_ROOT to your vault.",
      );
    }
    console.log(JSON.stringify({
      repo, notes: [], commits: [],
      skipped: "vault notes and team-brain history — AI_OS_ROOT is not set, so only this repo was read",
    }, null, 2));
    return 0;
  }

  const project = args.project && args.project !== true
    ? args.project
    : (brain.project ?? (repoDir ? basename(repoDir) : null));
  if (!project) throw new Error(CATCH_UP_USAGE);
  // The team comes from the resolution, exactly as it does in server.js. `--team` survives as an
  // explicit override, never as the switch that turns team mode on: this command used to pass
  // `args.team` alone, so run inside a repo with a `.cortex/connector.json` it consulted no
  // connector, reached no team clone, and printed `commits: []` as a success.
  const team = args.team ?? brain.team ?? undefined;
  const res = catchMeUp(brain.root, { project, since: args.since, team });
  console.log(JSON.stringify({ ...(repo ? { repo } : {}), ...res }, null, 2));
  return 0;
}

function samePath(a, b) {
  const norm = (p) => resolve(p).replace(/[\\/]+$/, "");
  return WIN ? norm(a).toLowerCase() === norm(b).toLowerCase() : norm(a) === norm(b);
}

/**
 * Open the brain for the commands that talk to one — root, mode, audience, team clone and profile
 * together, at entry, before the command picks a branch. The same module `server.js` opens, so the
 * two adapters cannot resolve the same inputs differently (lib/brain.js).
 *
 * `setup-plugins` and `digest` are deliberately not here: neither reads the brain, and demanding
 * AI_OS_ROOT to install plugins would be a new requirement, not a fix.
 */
function open(what, { rootOptional = false } = {}) {
  try {
    return openBrain({ cwd: process.cwd(), env: process.env });
  } catch (e) {
    // Only a command that writes nothing and reads no vault it was not given may go on without a
    // root — today that is `catch-up` alone. The profile was settled before this error was thrown
    // (lib/brain.js), so a misspelt CORTEX_PROFILE still fails here rather than riding along.
    if (e instanceof NoRootError && rootOptional) return null;
    if (e instanceof NoRootError) throw new Error(`AI_OS_ROOT is not set (required for ${what})`);
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
    default:
      console.error("usage: ai-os <setup-plugins|team|project|digest|catch-up> [--flags]");
      process.exit(sub ? 1 : 2);
  }
} catch (e) {
  console.error(`error: ${e.message}`);
  process.exit(1);
}
