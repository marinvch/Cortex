// The parser add-on's installer (tools/cortex-parsers.mjs): the tar reader's guards, the integrity
// check, the destination check, the atomic install and the delete. No test touches the network:
// tarballs are built here, and the one real download path is served by a loopback http server.

import { tempDir } from "./tmp.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import http from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import {
  checkUrl, fetchBytes, install, integrityOf, LOCK_PATH, ParserInstallRefused, readTar, remove, status, tarballUrl,
  unsafeTarName,
} from "../../tools/cortex-parsers.mjs";
import { lockDigest, parsersHome, readLock } from "../../core/parser-lock.js";
import { policyFor } from "../../core/profile.js";
import { DestinationRefusedError } from "../../core/destinations.js";

const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "tools", "cortex-parsers.mjs");
const sha256 = (b) => createHash("sha256").update(b).digest("hex");
const HOME_POLICY = policyFor("home");

// --- building tarballs ------------------------------------------------------------------------

/** One 512-byte ustar header. */
function header({ name, size = 0, type = "0", linkname = "", prefix = "" }) {
  const h = Buffer.alloc(512);
  const put = (s, off, len) => h.write(s, off, Math.min(Buffer.byteLength(s), len), "utf8");
  put(name, 0, 100);
  put("0000644\0", 100, 8);
  put("0000000\0", 108, 8);
  put("0000000\0", 116, 8);
  put(`${size.toString(8).padStart(11, "0")}\0`, 124, 12);
  put("00000000000\0", 136, 12);
  h.fill(0x20, 148, 156);
  h[156] = type.charCodeAt(0);
  put(linkname, 157, 100);
  put("ustar\0", 257, 6);
  put("00", 263, 2);
  put(prefix, 345, 155);
  let sum = 0;
  for (const b of h) sum += b;
  put(`${sum.toString(8).padStart(6, "0")}\0 `, 148, 8);
  return h;
}

const pad = (b) => Buffer.concat([b, Buffer.alloc((512 - (b.length % 512)) % 512)]);

/** A tar archive from `[{ name, body, type, linkname, prefix, pax }]`. */
function tarOf(entries) {
  const parts = [];
  for (const e of entries) {
    const body = Buffer.from(e.body ?? "");
    if (e.pax) {
      const rec = (k, v) => {
        const s = ` ${k}=${v}\n`;
        let len = s.length + 1;
        while (String(len).length + s.length !== len) len = String(len).length + s.length;
        return `${len}${s}`;
      };
      const paxBody = Buffer.from(rec("path", e.pax));
      parts.push(header({ name: "PaxHeader", size: paxBody.length, type: "x" }), pad(paxBody));
    }
    if (e.longname) {
      const ln = Buffer.from(`${e.longname}\0`);
      parts.push(header({ name: "././@LongLink", size: ln.length, type: "L" }), pad(ln));
    }
    parts.push(header({ name: e.name ?? "", size: body.length, type: e.type ?? "0", linkname: e.linkname ?? "", prefix: e.prefix ?? "" }));
    if (body.length) parts.push(pad(body));
  }
  parts.push(Buffer.alloc(1024));
  return Buffer.concat(parts);
}

const FILES = { "package/rt.js": "export const x = 1;\n", "package/rt.wasm": "wasm-bytes", "package/js.wasm": "grammar-bytes" };

/** A one-package lock and its tarball, with integrity and file hashes that agree. */
function fixture({ entries = null } = {}) {
  const tgz = gzipSync(tarOf(entries ?? [
    { name: "package/", type: "5" },
    ...Object.entries(FILES).map(([name, body]) => ({ name, body })),
    { name: "package/README.md", body: "not installed" },
  ]));
  const lock = {
    format: 1,
    registry: "https://registry.npmjs.org/",
    runtime: { package: "rt", module: "package/rt.js", wasm: "package/rt.wasm" },
    grammars: { javascript: { package: "rt", wasm: "package/js.wasm" } },
    packages: [{
      name: "rt",
      version: "1.0.0",
      tarball: "https://registry.npmjs.org/rt/-/rt-1.0.0.tgz",
      integrity: integrityOf(tgz),
      files: Object.entries(FILES).map(([path, body]) => ({ path, sha256: sha256(body) })),
    }],
  };
  return { lock, digest: lockDigest(lock), tgz };
}

