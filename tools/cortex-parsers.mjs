#!/usr/bin/env node
// cortex-parsers.mjs — install, check or remove the parser add-on.
//
//   node tools/cortex-parsers.mjs install [--registry <https origin>]
//   node tools/cortex-parsers.mjs status [--json]
//   node tools/cortex-parsers.mjs remove
//
// The add-on is what lets the index read definitions and calls (index/lib/symbols.mjs): a
// WebAssembly parser runtime and one grammar per language, pinned in index/parsers.lock.json.
// docs/adr/0029 holds the argument for shipping it this way. Cortex is complete without it.
//
// This is the only Cortex command that downloads code, and nothing runs it on its own. The rules:
//
//   - **The host is checked before any request** with `assertDestination(url, { kind: "npm" })`
//     (core/destinations.js), so a work profile without the registry on its approved list refuses
//     and says how to approve it. A download is inbound, so a lab profile allows it. Plain http is
//     refused except to a loopback host, which is what the tests' fake registry is. A redirect is
//     checked again before it is followed.
//   - **Each tarball's sha512 is compared with the lock before anything is unpacked.** One mismatch
//     refuses the whole install and writes nothing.
//   - **The tar reader is written here** (`readTar`), because Cortex has no dependencies. It refuses
//     the whole tarball on an absolute path, a `..` segment, a backslash or a drive letter in any
//     entry, on any link or device entry, on a bad header checksum and on a truncated body. Only the
//     files the lock names are written, each to a path computed from the lock and never from the
//     tarball, and each must match the lock's sha256.
//   - **The install is atomic.** Files go to a temporary directory beside the final one, the result
//     is verified against the lock, and one rename puts it in place. A failed install leaves the
//     previous one, or nothing.
//   - **It writes under `<home>/.cortex/parsers/` and nowhere else.** `remove` deletes the lock's
//     directory only, after `resolveInRoot` (core/paths.js) has confirmed it is inside that root,
//     so a symlink planted there cannot point the delete elsewhere.
//
// Exit codes: 0 done · 2 refused (destination, integrity, tarball) · 1 could not run.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { resolveProfile } from "../core/profile.js";
import { assertDestination, DestinationRefusedError } from "../core/destinations.js";
import { resolveInRoot } from "../core/paths.js";
import {
  installDir, installedPath, isSafeRelPath, parserName, parsersHome, readLock, verifyInstall,
} from "../core/parser-lock.js";

export const LOCK_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "index", "parsers.lock.json");

/** The largest tarball fetched, and the largest it may unpack to. The pinned ones are under 3 MB and 40 MB. */
export const MAX_TARBALL_BYTES = 32 * 1024 * 1024;
export const MAX_UNPACKED_BYTES = 256 * 1024 * 1024;
const MAX_REDIRECTS = 3;

/** A refusal the person can act on. The CLI exits 2 on one; anything else is a failure to run. */
export class ParserInstallRefused extends Error {
  constructor(message, code) {
    super(message);
    this.name = "ParserInstallRefused";
    this.code = code;
  }
}

// --- the tar reader ---------------------------------------------------------------------------

const BLOCK = 512;

/** Why a tar entry name is refused, or null. Checked on every entry, wanted or not. */
export function unsafeTarName(name) {
  if (!name) return "an empty name";
  if (name.includes("\0")) return "a NUL in its name";
  if (name.includes("\\")) return "a backslash in its name";
  if (name.startsWith("/")) return "an absolute path";
  if (/^[A-Za-z]:/.test(name)) return "a drive letter";
  if (name.split("/").some((seg) => seg === "..")) return "a `..` segment";
  return null;
}

const field = (h, start, end) => {
  const raw = h.subarray(start, end);
  const nul = raw.indexOf(0);
  return (nul < 0 ? raw : raw.subarray(0, nul)).toString("utf8");
};

function octal(h, start, end) {
  const s = field(h, start, end).trim();
  if (!s) return 0;
  if (!/^[0-7]+$/.test(s)) throw new ParserInstallRefused("the tarball has a header that is not octal", "tar");
  return parseInt(s, 8);
}

/** A pax record set, `<len> key=value\n` repeated, as a map. Only `path` is used. */
function paxRecords(body) {
  const out = {};
  const text = body.toString("utf8");
  let i = 0;
  while (i < text.length) {
    const sp = text.indexOf(" ", i);
    if (sp < 0) break;
    const len = Number(text.slice(i, sp));
    if (!Number.isInteger(len) || len <= 0) throw new ParserInstallRefused("the tarball has a malformed pax header", "tar");
    const rec = text.slice(sp + 1, i + len - 1);
    const eq = rec.indexOf("=");
    if (eq > 0) out[rec.slice(0, eq)] = rec.slice(eq + 1);
    i += len;
  }
  return out;
}

