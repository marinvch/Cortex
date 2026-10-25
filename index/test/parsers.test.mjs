// The add-on's loader (lib/parsers.mjs). CI has no add-on, so an install is built here from a fake
// runtime whose files the lock pins by hash: the loader's checks run for real, and nothing is
// downloaded.

import { tempDir } from "./tmp.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { grammarFor, loadParsers, parserState } from "../lib/parsers.mjs";
import { installDir, installedPath, lockDigest } from "../../core/parser-lock.js";

const sha256 = (s) => createHash("sha256").update(s).digest("hex");
const INTEGRITY = `sha512-${createHash("sha512").update("x").digest("base64")}`;

// A stand-in for the WebAssembly runtime: the same three calls the loader makes.
const FAKE_RUNTIME = `
export class Parser {
  static async init(opts) {
    if (!opts || !opts.wasmBinary) throw new Error("no wasm bytes");
    Parser.runtime = Buffer.from(opts.wasmBinary).toString();
  }
  setLanguage(l) { this.language = l; }
  parse(text) { return { grammar: this.language.name, runtime: Parser.runtime, text, delete() {} }; }
}
export const Language = { async load(bytes) { return { name: Buffer.from(bytes).toString() }; } };
`;
const BROKEN_RUNTIME = "export class Parser { static async init() { throw new Error('boom'); } }\nexport const Language = {};\n";

/** A lock over a fake runtime and two grammars, an install of it under a fresh home, and the env. */
function setup({ runtime = FAKE_RUNTIME, install = true } = {}) {
  const files = {
    "package/rt.js": runtime,
    "package/rt.wasm": "runtime-wasm",
    "package/js.wasm": "javascript",
    "package/py.wasm": "python",
  };
  const lock = {
    format: 1,
    registry: "https://registry.npmjs.org/",
    runtime: { package: "rt", module: "package/rt.js", wasm: "package/rt.wasm" },
    grammars: {
      javascript: { package: "rt", wasm: "package/js.wasm" },
      python: { package: "rt", wasm: "package/py.wasm" },
    },
    packages: [{
      name: "rt",
      version: "1.2.3",
      tarball: "https://registry.npmjs.org/rt/-/rt-1.2.3.tgz",
      integrity: INTEGRITY,
      files: Object.entries(files).map(([path, body]) => ({ path, sha256: sha256(body) })),
    }],
  };
  const home = tempDir("cortex-loader-");
  const env = { HOME: home, USERPROFILE: home };
  const lockPath = join(home, "parsers.lock.json");
  writeFileSync(lockPath, JSON.stringify(lock));
  const digest = lockDigest(lock);
  const dir = installDir(digest, { env });
  const put = (path, body) => {
    const full = join(dir, ...installedPath(lock.packages[0], { path }).split("/"));
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, body);
  };
  if (install) for (const [path, body] of Object.entries(files)) put(path, body);
  return { env, lockPath, digest, dir, put };
}

test("no add-on: the loader returns null and has nothing to say", async () => {
  const { env, lockPath } = setup({ install: false });
  const notes = [];
  assert.equal(await loadParsers({ env, lockPath, onNote: (n) => notes.push(n) }), null);
  assert.deepEqual(notes, []);
  assert.equal(parserState({ env, lockPath }).state, "absent");
});

test("an install that is partial or differs from the lock is not loaded, and says so once", async () => {
  const partial = setup();
  rmSync(join(partial.dir, "rt", "py.wasm"));
  let notes = [];
  assert.equal(await loadParsers({ env: partial.env, lockPath: partial.lockPath, onNote: (n) => notes.push(n) }), null);
  assert.equal(notes.length, 1);
  assert.match(notes[0], /incomplete .*py\.wasm is missing.*cortex-parsers\.mjs install/);

  const changed = setup();
  changed.put("package/js.wasm", "something else");
  notes = [];
  assert.equal(await loadParsers({ env: changed.env, lockPath: changed.lockPath, onNote: (n) => notes.push(n) }), null);
  assert.match(notes[0], /not the one the lock pins .*js\.wasm differs/);
});

test("a lock that cannot be read loads nothing and names the problem", async () => {
  const { env } = setup({ install: false });
  const notes = [];
  assert.equal(await loadParsers({ env, lockPath: join(env.HOME, "none.json"), onNote: (n) => notes.push(n) }), null);
  assert.match(notes[0], /symbols not built: the parser lock .* cannot be read/);
});

test("a whole install loads, from the bytes it checked, and names itself by the lock's digest", async () => {
  const { env, lockPath, digest } = setup();
  const p = await loadParsers({ env, lockPath });
  assert.ok(p);
  assert.equal(p.name, `tree-sitter@${digest}`);
  assert.deepEqual(p.grammars, { javascript: "rt@1.2.3", python: "rt@1.2.3" });
  const tree = p.parse("python", "x = 1");
  assert.deepEqual({ ...tree, delete: undefined }, { grammar: "python", runtime: "runtime-wasm", text: "x = 1", delete: undefined });
  assert.equal(p.parse("rust", "fn main() {}"), null, "a grammar the lock does not pin parses nothing");
  assert.equal(await loadParsers({ env, lockPath }), p, "one load per process");
});

test("a runtime that fails to start is reported, and the index goes on without it", async () => {
  const { env, lockPath } = setup({ runtime: BROKEN_RUNTIME });
  const notes = [];
  assert.equal(await loadParsers({ env, lockPath, onNote: (n) => notes.push(n) }), null);
  assert.match(notes[0], /did not start \(boom\)/);
});

test("a grammar is chosen by extension alone", () => {
  const cases = {
    "a.js": "javascript", "a.mjs": "javascript", "a.cjs": "javascript", "A.JSX": "javascript",
    "a.ts": "typescript", "a.mts": "typescript", "a.cts": "typescript", "a.tsx": "tsx",
    "pkg/a.py": "python", "a.go": null, "Makefile": null, "a.vue": null,
  };
  for (const [path, want] of Object.entries(cases)) assert.equal(grammarFor(path), want, path);
});
