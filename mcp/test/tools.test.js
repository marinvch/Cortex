// The tool table is the single statement of mode availability. These tests pin the two things that
// follow from that: the declaration is well-formed, and both derivations — the advertised list and
// the guard — read it. mode.test.js proves the same rule end to end over a spawned server; this
// proves it without the 5s spawn, and catches a bad row at the point it is written.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { TOOL_TABLE, toolsFor, assertAvailable, REPO, VAULT, ANY } from "../lib/tools.js";

const MCP_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");

test("every tool declares a mode, exactly once", () => {
  const seen = new Set();
  for (const t of TOOL_TABLE) {
    assert.ok([REPO, VAULT, ANY].includes(t.mode), `${t.name}: mode must be repo | vault | any, got ${t.mode}`);
    assert.ok(t.description && t.inputSchema, `${t.name}: needs a description and a schema`);
    assert.ok(!seen.has(t.name), `${t.name} is declared twice`);
    seen.add(t.name);
  }
});

test("the advertised list is exactly the tools that run in that mode", () => {
  assert.deepEqual(toolsFor(true).map((t) => t.name).sort(), ["recall", "recall_memory", "remember"]);
  assert.deepEqual(
    toolsFor(false).map((t) => t.name).sort(),
    ["capture", "catch_me_up", "get_project_context", "list_projects", "recall"],
  );
});

test("`mode` is ours and never reaches the client", () => {
  // tools/list sends these descriptors verbatim, so an internal field would ship as protocol.
  for (const descriptor of [...toolsFor(true), ...toolsFor(false)]) {
    assert.deepEqual(Object.keys(descriptor).sort(), ["description", "inputSchema", "name"]);
  }
});

test("the guard refuses a tool whose declared mode does not match", () => {
  // Repo mode: the vault tools are the ones that would write inbox/ into a product repository.
  for (const vaultOnly of ["capture", "catch_me_up", "list_projects", "get_project_context"]) {
    assert.throws(() => assertAvailable(vaultOnly, true), /only available when Cortex is pointed at a vault/, vaultOnly);
    assert.doesNotThrow(() => assertAvailable(vaultOnly, false), vaultOnly);
  }
  for (const repoOnly of ["remember", "recall_memory"]) {
    assert.throws(() => assertAvailable(repoOnly, false), /only available when Cortex is pointed at a repo/, repoOnly);
    assert.doesNotThrow(() => assertAvailable(repoOnly, true), repoOnly);
  }
  assert.doesNotThrow(() => assertAvailable("recall", true));
  assert.doesNotThrow(() => assertAvailable("recall", false));
  assert.throws(() => assertAvailable("rm -rf", true), /unknown tool/);
});

test("every declared tool is wired up in server.js", () => {
  // The table decides what is advertised, so a row with no case would be an offered tool that
  // answers "declared but not implemented" when called.
  const src = readFileSync(join(MCP_DIR, "server.js"), "utf8");
  for (const t of TOOL_TABLE) {
    assert.match(src, new RegExp(`case "${t.name}":`), `${t.name} is declared but server.js has no case for it`);
  }
});
