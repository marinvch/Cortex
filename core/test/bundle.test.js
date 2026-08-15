import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const manifest = JSON.parse(readFileSync(join(REPO_ROOT, "plugins", "cortex-core-plugins.json"), "utf8"));

// Cortex declares other people's plugins, so a name that does not exist fails at install time —
// on a user's machine, not here. This test checks the declarations against the real catalog.
//
// It exists because the claim "there is no Postman plugin in the official marketplace" shipped in
// two files and a commit message. It was made by listing the local plugin CACHE (15 installed
// plugins) instead of the marketplace CATALOG (286). Postman was there all along. Reading a cache
// and calling it a registry is an easy mistake to repeat; this makes the machine check instead.

const OFFICIAL =
  "https://raw.githubusercontent.com/anthropics/claude-plugins-official/main/.claude-plugin/marketplace.json";

async function fetchCatalog() {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(OFFICIAL, { signal: ctrl.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null; // offline, rate-limited, or DNS-blocked — the test skips rather than fails
  } finally {
    clearTimeout(timer);
  }
}

test("the manifest is internally coherent", () => {
  assert.ok(manifest.tiers.core?.length, "there must be a core tier");
  assert.ok(manifest.marketplaces[manifest.defaultMarketplace], "defaultMarketplace must be declared");

  const seen = new Map();
  for (const [tier, entries] of Object.entries(manifest.tiers)) {
    for (const entry of entries) {
      const [name, marketplace] = entry.split("@");
      if (marketplace) {
        assert.ok(
          manifest.marketplaces[marketplace],
          `${entry}: marketplace '${marketplace}' is used but never declared`,
        );
      }
      assert.ok(!seen.has(name), `'${name}' appears in both '${seen.get(name)}' and '${tier}'`);
      seen.set(name, tier);
    }
  }
});

test("every plugin declared against the official marketplace really exists there", async (t) => {
  const catalog = await fetchCatalog();
  if (!catalog) {
    t.skip("official marketplace unreachable — skipping the catalog check");
    return;
  }

  const available = new Set(catalog.plugins.map((p) => p.name));
  assert.ok(available.size > 50, `expected a full catalog, got ${available.size} entries`);

  const missing = [];
  for (const [tier, entries] of Object.entries(manifest.tiers)) {
    for (const entry of entries) {
      const [name, marketplace] = entry.split("@");
      if (marketplace) continue; // declared against a third-party marketplace, not this catalog
      if (!available.has(name)) missing.push(`${tier}: ${name}`);
    }
  }

  assert.deepEqual(
    missing,
    [],
    "these names would fail at install — check the catalog, not the local plugin cache",
  );
});