/**
 * Read an uncompressed tar archive into `[{ name, body }]`, regular files only, in archive order.
 * Throws `ParserInstallRefused` (code `tar`) on anything it will not unpack; see the header.
 */
export function readTar(buf) {
  const out = [];
  let off = 0;
  let nextName = null; // from a pax `path` record or a GNU long name, for the entry that follows
  while (off + BLOCK <= buf.length) {
    const h = buf.subarray(off, off + BLOCK);
    if (h.every((b) => b === 0)) break;
    let sum = 0;
    for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 32 : h[i];
    if (sum !== octal(h, 148, 156)) throw new ParserInstallRefused("the tarball has a header whose checksum is wrong", "tar");
    const size = octal(h, 124, 136);
    const start = off + BLOCK;
    if (start + size > buf.length) throw new ParserInstallRefused("the tarball is truncated", "tar");
    const body = buf.subarray(start, start + size);
    off = start + Math.ceil(size / BLOCK) * BLOCK;
    const type = h[156] === 0 ? "0" : String.fromCharCode(h[156]);

    if (type === "x") {
      const path = paxRecords(body).path;
      if (path !== undefined) nextName = path;
      continue;
    }
    if (type === "g") continue; // global pax header: carries no file
    if (type === "L") {
      nextName = field(body, 0, body.length);
      continue;
    }

    let name = nextName;
    nextName = null;
    if (name === null) {
      const base = field(h, 0, 100);
      const prefix = field(h, 257, 263).startsWith("ustar") ? field(h, 345, 500) : "";
      name = prefix ? `${prefix}/${base}` : base;
    }
    const why = unsafeTarName(name);
    if (why) throw new ParserInstallRefused(`the tarball has an entry with ${why}`, "tar");
    if (type === "5") continue; // a directory: the reader creates the ones it needs
    if (type !== "0" && type !== "7") {
      const kind = type === "1" ? "a hard link" : type === "2" ? "a symbolic link" : `an entry of type ${JSON.stringify(type)}`;
      throw new ParserInstallRefused(`the tarball has ${kind} (${name}); a parser package has no reason to ship one`, "tar");
    }
    out.push({ name: name.replace(/\/+$/, ""), body });
  }
  return out;
}

// --- fetching ---------------------------------------------------------------------------------

const isLoopbackHost = (host) => host === "localhost" || host === "[::1]" || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host);

/** Check one URL before it is requested: the destination rule, then the scheme. */
export function checkUrl(url, { policy, env }) {
  let u;
  try {
    u = new URL(url);
  } catch {
    throw new ParserInstallRefused("a download address is not a URL", "url");
  }
  if (u.username || u.password) throw new ParserInstallRefused("a download address carries a user; the lock never does", "url");
  if (u.protocol !== "https:" && !(u.protocol === "http:" && isLoopbackHost(u.hostname))) {
    throw new ParserInstallRefused(`refusing ${u.protocol.replace(/:$/, "")} to ${u.hostname}: the add-on is fetched over https`, "url");
  }
  assertDestination(u.href, { kind: "npm", policy, env, inbound: true });
  return u;
}

/** GET a URL into a Buffer with Node's own http(s), following a checked redirect. */
export function fetchBytes(url, { policy, env, maxBytes = MAX_TARBALL_BYTES, redirects = MAX_REDIRECTS } = {}) {
  const u = checkUrl(url, { policy, env });
  const lib = u.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const req = lib.get(u, { headers: { "user-agent": "cortex-parsers", accept: "application/octet-stream" } }, (res) => {
      const status = res.statusCode ?? 0;
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume();
        if (redirects <= 0) return reject(new ParserInstallRefused(`too many redirects from ${u.host}`, "fetch"));
        let next;
        try {
          next = new URL(res.headers.location, u).href;
        } catch {
          return reject(new ParserInstallRefused(`a redirect from ${u.host} is not a URL`, "fetch"));
        }
        // The next address is checked like the first; a refusal must reject, not throw in a callback.
        return Promise.resolve()
          .then(() => fetchBytes(next, { policy, env, maxBytes, redirects: redirects - 1 }))
          .then(resolve, reject);
      }
      if (status !== 200) {
        res.resume();
        return reject(new ParserInstallRefused(`${u.host}${u.pathname} answered ${status}`, "fetch"));
      }
      const chunks = [];
      let total = 0;
      res.on("data", (c) => {
        total += c.length;
        if (total > maxBytes) {
          req.destroy();
          reject(new ParserInstallRefused(`${u.pathname} is larger than ${maxBytes} bytes`, "fetch"));
          return;
        }
        chunks.push(c);
      });
      res.on("end", () => resolve(Buffer.concat(chunks)));
      res.on("error", reject);
    });
    req.setTimeout(60_000, () => req.destroy(new Error(`timed out fetching ${u.host}${u.pathname}`)));
    req.on("error", reject);
  });
}

