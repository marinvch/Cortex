import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  canonicalJson, installDir, installedPath, isSafeRelPath, lockDigest, lockProblems, parserName,
  parsersHome, readLock, verifyInstall,
} from "../parser-lock.js";
import { tempDir } from "./tmp.js";

const SHIPPED_LOCK = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "index", "parsers.lock.json");
const sha256 = (s) => createHash("sha256").update(s).digest("hex");
const INTEGRITY = `sha512-${createHash("sha512").update("x").digest("base64")}`;

/** A small valid lock over files whose contents the test controls. */
function lockFor(files) {
  return {
    format: 1,
    registry: "https://registry.npmjs.org/",
    runtime: { package: "rt", module: "package/rt.js", wasm: "package/rt.wasm" },
    grammars: { javascript: { package: "rt", wasm: "package/js.wasm" } },
    packages: [
      {
        name: "rt",
        version: "1.0.0",
        tarball: "https://registry.npmjs.org/rt/-/rt-1.0.0.tgz",
        integrity: INTEGRITY,
        files: Object.entries(files).map(([path, body]) => ({ path, sha256: sha256(body) })),
      },
    ],
  };
}

const FILES = { "package/rt.js": "export {}", "package/rt.wasm": "w", "package/js.wasm": "j" };

test("the shipped lock is valid, and pins exact versions on the npm registry", () => {
  const r = readLock(SHIPPED_LOCK);
  assert.equal(r.problem, undefined, r.problem);
  assert.match(r.digest, /^[0-9a-f]{16}$/);
  for (const p of r.lock.packages) {
    assert.match(p.version, /^\d+\.\d+\.\d+$/);
    assert.ok(p.tarball.startsWith("https://registry.npmjs.org/"));
  }
  assert.deepEqual(Object.keys(r.lock.grammars).sort(), ["go", "java", "javascript", "python", "rust", "tsx", "typescript"]);
});

test("the digest is of the lock's meaning: key order and line endings do not move it", () => {
  const lock = lockFor(FILES);
  const reversed = (v) =>
    Array.isArray(v) ? v.map(reversed)
      : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).reverse().map((k) => [k, reversed(v[k])]))
        : v;
  const shuffled = reversed(lock);
  assert.notEqual(JSON.stringify(shuffled), JSON.stringify(lock));
  assert.equal(lockDigest(lock), lockDigest(shuffled));
  const dir = tempDir("cortex-lock-");
  writeFileSync(join(dir, "lf.json"), JSON.stringify(lock, null, 2));
  writeFileSync(join(dir, "crlf.json"), JSON.stringify(lock, null, 2).replace(/\n/g, "\r\n"));
  assert.equal(readLock(join(dir, "lf.json")).digest, readLock(join(dir, "crlf.json")).digest);
  // …and any change of meaning moves it.
  const bumped = lockFor(FILES);
  bumped.packages[0].version = "1.0.1";
  bumped.packages[0].tarball = "https://registry.npmjs.org/rt/-/rt-1.0.1.tgz";
  assert.notEqual(lockDigest(lock), lockDigest(bumped));
  assert.equal(canonicalJson({ b: 1, a: [2, { d: 3, c: 4 }] }), '{"a":[2,{"c":4,"d":3}],"b":1}');
});

test("a path inside a tarball must be relative, plain and free of dot segments", () => {
  for (const ok of ["package/a.wasm", "package/sub/b.js", "package/LICENSE"]) assert.ok(isSafeRelPath(ok), ok);
  for (const bad of ["", "/abs", "package/../x", "./package/x", "package\\x", "package//x", "package/x\0", "C:/x".replace("/", "\\"), "package/a b"]) {
    assert.ok(!isSafeRelPath(bad), JSON.stringify(bad));
  }
  assert.equal(installedPath({ name: "rt" }, { path: "package/sub/x.js" }), "rt/sub/x.js");
});

