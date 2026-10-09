import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "./tmp.js";
import { installedHere, pluginsDir, readRegistry } from "../plugin-registry.js";

// The registry Claude Code keeps of installed plugins, read for two callers: the plugin check
// (`tools/`) and the tier status (`mcp/`). Every test here builds its own directory. None may read
// the registry of the machine it runs on: it would pass on a laptop that has the plugins and fail in CI.

/** A plugins directory holding this registry text; `null` writes no file at all. */
function pluginsWith(text) {
  const dir = join(tempDir("plugin-registry-"), "plugins");
  mkdirSync(dir, { recursive: true });
  if (text !== null) writeFileSync(join(dir, "installed_plugins.json"), text);
  return dir;
}

const registry = (plugins) => JSON.stringify({ version: 2, plugins });

test("the plugins directory is found under the home it is handed", () => {
  assert.equal(pluginsDir(join("some", "home")), join("some", "home", ".claude", "plugins"));
});

test("a registry is read as its keys and their entries", () => {
  const dir = pluginsWith(registry({ "alpha@market": [{ scope: "user", version: "1.0.0" }] }));
  const r = readRegistry(dir);
  assert.equal(r.state, "read");
  assert.deepEqual(r.plugins, { "alpha@market": [{ scope: "user", version: "1.0.0" }] });
});

test("no registry file is absent, never an empty registry", () => {
  // The difference is the whole point: "nothing is installed" is an answer, "nobody can say" is not.
  assert.deepEqual(readRegistry(pluginsWith(null)), { state: "absent", plugins: {} });
  assert.deepEqual(readRegistry(join(tempDir("plugin-registry-"), "no-such-dir")), { state: "absent", plugins: {} });
});

test("a registry that does not parse, or has no plugins map, is unreadable", () => {
  for (const text of ["{ not json", "[]", "null", '{"version":2}', '{"plugins":[]}', '{"plugins":"x"}']) {
    assert.deepEqual(readRegistry(pluginsWith(text)), { state: "unreadable", plugins: {} }, text);
  }
});

test("a key whose value is not a list of entries is dropped, and the rest is kept", () => {
  const dir = pluginsWith(registry({ "alpha@market": "1.0.0", "beta@market": [{ scope: "user" }, null, "x"] }));
  assert.deepEqual(readRegistry(dir).plugins, { "beta@market": [{ scope: "user" }] });
});

test("a plugin installed for the user is installed in every directory", () => {
  const plugins = { "alpha@market": [{ scope: "user" }] };
  assert.equal(installedHere(plugins, "alpha", join("any", "repo")), true);
});

test("the marketplace half of the key does not decide whether a plugin is installed", () => {
  // The same plugin from a fork of the marketplace is still the plugin the person has.
  assert.equal(installedHere({ "alpha@other-market": [{ scope: "user" }] }, "alpha", "x"), true);
  assert.equal(installedHere({ alpha: [{ scope: "user" }] }, "alpha", "x"), true);
});

test("a name is matched whole, never as a prefix", () => {
  const plugins = { "alpha-extra@market": [{ scope: "user" }] };
  assert.equal(installedHere(plugins, "alpha", "x"), false);
});

test("a key with no entries is not installed", () => {
  assert.equal(installedHere({ "alpha@market": [] }, "alpha", "x"), false);
});

test("a plugin installed for one project is installed there and below it, and nowhere else", () => {
  const base = tempDir("plugin-registry-");
  const repo = join(base, "product");
  const other = join(base, "product-two");
  for (const scope of ["project", "local"]) {
    const plugins = { "alpha@market": [{ scope, projectPath: repo }] };
    assert.equal(installedHere(plugins, "alpha", repo), true, scope);
    assert.equal(installedHere(plugins, "alpha", join(repo, "src", "deep")), true, `${scope}, below`);
    assert.equal(installedHere(plugins, "alpha", other), false, `${scope}, a sibling whose name starts the same`);
    assert.equal(installedHere(plugins, "alpha", base), false, `${scope}, above`);
  }
});

test("a project entry with no path, or a scope nobody defined, is not counted as installed here", () => {
  assert.equal(installedHere({ "alpha@market": [{ scope: "project" }] }, "alpha", "x"), false);
  assert.equal(installedHere({ "alpha@market": [{ scope: "elsewhere", projectPath: "x" }] }, "alpha", "x"), false);
});

test("a managed install counts like a user one", () => {
  assert.equal(installedHere({ "alpha@market": [{ scope: "managed" }] }, "alpha", "x"), true);
});

test("one entry that applies is enough among entries that do not", () => {
  const base = tempDir("plugin-registry-");
  const plugins = { "alpha@market": [{ scope: "project", projectPath: join(base, "a") }, { scope: "user" }] };
  assert.equal(installedHere(plugins, "alpha", join(base, "b")), true);
});
