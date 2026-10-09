import { readFileSync } from "node:fs";
import { join } from "node:path";
import { installedHere } from "../../core/plugin-registry.js";

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

/**
 * Which plugins of each tier are already installed, from a registry `core/plugin-registry.js` read.
 *
 * A tier is `installed` (every plugin), `partial`, `missing` (none) or `unknown`. `unknown` is what
 * a registry that was not read gives: each plugin's `installed` is then `null`, never `false`,
 * because "nobody can say" must not read as "not there". It computes and reads nothing itself, so a
 * test hands in the registry. `tier` limits the answer to one tier; `cwd` is where a project-scoped
 * install has to apply.
 */
export function tierStatus(manifest, registry, { tier = null, cwd = process.cwd() } = {}) {
  if (tier !== null && !manifest.tiers[tier]) throw new Error(`unknown tier: ${tier}`);
  const known = registry.state === "read";
  const tiers = Object.keys(manifest.tiers)
    .filter((t) => tier === null || t === tier)
    .map((t) => {
      const plugins = manifest.tiers[t].map((entry) => {
        const { name, marketplace } = parseEntry(entry, manifest.defaultMarketplace);
        return { plugin: `${name}@${marketplace}`, installed: known ? installedHere(registry.plugins, name, cwd) : null };
      });
      const have = plugins.filter((p) => p.installed).length;
      const state = !known ? "unknown" : have === plugins.length ? "installed" : have === 0 ? "missing" : "partial";
      return { tier: t, state, plugins };
    });
  return { registry: registry.state, tiers };
}

/** The status as lines for a person. `dir` is named only when the registry there was not read. */
export function formatStatus(status, dir = "") {
  const lines = [];
  if (status.registry !== "read") {
    const what = status.registry === "absent" ? "No plugin registry" : "The plugin registry could not be read";
    lines.push(`${what}${dir ? ` in ${dir}` : ""}: which plugins are installed is unknown.`);
  }
  const word = (installed) => (installed === null ? "unknown" : installed ? "installed" : "not installed");
  for (const t of status.tiers) {
    lines.push(`${t.tier.padEnd(12)} ${t.state}`);
    for (const p of t.plugins) lines.push(`  ${p.plugin.padEnd(48)} ${word(p.installed)}`);
  }
  return lines;
}

export function formatCommands(plan) {
  return [...plan.marketplaceAdds, ...plan.installs].map((args) => "claude " + args.join(" "));
}
