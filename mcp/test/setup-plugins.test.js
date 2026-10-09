import { test } from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildPlan, formatCommands, formatStatus, loadManifest, tierStatus } from "../lib/setup-plugins.js";

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

// --- status: which tiers are already installed (#548, item 11) ------------------------------------
//
// The findings offer a tier from the index alone, because the index may not read the machine. The
// status is the machine's half: it reads the plugin registry and says, per tier, what is there. The
// registry is always handed in here. No test reads the one on the machine it runs on.

const read = (keys) => ({ state: "read", plugins: Object.fromEntries(keys.map((k) => [k, [{ scope: "user" }]])) });
const tierOf = (status, name) => status.tiers.find((t) => t.tier === name);

test("a tier whose plugins are all in the registry is installed", () => {
  const s = tierStatus(manifest, read(["superpowers@claude-plugins-official", "skill-creator@claude-plugins-official"]));
  assert.equal(s.registry, "read");
  assert.deepEqual(tierOf(s, "core"), {
    tier: "core",
    state: "installed",
    plugins: [
      { plugin: "superpowers@claude-plugins-official", installed: true },
      { plugin: "skill-creator@claude-plugins-official", installed: true },
    ],
  });
});

test("a tier with one plugin missing is partial, and says which", () => {
  const t = tierOf(tierStatus(manifest, read(["vercel@claude-plugins-official"])), "platform");
  assert.equal(t.state, "partial");
  assert.deepEqual(t.plugins, [
    { plugin: "vercel@claude-plugins-official", installed: true },
    { plugin: "cloudflare@cloudflare", installed: false },
  ]);
});

test("a tier with nothing installed is missing", () => {
  const t = tierOf(tierStatus(manifest, read([])), "core");
  assert.equal(t.state, "missing");
  assert.deepEqual(t.plugins.map((p) => p.installed), [false, false]);
});

test("every tier of the manifest is reported, in the manifest's order", () => {
  assert.deepEqual(tierStatus(manifest, read([])).tiers.map((t) => t.tier), ["core", "platform"]);
});

test("with no registry, or one that does not parse, every tier is unknown and no plugin is called missing", () => {
  for (const state of ["absent", "unreadable"]) {
    const s = tierStatus(manifest, { state, plugins: {} });
    assert.equal(s.registry, state);
    for (const t of s.tiers) {
      assert.equal(t.state, "unknown", `${state}: ${t.tier}`);
      for (const p of t.plugins) assert.equal(p.installed, null, `${state}: ${p.plugin}`);
    }
  }
});

test("a plugin installed for another project is not installed here", () => {
  const registry = { state: "read", plugins: {
    "superpowers@claude-plugins-official": [{ scope: "project", projectPath: join("work", "one") }],
    "skill-creator@claude-plugins-official": [{ scope: "user" }],
  } };
  assert.equal(tierOf(tierStatus(manifest, registry, { cwd: join("work", "two") }), "core").state, "partial");
  assert.equal(tierOf(tierStatus(manifest, registry, { cwd: join("work", "one") }), "core").state, "installed");
});

test("the status of one tier is that tier alone, and an unknown tier throws", () => {
  assert.deepEqual(tierStatus(manifest, read([]), { tier: "platform" }).tiers.map((t) => t.tier), ["platform"]);
  assert.throws(() => tierStatus(manifest, read([]), { tier: "nope" }), /unknown tier/);
});

test("the printed status names each tier, each plugin and its state", () => {
  const text = formatStatus(tierStatus(manifest, read(["vercel@claude-plugins-official"]))).join("\n");
  assert.match(text, /^platform\s+partial$/m);
  assert.match(text, /^\s+vercel@claude-plugins-official\s+installed$/m);
  assert.match(text, /^\s+cloudflare@cloudflare\s+not installed$/m);
  assert.match(text, /^core\s+missing$/m);
});

test("the printed status of an unknown registry says so first, and calls nothing missing", () => {
  const lines = formatStatus(tierStatus(manifest, { state: "absent", plugins: {} }), "some/plugins");
  assert.match(lines[0], /unknown/);
  assert.match(lines[0], /some\/plugins/);
  assert.doesNotMatch(lines.join("\n"), /not installed|missing/);
  assert.match(lines.join("\n"), /^core\s+unknown$/m);
});