const homeEnv = () => {
  const home = tempDir("cortex-parsers-home-");
  return { home, env: { HOME: home, USERPROFILE: home } };
};

/** Everything under a directory, as sorted relative paths. */
function tree(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  const walk = (d, rel) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      out.push(r);
      if (e.isDirectory()) walk(join(d, e.name), r);
    }
  };
  walk(dir, "");
  return out.sort();
}

// --- the tar reader ---------------------------------------------------------------------------

test("the tar reader returns regular files, by ustar prefix, pax path or long name", () => {
  const entries = readTar(tarOf([
    { name: "package/", type: "5" },
    { name: "a.js", prefix: "package/deep", body: "A" },
    { name: "short", pax: "package/from-pax.js", body: "P" },
    { name: "short2", longname: "package/from-longname.js", body: "L" },
    { name: "global", type: "g", body: "" },
    { name: "package/plain.js", body: "X" },
  ]));
  assert.deepEqual(entries.map((e) => [e.name, e.body.toString()]), [
    ["package/deep/a.js", "A"],
    ["package/from-pax.js", "P"],
    ["package/from-longname.js", "L"],
    ["package/plain.js", "X"],
  ]);
});

test("the tar reader refuses the whole archive on any unsafe entry, wanted or not", () => {
  const refused = [
    ["a `..` segment", [{ name: "package/../../evil.js", body: "x" }], /`\.\.` segment/],
    ["an absolute path", [{ name: "/etc/evil", body: "x" }], /absolute path/],
    ["a backslash", [{ name: "package\\..\\evil", body: "x" }], /backslash/],
    ["a drive letter", [{ name: "C:/evil", body: "x" }], /drive letter/],
    ["a pax path that climbs", [{ name: "ok", pax: "package/../../evil", body: "x" }], /`\.\.` segment/],
    ["a long name that climbs", [{ name: "ok", longname: "../evil", body: "x" }], /`\.\.` segment/],
    ["a symbolic link", [{ name: "package/link", type: "2", linkname: "/etc/passwd" }], /symbolic link/],
    ["a hard link", [{ name: "package/hard", type: "1", linkname: "package/rt.js" }], /hard link/],
    ["a device", [{ name: "package/dev", type: "3" }], /type "3"/],
  ];
  for (const [what, entries, re] of refused) {
    assert.throws(() => readTar(tarOf([{ name: "package/fine.js", body: "ok" }, ...entries])), (e) => e instanceof ParserInstallRefused && e.code === "tar" && re.test(e.message), what);
  }
  const bad = tarOf([{ name: "package/a.js", body: "x" }]);
  bad[0] ^= 1; // the name changes, the stored checksum does not
  assert.throws(() => readTar(bad), /checksum/);
  const truncated = tarOf([{ name: "package/a.js", body: "x".repeat(2000) }]).subarray(0, 1024);
  assert.throws(() => readTar(truncated), /truncated/);
  assert.equal(unsafeTarName("package/ok.js"), null);
});

// --- install ----------------------------------------------------------------------------------

test("install verifies, unpacks only the locked files, and leaves nothing else behind", async () => {
  const { lock, digest, tgz } = fixture();
  const { home, env } = homeEnv();
  const fetched = [];
  const r = await install({ lock, digest, env, policy: HOME_POLICY, fetch: async (url) => (fetched.push(url), tgz) });
  assert.deepEqual(fetched, ["https://registry.npmjs.org/rt/-/rt-1.0.0.tgz"]);
  assert.equal(r.dir, join(parsersHome({ env }), digest));
  assert.deepEqual(tree(home), [".cortex", ".cortex/parsers", `.cortex/parsers/${digest}`, `.cortex/parsers/${digest}/rt`,
    `.cortex/parsers/${digest}/rt/js.wasm`, `.cortex/parsers/${digest}/rt/rt.js`, `.cortex/parsers/${digest}/rt/rt.wasm`]);
  assert.equal(readFileSync(join(r.dir, "rt", "rt.js"), "utf8"), FILES["package/rt.js"]);
  assert.equal(status({ lock, digest, env }).state, "ok");
});