test("every rule of the lock is checked, and a valid lock has no problems", () => {
  assert.deepEqual(lockProblems(lockFor(FILES)), []);
  const cases = [
    ["format", (l) => (l.format = 2), /format/],
    ["http registry", (l) => (l.registry = "http://registry.npmjs.org/"), /registry/],
    ["registry with a path", (l) => (l.registry = "https://registry.npmjs.org/x/"), /registry/],
    ["floating version", (l) => (l.packages[0].version = "^1.0.0"), /version/],
    ["integrity not sha512", (l) => (l.packages[0].integrity = "sha1-abc"), /integrity/],
    ["tarball on another host", (l) => (l.packages[0].tarball = "https://evil.example/rt/-/rt-1.0.0.tgz"), /tarball/],
    ["tarball for another version", (l) => (l.packages[0].tarball = "https://registry.npmjs.org/rt/-/rt-9.9.9.tgz"), /tarball/],
    ["a file outside the package", (l) => (l.packages[0].files[0].path = "package/../../x"), /path/],
    ["a file with no directory", (l) => (l.packages[0].files[0].path = "x.js"), /path/],
    ["a file without a sha256", (l) => (l.packages[0].files[0].sha256 = "abc"), /sha256/],
    ["a runtime naming no file", (l) => (l.runtime.module = "package/none.js"), /runtime\.module/],
    ["a grammar naming no package", (l) => (l.grammars.javascript.package = "none"), /grammars\.javascript/],
    ["no packages", (l) => (l.packages = []), /packages/],
  ];
  for (const [name, mutate, re] of cases) {
    const l = lockFor(FILES);
    mutate(l);
    const problems = lockProblems(l);
    assert.ok(problems.some((p) => re.test(p)), `${name}: ${problems.join("; ")}`);
  }
  assert.match(readLock(join(tempDir("cortex-lock-"), "none.json")).problem, /cannot be read/);
});

test("an install is ok only when every file the lock names is there and matches", () => {
  const lock = lockFor(FILES);
  const dir = join(tempDir("cortex-lock-"), "install");
  assert.equal(verifyInstall(dir, lock).state, "absent");
  const write = (rel, body) => {
    const full = join(dir, ...rel.split("/"));
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, body);
  };
  write("rt/rt.js", FILES["package/rt.js"]);
  write("rt/rt.wasm", FILES["package/rt.wasm"]);
  const partial = verifyInstall(dir, lock);
  assert.equal(partial.state, "partial");
  assert.match(partial.problems[0], /rt\/js\.wasm is missing/);
  write("rt/js.wasm", "tampered");
  const mismatch = verifyInstall(dir, lock);
  assert.equal(mismatch.state, "mismatch");
  assert.match(mismatch.problems[0], /rt\/js\.wasm differs/);
  write("rt/js.wasm", FILES["package/js.wasm"]);
  assert.deepEqual(verifyInstall(dir, lock), { state: "ok", problems: [] });
});

test("the install directory is read from HOME, then USERPROFILE, and named by the digest", () => {
  assert.equal(parsersHome({ env: { HOME: "/h", USERPROFILE: "/u" } }), join("/h", ".cortex", "parsers"));
  assert.equal(parsersHome({ env: { HOME: " ", USERPROFILE: "/u" } }), join("/u", ".cortex", "parsers"));
  assert.equal(installDir("abc", { env: { HOME: "/h" } }), join("/h", ".cortex", "parsers", "abc"));
  assert.equal(parserName("abc"), "tree-sitter@abc");
});

test("the lock file is reviewed text: every package carries its license", () => {
  const lock = JSON.parse(readFileSync(SHIPPED_LOCK, "utf8"));
  for (const p of lock.packages) {
    assert.equal(p.license, "MIT", p.name);
    assert.ok(p.files.some((f) => f.path.endsWith("/LICENSE")), `${p.name} installs its LICENSE`);
  }
});
