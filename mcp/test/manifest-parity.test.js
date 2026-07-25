// mcp/test/manifest-parity.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

// tools/cortex-init.sh deliberately hardcodes the Core tier instead of parsing the manifest with
// jq, so the installer keeps working with zero required deps. That duplication is fine — silent
// drift between the two copies is not. This test is the seam that keeps them honest.
test("cortex-init.sh's CORE_PLUGINS matches the committed manifest's core tier", () => {
  const manifest = JSON.parse(
    readFileSync(join(REPO_ROOT, "plugins", "cortex-core-plugins.json"), "utf8"),
  );
  const script = readFileSync(join(REPO_ROOT, "tools", "cortex-init.sh"), "utf8");

  const m = script.match(/^CORE_PLUGINS=\(([^)]*)\)/m);
  assert.ok(m, "tools/cortex-init.sh must declare a CORE_PLUGINS=(...) array");
  const fromScript = m[1].trim().split(/\s+/).filter(Boolean);

  // The manifest may qualify entries as name@marketplace; the bash array holds bare names.
  const fromManifest = manifest.tiers.core.map((e) => e.split("@")[0]);

  assert.deepEqual(
    fromScript,
    fromManifest,
    "update tools/cortex-init.sh CORE_PLUGINS and plugins/cortex-core-plugins.json together",
  );
});

test("the marketplace repo in cortex-init.sh matches the manifest", () => {
  const manifest = JSON.parse(
    readFileSync(join(REPO_ROOT, "plugins", "cortex-core-plugins.json"), "utf8"),
  );
  const script = readFileSync(join(REPO_ROOT, "tools", "cortex-init.sh"), "utf8");

  const nameMatch = script.match(/^PLUGIN_MARKETPLACE="([^"]+)"/m);
  const repoMatch = script.match(/^PLUGIN_MARKETPLACE_REPO="([^"]+)"/m);
  assert.ok(nameMatch && repoMatch, "cortex-init.sh must declare the marketplace name and repo");

  const declared = manifest.marketplaces[nameMatch[1]];
  assert.ok(declared, `manifest must declare the '${nameMatch[1]}' marketplace`);
  assert.equal(declared.source.repo, repoMatch[1]);
});