test("a tarball that does not match the lock's integrity is refused, and nothing is written", async () => {
  const { lock, digest, tgz } = fixture();
  const { home, env } = homeEnv();
  const tampered = Buffer.from(tgz);
  tampered[tampered.length - 5] ^= 0xff;
  await assert.rejects(
    install({ lock, digest, env, policy: HOME_POLICY, fetch: async () => tampered }),
    (e) => e instanceof ParserInstallRefused && e.code === "integrity" && /does not match the integrity/.test(e.message),
  );
  assert.deepEqual(tree(home), []);
});

test("a tarball the lock pins is still refused when it carries a `..` entry", async () => {
  // The integrity matches, so only the tar guard stands between this archive and the disk.
  const { lock, digest, tgz } = fixture({
    entries: [...Object.entries(FILES).map(([name, body]) => ({ name, body })), { name: "package/../../../evil.js", body: "pwned" }],
  });
  const { home, env } = homeEnv();
  await assert.rejects(install({ lock, digest, env, policy: HOME_POLICY, fetch: async () => tgz }), /`\.\.` segment/);
  assert.deepEqual(tree(home), []);
  assert.ok(!existsSync(join(home, "..", "evil.js")));
});

test("a file whose bytes differ from the lock's sha256 is refused even when the tarball matches", async () => {
  const { lock, tgz } = fixture();
  lock.packages[0].files[1].sha256 = sha256("something else");
  const { home, env } = homeEnv();
  await assert.rejects(install({ lock, digest: lockDigest(lock), env, policy: HOME_POLICY, fetch: async () => tgz }), /rt\.wasm does not match the lock/);
  assert.deepEqual(tree(home), []);
});

test("a tarball holding a locked path twice is refused, since either copy could be the one unpacked", async () => {
  const { lock, digest, tgz } = fixture({
    entries: [...Object.entries(FILES).map(([name, body]) => ({ name, body })), { name: "package/rt.js", body: FILES["package/rt.js"] }],
  });
  const { home, env } = homeEnv();
  await assert.rejects(install({ lock, digest, env, policy: HOME_POLICY, fetch: async () => tgz }), /more than one package\/rt\.js/);
  assert.deepEqual(tree(home), []);
});

test("a lock naming a path the install could not hold is refused, even when the tarball matches", async () => {
  const odd = { "package/a b.js": "x" };
  const tgz = gzipSync(tarOf(Object.entries(odd).map(([name, body]) => ({ name, body }))));
  const { lock } = fixture();
  lock.packages[0].integrity = integrityOf(tgz);
  lock.packages[0].files = [{ path: "package/a b.js", sha256: sha256("x") }];
  const { home, env } = homeEnv();
  await assert.rejects(install({ lock, digest: lockDigest(lock), env, policy: HOME_POLICY, fetch: async () => tgz }), /unsafe path/);
  assert.deepEqual(tree(home), []);
});

test("a failed reinstall keeps the install that was there", async () => {
  const { lock, digest, tgz } = fixture();
  const { env } = homeEnv();
  await install({ lock, digest, env, policy: HOME_POLICY, fetch: async () => tgz });
  await assert.rejects(install({ lock, digest, env, policy: HOME_POLICY, fetch: async () => Buffer.from("junk") }), /integrity/);
  assert.equal(status({ lock, digest, env }).state, "ok");
  // A successful reinstall replaces it and leaves no temporary directory.
  await install({ lock, digest, env, policy: HOME_POLICY, fetch: async () => tgz });
  assert.deepEqual(readdirSync(parsersHome({ env })), [digest]);
});

// --- where it may fetch from ------------------------------------------------------------------

