#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadManifest, buildPlan, formatCommands } from "./lib/setup-plugins.js";

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

const [sub, ...rest] = process.argv.slice(2);
const args = parseArgs(rest);
switch (sub) {
  case "setup-plugins":
    process.exit(cmdSetupPlugins(args));
  default:
    console.error("usage: ai-os setup-plugins [--tier core|dev-tools|browser-qa|platform] [--scope user|project|local]");
    process.exit(sub ? 1 : 2);
}
