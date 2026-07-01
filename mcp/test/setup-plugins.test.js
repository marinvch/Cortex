import { test } from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildPlan, formatCommands, loadManifest } from "../lib/setup-plugins.js";

const manifest = {
  marketplaces: {
    "claude-plugins-official": { source: { source: "github", repo: "anthropics/claude-plugins-official" } },
    "cloudflare": { source: { source: "github", repo: "cloudflare/skills" } },
  },
  tiers: { core: ["superpowers", "skill-creator"], platform: ["vercel", "cloudflare@cloudflare"] },
  defaultMarketplace: "claude-plugins-official",
};

test("buildPlan adds default marketplace once and installs each plugin", () => {
  const plan = buildPlan(manifest, "core", "user");
  assert.deepEqual(plan.marketplaceAdds, [["plugin", "marketplace", "add", "anthropics/claude-plugins-official"]]);
  assert.deepEqual(plan.installs, [
    ["plugin", "install", "superpowers@claude-plugins-official", "--scope", "user"],
    ["plugin", "install", "skill-creator@claude-plugins-official", "--scope", "user"],
  ]);
});

test("buildPlan handles explicit name@marketplace and dedups marketplace adds", () => {
  const plan = buildPlan(manifest, "platform", "user");
  assert.deepEqual(plan.marketplaceAdds, [
    ["plugin", "marketplace", "add", "anthropics/claude-plugins-official"],
    ["plugin", "marketplace", "add", "cloudflare/skills"],
  ]);
  assert.deepEqual(plan.installs, [
    ["plugin", "install", "vercel@claude-plugins-official", "--scope", "user"],
    ["plugin", "install", "cloudflare@cloudflare", "--scope", "user"],
  ]);
});

test("unknown tier throws", () => {
  assert.throws(() => buildPlan(manifest, "nope"), /unknown tier/);
});

test("undeclared marketplace throws", () => {
  const bad = { marketplaces: {}, tiers: { x: ["p@ghost"] }, defaultMarketplace: "ghost" };
  assert.throws(() => buildPlan(bad, "x"), /marketplace not declared/);
});

test("formatCommands prefixes claude", () => {
  const cmds = formatCommands(buildPlan(manifest, "core"));
  assert.equal(cmds[0], "claude plugin marketplace add anthropics/claude-plugins-official");
  assert.ok(cmds.includes("claude plugin install superpowers@claude-plugins-official --scope user"));
});

test("every tier in the committed manifest resolves without throwing", () => {
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const real = loadManifest(repoRoot);
  for (const tier of Object.keys(real.tiers)) {
    assert.doesNotThrow(() => buildPlan(real, tier, "user"), `tier ${tier} should resolve`);
  }
});