test("on a work profile the registry must be on the approved list, checked before any request", async () => {
  const { lock, digest, tgz } = fixture();
  const { home, env } = homeEnv();
  let calls = 0;
  const fetch = async () => (calls++, tgz);
  const work = policyFor("work");
  // No list at all: refused, and the message says how to approve it.
  await assert.rejects(install({ lock, digest, env, policy: work, fetch }), (e) =>
    e instanceof DestinationRefusedError && /registry\.npmjs\.org/.test(e.message) && /allowed-destinations/.test(e.message));
  // A list without the registry: refused the same way.
  mkdirSync(join(home, ".cortex"), { recursive: true });
  writeFileSync(join(home, ".cortex", "allowed-destinations"), "git: github.com/acme\nnpm: registry.npmjs.org.evil.example\n");
  await assert.rejects(install({ lock, digest, env, policy: work, fetch }), (e) => e instanceof DestinationRefusedError && /not on the approved list/.test(e.message));
  assert.equal(calls, 0, "nothing was requested");
  assert.ok(!existsSync(join(home, ".cortex", "parsers")));
  // Approved: it installs.
  writeFileSync(join(home, ".cortex", "allowed-destinations"), "npm: registry.npmjs.org\n");
  await install({ lock, digest, env, policy: work, fetch });
  assert.equal(calls, 1);
});

test("a lab profile may fetch, since a download is inbound; plain http and credentials are refused", () => {
  const { env } = homeEnv();
  assert.doesNotThrow(() => checkUrl("https://registry.npmjs.org/rt/-/rt-1.0.0.tgz", { policy: policyFor("lab"), env }));
  assert.throws(() => checkUrl("http://registry.npmjs.org/rt/-/rt-1.0.0.tgz", { policy: HOME_POLICY, env }), /over https/);
  assert.throws(() => checkUrl("https://user:pw@registry.npmjs.org/x.tgz", { policy: HOME_POLICY, env }), /carries a user/);
  assert.doesNotThrow(() => checkUrl("http://127.0.0.1:9/rt.tgz", { policy: policyFor("work"), env }), "loopback is this machine");
  assert.equal(tarballUrl({ tarball: "https://registry.npmjs.org/rt/-/rt-1.0.0.tgz" }, "https://mirror.example/npm/"), "https://mirror.example/npm/rt/-/rt-1.0.0.tgz");
});

// --- a fake registry --------------------------------------------------------------------------

/** A loopback registry serving `routes[path]`; a function value is a handler. */
async function fakeRegistry(routes) {
  const server = http.createServer((req, res) => {
    const r = routes[req.url];
    if (typeof r === "function") return r(req, res);
    if (!r) {
      res.writeHead(404);
      return res.end();
    }
    res.writeHead(200, { "content-type": "application/octet-stream" });
    res.end(r);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { url: `http://127.0.0.1:${server.address().port}/`, close: () => new Promise((r) => server.close(r)) };
}

test("against a fake registry: a clean tarball installs and a tampered one is refused", async () => {
  const { lock, digest, tgz } = fixture();
  const tampered = Buffer.concat([tgz, Buffer.from("trailing")]);
  const reg = await fakeRegistry({ "/rt/-/rt-1.0.0.tgz": tgz, "/bad/rt/-/rt-1.0.0.tgz": tampered });
  try {
    const { env } = homeEnv();
    await assert.rejects(install({ lock, digest, env, policy: HOME_POLICY, registry: `${reg.url}bad/` }), /integrity/);
    assert.equal(status({ lock, digest, env }).state, "absent");
    await install({ lock, digest, env, policy: HOME_POLICY, registry: reg.url });
    assert.equal(status({ lock, digest, env }).state, "ok");
  } finally {
    await reg.close();
  }
});

test("a redirect is checked before it is followed, and a loop ends", async () => {
  const { tgz } = fixture();
  let loops = 0;
  const reg = await fakeRegistry({
    "/moved.tgz": (req, res) => (res.writeHead(302, { location: "/rt.tgz" }), res.end()),
    "/rt.tgz": tgz,
    "/away.tgz": (req, res) => (res.writeHead(302, { location: "http://registry.npmjs.org/rt.tgz" }), res.end()),
    "/loop.tgz": (req, res) => (loops++, res.writeHead(302, { location: "/loop.tgz" }), res.end()),
  });
  try {
    const { env } = homeEnv();
    assert.deepEqual(await fetchBytes(`${reg.url}moved.tgz`, { policy: HOME_POLICY, env }), tgz);
    await assert.rejects(fetchBytes(`${reg.url}away.tgz`, { policy: HOME_POLICY, env }), /over https/);
    await assert.rejects(fetchBytes(`${reg.url}loop.tgz`, { policy: HOME_POLICY, env }), /too many redirects/);
    assert.equal(loops, 4, "the first request and three redirects, then it stops");
    await assert.rejects(fetchBytes(`${reg.url}missing.tgz`, { policy: HOME_POLICY, env }), /answered 404/);
  } finally {
    await reg.close();
  }
});

/** Run the CLI with a scratch home. */
function cli(args, env) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [CLI, ...args], { env: { ...process.env, CORTEX_DESTINATIONS: "", ...env }, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("close", (code) => resolve({ code, out, err }));
  });
}

