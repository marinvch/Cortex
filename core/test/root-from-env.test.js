// Which variable names the root, and what happens when two do.
//
// `CORTEX_ROOT` is the name. `AI_OS_ROOT` is the name every install made before #552 carries in its
// MCP registration, so it stays read. The rule that orders the two is written once, in
// `rootFromEnv`, because the mistake it prevents is a second reader deciding the order for itself:
// one adapter taking the new name first and another the old one opens two different brains from
// one environment.
//
// The environment is always passed in. Nothing here reads `process.env`, so a root set in the shell
// that runs the suite cannot move a result.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { rootFromEnv, ROOT_VAR, LEGACY_ROOT_VAR } from "../paths.js";

const CORE = join(dirname(fileURLToPath(import.meta.url)), "..");

test("the two names are the ones documented", () => {
  assert.equal(ROOT_VAR, "CORTEX_ROOT");
  assert.equal(LEGACY_ROOT_VAR, "AI_OS_ROOT");
});

test("only CORTEX_ROOT set: that is the root", () => {
  assert.deepEqual(rootFromEnv({ CORTEX_ROOT: "/v" }), { root: "/v", variable: "CORTEX_ROOT", ignored: null });
});

test("only AI_OS_ROOT set: an existing install keeps working", () => {
  assert.deepEqual(rootFromEnv({ AI_OS_ROOT: "/v" }), { root: "/v", variable: "AI_OS_ROOT", ignored: null });
});

test("both set to the same path: nothing is ignored, and the new name is the one reported", () => {
  assert.deepEqual(rootFromEnv({ CORTEX_ROOT: "/v", AI_OS_ROOT: "/v" }), { root: "/v", variable: "CORTEX_ROOT", ignored: null });
});

test("both set and different: CORTEX_ROOT wins and the loser is named", () => {
  assert.deepEqual(
    rootFromEnv({ CORTEX_ROOT: "/new", AI_OS_ROOT: "/old" }),
    { root: "/new", variable: "CORTEX_ROOT", ignored: "/old" },
  );
});

test("neither set: no root, and nothing is invented", () => {
  assert.deepEqual(rootFromEnv({}), { root: null, variable: null, ignored: null });
  assert.deepEqual(rootFromEnv(undefined), { root: null, variable: null, ignored: null });
});

test("an empty or blank value counts as unset, under either name", () => {
  assert.equal(rootFromEnv({ CORTEX_ROOT: "" }).root, null);
  assert.equal(rootFromEnv({ CORTEX_ROOT: "   " }).root, null);
  assert.equal(rootFromEnv({ AI_OS_ROOT: "" }).root, null);
  assert.equal(rootFromEnv({ AI_OS_ROOT: " \t" }).root, null);
  assert.equal(rootFromEnv({ CORTEX_ROOT: "", AI_OS_ROOT: "" }).root, null);
});

test("an empty CORTEX_ROOT falls back to AI_OS_ROOT rather than shadowing it", () => {
  assert.deepEqual(rootFromEnv({ CORTEX_ROOT: "", AI_OS_ROOT: "/old" }), { root: "/old", variable: "AI_OS_ROOT", ignored: null });
  assert.deepEqual(rootFromEnv({ CORTEX_ROOT: "  ", AI_OS_ROOT: "/old" }), { root: "/old", variable: "AI_OS_ROOT", ignored: null });
});

test("an empty AI_OS_ROOT beside a set CORTEX_ROOT is not a conflict", () => {
  assert.deepEqual(rootFromEnv({ CORTEX_ROOT: "/new", AI_OS_ROOT: "" }), { root: "/new", variable: "CORTEX_ROOT", ignored: null });
  assert.deepEqual(rootFromEnv({ CORTEX_ROOT: "/new", AI_OS_ROOT: "  " }), { root: "/new", variable: "CORTEX_ROOT", ignored: null });
});

test("surrounding whitespace is not part of the path, and does not make two equal paths differ", () => {
  assert.deepEqual(rootFromEnv({ CORTEX_ROOT: " /v " }), { root: "/v", variable: "CORTEX_ROOT", ignored: null });
  assert.deepEqual(rootFromEnv({ CORTEX_ROOT: "/v", AI_OS_ROOT: " /v " }), { root: "/v", variable: "CORTEX_ROOT", ignored: null });
});

test("no other variable names a root", () => {
  assert.equal(rootFromEnv({ CORTEX_PROFILE: "work", CORTEX_AUDIENCE: "server", BRAIN_DIR: "/b", ROOT: "/r" }).root, null);
});

test("the rule has one home in core/: only paths.js names either variable in code", () => {
  // `core/profile.js` in particular: it reads CORTEX_PROFILE and nothing about the root (ADR 0015).
  const code = (file) =>
    readFileSync(join(CORE, file), "utf8")
      .split("\n")
      .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*") && !l.trim().startsWith("/*"))
      .join("\n");
  const offenders = readdirSync(CORE)
    .filter((f) => f.endsWith(".js") && f !== "paths.js")
    .filter((f) => /CORTEX_ROOT|AI_OS_ROOT/.test(code(f)));
  assert.deepEqual(offenders, []);
});