// --- install, status, remove ------------------------------------------------------------------

/** The sha512 integrity string npm writes, for a buffer. */
export const integrityOf = (buf) => `sha512-${createHash("sha512").update(buf).digest("base64")}`;
const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

/** The URL a package is fetched from: the lock's, or the same path on a mirror the person named. */
export function tarballUrl(pkg, registry) {
  if (!registry) return pkg.tarball;
  let base;
  try {
    base = new URL(registry);
  } catch {
    throw new ParserInstallRefused("--registry is not a URL", "url");
  }
  const path = new URL(pkg.tarball).pathname;
  return new URL(path.replace(/^\//, ""), base.href.endsWith("/") ? base.href : `${base.href}/`).href;
}

/** Remove `name` under `home`, after proving the path resolves inside it. */
function removeInside(home, name) {
  if (!existsSync(home)) return;
  const target = resolveInRoot(home, name);
  if (target === resolveInRoot(home, ".")) throw new Error("refusing to remove the parsers directory itself");
  rmSync(target, { recursive: true, force: true });
}

/**
 * Download, verify and unpack every package in the lock into its install directory.
 *
 * `fetch(url)` is injectable for tests; the default is `fetchBytes` with the profile's policy.
 * Returns `{ dir, digest, packages }`. Throws `ParserInstallRefused`, or `DestinationRefusedError`
 * from the destination check, before anything is written when a download or a check fails.
 */
export async function install({ lock, digest, env = process.env, policy, registry = null, fetch = null, log = () => {} }) {
  const home = parsersHome({ env });
  const get = fetch ?? ((url) => fetchBytes(url, { policy, env }));

  // Every download is checked and verified before the first byte is written anywhere.
  const unpacked = [];
  for (const pkg of lock.packages) {
    const url = tarballUrl(pkg, registry);
    checkUrl(url, { policy, env });
    log(`fetching ${pkg.name}@${pkg.version} from ${new URL(url).host}`);
    const tgz = await get(url);
    if (integrityOf(tgz) !== pkg.integrity) {
      throw new ParserInstallRefused(
        `${pkg.name}@${pkg.version} does not match the integrity in the lock; nothing was installed`,
        "integrity",
      );
    }
    let tar;
    try {
      tar = gunzipSync(tgz, { maxOutputLength: MAX_UNPACKED_BYTES });
    } catch (e) {
      throw new ParserInstallRefused(`${pkg.name}@${pkg.version} does not unpack: ${e.message}`, "tar");
    }
    const entries = readTar(tar);
    const files = [];
    for (const f of pkg.files) {
      const hits = entries.filter((e) => e.name === f.path);
      if (hits.length !== 1) {
        throw new ParserInstallRefused(
          `${pkg.name}@${pkg.version} has ${hits.length ? "more than one" : "no"} ${f.path}`,
          "tar",
        );
      }
      if (sha256(hits[0].body) !== f.sha256) {
        throw new ParserInstallRefused(`${pkg.name}@${pkg.version}: ${f.path} does not match the lock`, "integrity");
      }
      const rel = installedPath(pkg, f);
      if (!isSafeRelPath(rel)) throw new ParserInstallRefused(`the lock names an unsafe path, ${rel}`, "lock");
      files.push({ rel, body: hits[0].body });
    }
    unpacked.push({ pkg, files });
  }

  mkdirSync(home, { recursive: true });
  const tmpName = `.install-${digest}-${process.pid}`;
  const oldName = `.old-${digest}-${process.pid}`;
  removeInside(home, tmpName);
  const tmp = resolveInRoot(home, tmpName);
  try {
    for (const { files } of unpacked) {
      for (const { rel, body } of files) {
        const full = join(tmp, ...rel.split("/"));
        mkdirSync(dirname(full), { recursive: true });
        writeFileSync(full, body);
      }
    }
    const check = verifyInstall(tmp, lock);
    if (check.state !== "ok") throw new Error(`the unpacked add-on does not match the lock: ${check.problems.join("; ")}`);
    const dir = resolveInRoot(home, digest);
    if (existsSync(dir)) renameSync(dir, resolveInRoot(home, oldName));
    renameSync(tmp, dir);
    removeInside(home, oldName);
    return { dir, digest, packages: lock.packages.map((p) => `${p.name}@${p.version}`) };
  } catch (e) {
    removeInside(home, tmpName);
    throw e;
  }
}

/** What is installed against what the lock asks for. Reads only. */
export function status({ lock, digest, env = process.env }) {
  const home = parsersHome({ env });
  const dir = installDir(digest, { env });
  const check = verifyInstall(dir, lock);
  let others = [];
  try {
    others = readdirSync(home, { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name !== digest)
      .map((e) => e.name)
      .sort();
  } catch {
    others = [];
  }
  return {
    parser: parserName(digest),
    digest,
    dir,
    state: check.state,
    problems: check.problems,
    packages: lock.packages.map((p) => ({ name: p.name, version: p.version })),
    languages: Object.keys(lock.grammars).sort(),
    others,
  };
}

/** Delete this lock's install directory. Returns whether there was one. */
export function remove({ digest, env = process.env }) {
  const home = parsersHome({ env });
  if (!existsSync(installDir(digest, { env }))) return false;
  removeInside(home, digest);
  return true;
}

// --- the command ------------------------------------------------------------------------------

const USAGE =
  "usage: cortex-parsers.mjs install [--registry <https origin>]\n" +
  "       cortex-parsers.mjs status [--json]\n" +
  "       cortex-parsers.mjs remove";

async function main(argv) {
  const say = (s) => process.stdout.write(`${s}\n`);
  const fail = (s, code = 1) => {
    process.stderr.write(`cortex-parsers: ${s}\n`);
    process.exit(code);
  };

  const [sub, ...rest] = argv;
  const flags = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (sub === "install" && a === "--registry" && i + 1 < rest.length) flags.registry = rest[++i];
    else if (sub === "status" && a === "--json") flags.json = true;
    else fail(`unexpected argument ${JSON.stringify(a)}\n${USAGE}`);
  }
  if (!["install", "status", "remove"].includes(sub)) fail(USAGE);

  const read = readLock(LOCK_PATH);
  if (read.problem) fail(read.problem);
  const { lock, digest } = read;

  if (sub === "status") {
    const s = status({ lock, digest });
    if (flags.json) return say(JSON.stringify(s, null, 2));
    say(`lock        ${digest} (${s.packages.map((p) => `${p.name}@${p.version}`).join(", ")})`);
    say(`languages   ${s.languages.join(", ")}`);
    const word = { ok: "installed", absent: "not installed", partial: "PARTIAL", mismatch: "DOES NOT MATCH THE LOCK" }[s.state];
    say(`install     ${word} at ${s.dir}`);
    for (const p of s.problems) say(`            ${p}`);
    if (s.state !== "ok") say("            node tools/cortex-parsers.mjs install fetches it; the index works without it.");
    if (s.others.length) say(`other       ${s.others.join(", ")} under ${parsersHome({ env: process.env })}, from another lock; never loaded, safe to delete`);
    return;
  }

  if (sub === "remove") {
    const removed = remove({ digest });
    say(removed ? `removed ${installDir(digest, { env: process.env })}` : `nothing installed at ${installDir(digest, { env: process.env })}`);
    return;
  }

  let profile;
  try {
    profile = resolveProfile({ env: process.env });
  } catch (e) {
    fail(e.message);
  }
  const where = flags.registry ?? lock.registry;
  say(
    `Downloading the parser add-on from ${where}: ${lock.packages.map((p) => `${p.name}@${p.version}`).join(", ")}.\n` +
      `Each tarball is checked against the sha512 in index/parsers.lock.json before it is unpacked into\n` +
      `${installDir(digest, { env: process.env })}. Nothing else is written.`,
  );
  try {
    const r = await install({ lock, digest, policy: profile.policy, registry: flags.registry ?? null, log: say });
    say(`installed ${parserName(digest)} at ${r.dir}\nThe next index run reads definitions and calls: node index/cortex-index.mjs .`);
  } catch (e) {
    if (e instanceof DestinationRefusedError || e instanceof ParserInstallRefused) fail(e.message, 2);
    fail(e.message);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main(process.argv.slice(2));
}