test("the command refuses a tampered download from a fake registry with exit 2 and writes nothing", async () => {
  const { lock } = readLock(LOCK_PATH);
  // Serve every locked path with bytes that cannot match.
  const routes = {};
  for (const p of lock.packages) routes[new URL(p.tarball).pathname] = Buffer.from("not the package");
  const reg = await fakeRegistry(routes);
  try {
    const { home, env } = homeEnv();
    const r = await cli(["install", "--registry", reg.url], { ...env, CORTEX_PROFILE: "home" });
    assert.equal(r.code, 2, r.err);
    assert.match(r.err, /does not match the integrity in the lock; nothing was installed/);
    assert.deepEqual(tree(home), []);
  } finally {
    await reg.close();
  }
});

test("the command refuses an unapproved registry on a work profile and says how to approve it", async () => {
  const { home, env } = homeEnv();
  const r = await cli(["install"], { ...env, CORTEX_PROFILE: "work" });
  assert.equal(r.code, 2, r.err);
  assert.match(r.err, /refusing to reach registry\.npmjs\.org/);
  assert.match(r.err, /allowed-destinations/);
  assert.deepEqual(tree(home), []);
  const s = await cli(["status"], env);
  assert.equal(s.code, 0);
  assert.match(s.out, /not installed/);
  const bad = await cli(["install", "--force"], env);
  assert.equal(bad.code, 1);
});

test("remove deletes the lock's install directory and nothing beside it", async () => {
  const { lock, digest, tgz } = fixture();
  const { home, env } = homeEnv();
  await install({ lock, digest, env, policy: HOME_POLICY, fetch: async () => tgz });
  mkdirSync(join(parsersHome({ env }), "0123456789abcdef"), { recursive: true });
  writeFileSync(join(home, "keep.txt"), "mine");
  assert.deepEqual(status({ lock, digest, env }).others, ["0123456789abcdef"]);
  assert.equal(remove({ digest, env }), true);
  assert.equal(remove({ digest, env }), false);
  assert.deepEqual(tree(home), [".cortex", ".cortex/parsers", ".cortex/parsers/0123456789abcdef", "keep.txt"]);
});

test("remove never deletes outside the parsers directory, or the directory itself", () => {
  const { home, env } = homeEnv();
  const parsers = parsersHome({ env });
  mkdirSync(parsers, { recursive: true });
  writeFileSync(join(home, "keep.txt"), "mine");
  assert.throws(() => remove({ digest: ".", env }), /parsers directory itself/);
  assert.throws(() => remove({ digest: "..", env }), /escapes/);
  assert.throws(() => remove({ digest: "../../keep.txt", env }), /escapes/);
  // A directory planted where an install belongs, pointing elsewhere. A junction needs no
  // privilege on Windows, and is a plain directory link elsewhere.
  const outside = tempDir("cortex-parsers-outside-");
  writeFileSync(join(outside, "precious.txt"), "keep me");
  symlinkSync(outside, join(parsers, "0123456789abcdef"), "junction");
  assert.throws(() => remove({ digest: "0123456789abcdef", env }), /escapes/);
  assert.equal(readFileSync(join(outside, "precious.txt"), "utf8"), "keep me");
  assert.ok(existsSync(parsers));
  assert.equal(readFileSync(join(home, "keep.txt"), "utf8"), "mine");
});
