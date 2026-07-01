import { readFileSync } from "node:fs";
import { join } from "node:path";

export function loadManifest(repoRoot) {
  return JSON.parse(readFileSync(join(repoRoot, "plugins", "cortex-core-plugins.json"), "utf8"));
}

function parseEntry(entry, defaultMarketplace) {
  const i = entry.indexOf("@");
  if (i === -1) return { name: entry, marketplace: defaultMarketplace };
  return { name: entry.slice(0, i), marketplace: entry.slice(i + 1) };
}

export function buildPlan(manifest, tier, scope = "user") {
  const plugins = manifest.tiers[tier];
  if (!plugins) throw new Error(`unknown tier: ${tier}`);
  const seen = new Set();
  const marketplaceAdds = [];
  const installs = [];
  for (const entry of plugins) {
    const { name, marketplace } = parseEntry(entry, manifest.defaultMarketplace);
    const mp = manifest.marketplaces[marketplace];
    const repo = mp && mp.source && (mp.source.repo || mp.source.url);
    if (!repo) throw new Error(`marketplace not declared: ${marketplace}`);
    if (!seen.has(marketplace)) {
      seen.add(marketplace);
      marketplaceAdds.push(["plugin", "marketplace", "add", repo]);
    }
    installs.push(["plugin", "install", `${name}@${marketplace}`, "--scope", scope]);
  }
  return { marketplaceAdds, installs };
}

export function formatCommands(plan) {
  return [...plan.marketplaceAdds, ...plan.installs].map((args) => "claude " + args.join(" "));
}
