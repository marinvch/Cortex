#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadManifest, buildPlan, formatCommands } from "./lib/setup-plugins.js";
import { initTeamBrain, cloneTeamBrain, writeConnector } from "./lib/team.js";
import { digest } from "./lib/digest.js";
import { catchMeUp } from "./lib/catchup.js";
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
    if (!args.name || !args.repo || !args.slug) throw new Error("usage: ai-os team add --name <team> --repo <git-url> --slug <project-slug>");
    const { dir, cloned } = cloneTeamBrain(root, args.name, args.repo);
    const conn = writeConnector(process.cwd(), args.slug, args.repo);
    console.log(`Team-brain ${cloned ? "cloned to" : "already at"} ${dir}. Wrote ${conn}.`);
    console.log("Next: commit the connector into THIS repo →  git add .cortex/connector.json");
    return 0;
  }
  throw new Error("usage: ai-os team init|add ...");
}

function cmdDigest(args) {
  if (!args.repo || !args.since || !args.out) {
    throw new Error("usage: ai-os digest --repo <path> --since <YYYY-MM-DD> --out <file>");
  }
  const out = digest(args.repo, args.since, args.out);
  console.log(`Digest appended to ${out}.`);
  return 0;
}

function cmdCatchUp(args, brain) {
  if (!args.project || !args.since) throw new Error("usage: ai-os catch-up --project <slug> --since <YYYY-MM-DD> [--team <name>]");
  // The team comes from the resolution, exactly as it does in server.js. `--team` survives as an
  // explicit override, never as the switch that turns team mode on: this command used to pass
  // `args.team` alone, so run inside a repo with a `.cortex/connector.json` it consulted no
  // connector, reached no team clone, and printed `commits: []` as a success.
  const team = args.team ?? brain.team ?? undefined;
  const res = catchMeUp(brain.root, { project: args.project, since: args.since, team });
  console.log(JSON.stringify(res, null, 2));
  return 0;
}

/**
 * Open the brain for the commands that talk to one — root, mode, audience, team clone and profile
 * together, at entry, before the command picks a branch. The same module `server.js` opens, so the
 * two adapters cannot resolve the same inputs differently (lib/brain.js).
 *
 * `setup-plugins` and `digest` are deliberately not here: neither reads the brain, and demanding
 * AI_OS_ROOT to install plugins would be a new requirement, not a fix.
 */
function open(what) {
  try {
    return openBrain({ cwd: process.cwd(), env: process.env });
  } catch (e) {
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
    case "digest":
      process.exit(cmdDigest(args));
    case "catch-up":
      process.exit(cmdCatchUp(args, open("catch-up")));
    default:
      console.error("usage: ai-os <setup-plugins|team|digest|catch-up> [--flags]");
      process.exit(sub ? 1 : 2);
  }
} catch (e) {
  console.error(`error: ${e.message}`);
  process.exit(1);
}
