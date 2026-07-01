#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadManifest, buildPlan, formatCommands } from "./lib/setup-plugins.js";
import { initTeamBrain, cloneTeamBrain, writeConnector } from "./lib/team.js";
import { digest } from "./lib/digest.js";
import { catchMeUp } from "./lib/catchup.js";

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

function cmdTeam(teamSub, args) {
  const root = process.env.AI_OS_ROOT;
  if (!root) throw new Error("AI_OS_ROOT is not set (required for team operations)");
  if (teamSub === "init") {
    if (!args.name || !args.repo) throw new Error("usage: ai-os team init --name <team> --repo <git-url> [--projects a,b]");
    const projects = typeof args.projects === "string" ? args.projects.split(",").map((s) => s.trim()).filter(Boolean) : [];
    const dir = initTeamBrain(root, { name: args.name, repo: args.repo, projects });
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

function cmdCatchUp(args) {
  const root = process.env.AI_OS_ROOT;
  if (!root) throw new Error("AI_OS_ROOT is not set (required for catch-up)");
  if (!args.project || !args.since) throw new Error("usage: ai-os catch-up --project <slug> --since <YYYY-MM-DD> [--team <name>]");
  const res = catchMeUp(root, { project: args.project, since: args.since, team: args.team });
  console.log(JSON.stringify(res, null, 2));
  return 0;
}

const [sub, ...rest] = process.argv.slice(2);
const args = parseArgs(rest);
try {
  switch (sub) {
    case "setup-plugins":
      process.exit(cmdSetupPlugins(args));
    case "team":
      process.exit(cmdTeam(rest[0], args));
    case "digest":
      process.exit(cmdDigest(args));
    case "catch-up":
      process.exit(cmdCatchUp(args));
    default:
      console.error("usage: ai-os <setup-plugins|team|digest|catch-up> [--flags]");
      process.exit(sub ? 1 : 2);
  }
} catch (e) {
  console.error(`error: ${e.message}`);
  process.exit(1);
}
