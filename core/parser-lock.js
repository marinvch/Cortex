// parser-lock.js — what the parser add-on is, where it lives, and whether an install of it is whole.
//
// The add-on (docs/adr/0029) is a WebAssembly parser runtime and one grammar per language, pinned in
// `index/parsers.lock.json`. Two programs need the same answers about it and may not import each
// other: `tools/cortex-parsers.mjs` installs it, and `index/lib/parsers.mjs` loads it. So the lock's
// shape, its digest, the install directory and the check that an install matches the lock are here.
//
// The rules this module keeps:
//
//   - **The digest is of the lock's meaning, not its bytes.** It hashes the parsed lock re-serialised
//     with sorted keys, so a CRLF checkout of the same file names the same directory. The directory
//     an install lands in is `<home>/.cortex/parsers/<digest>/`, and a lock edit moves it: an install
//     made from another lock is never loaded, and `status` says so.
//   - **The lock is validated before anything trusts it.** Every package needs an exact version, an
//     https tarball URL on the registry it names, a sha512 integrity, and files whose paths are
//     relative, free of `.`/`..` segments and free of backslashes. Every file carries a sha256 of
//     its own, so the loader can check what is on disk against the lock and not against a manifest
//     the installer wrote.
//   - **An install is whole or it is not used.** `verifyInstall` reads every file the lock names and
//     compares its sha256. A missing file is `partial`, a different one is `mismatch`; only `ok` may
//     be loaded. Hashing costs a few milliseconds on about two megabytes, once per index run.
//   - **Home is read the way core/destinations.js reads it**: `HOME`, then `USERPROFILE`, then the
//     OS. A test hands in its own and never touches the machine's.

import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** The lock format this code reads. */
export const LOCK_FORMAT = 1;

/** How many hex characters of the digest name the install directory and the parser string. */
export const DIGEST_CHARS = 16;

const SAFE_SEGMENT = /^[A-Za-z0-9._@+-]+$/;

/** JSON with every object's keys sorted, so equal values serialise to equal text. */
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** The lock's digest: sha256 of its canonical form, cut to `DIGEST_CHARS`. */
export function lockDigest(lock) {
  return createHash("sha256").update(canonicalJson(lock)).digest("hex").slice(0, DIGEST_CHARS);
}

/** A relative path inside a tarball or an install: forward slashes, no dot segments, nothing odd. */
export function isSafeRelPath(p) {
  if (typeof p !== "string" || !p || p.length > 255) return false;
  if (p.startsWith("/") || p.includes("\\") || p.includes("\0")) return false;
  return p.split("/").every((seg) => seg !== "" && seg !== "." && seg !== ".." && SAFE_SEGMENT.test(seg));
}

/** Where a file the lock names lands inside the install: `<package>/<path minus its top directory>`. */
export function installedPath(pkg, file) {
  const rest = file.path.split("/").slice(1).join("/");
  return `${pkg.name}/${rest}`;
}

/**
 * Check a parsed lock. Returns a list of problems, empty when the lock may be used. Never throws.
 * The checks are the ones an installer and a loader both depend on; a lock that fails one is a bug
 * in a reviewed file, so the message names the field.
 */
export function lockProblems(lock) {
  const out = [];
  if (!lock || typeof lock !== "object") return ["the lock is not an object"];
  if (lock.format !== LOCK_FORMAT) out.push(`format must be ${LOCK_FORMAT}`);
  let registry = null;
  try {
    registry = new URL(lock.registry);
    if (registry.protocol !== "https:" || registry.pathname !== "/" || registry.search || registry.username) {
      out.push("registry must be a bare https origin");
      registry = null;
    }
  } catch {
    out.push("registry is not a URL");
  }
  const names = new Set();
  const packages = Array.isArray(lock.packages) ? lock.packages : [];
  if (!packages.length) out.push("packages is empty");
  for (const [i, pkg] of packages.entries()) {
    const at = `packages[${i}]`;
    if (!pkg || typeof pkg !== "object") {
      out.push(`${at} is not an object`);
      continue;
    }
    if (typeof pkg.name !== "string" || !/^[a-z0-9][a-z0-9._-]*$/.test(pkg.name)) out.push(`${at}.name is not a package name`);
    else if (names.has(pkg.name)) out.push(`${at}.name repeats ${pkg.name}`);
    else names.add(pkg.name);
    if (typeof pkg.version !== "string" || !/^\d+\.\d+\.\d+$/.test(pkg.version)) out.push(`${at}.version is not an exact x.y.z`);
    if (typeof pkg.integrity !== "string" || !/^sha512-[A-Za-z0-9+/]{86}==$/.test(pkg.integrity)) out.push(`${at}.integrity is not a sha512 integrity`);
    try {
      const u = new URL(pkg.tarball);
      if (!registry || u.origin !== registry.origin) out.push(`${at}.tarball is not on the registry`);
      else if (u.pathname !== `/${pkg.name}/-/${pkg.name}-${pkg.version}.tgz` || u.search || u.hash) out.push(`${at}.tarball does not name ${pkg.name}@${pkg.version}`);
    } catch {
      out.push(`${at}.tarball is not a URL`);
    }
    const files = Array.isArray(pkg.files) ? pkg.files : [];
    if (!files.length) out.push(`${at}.files is empty`);
    const seen = new Set();
    for (const [j, f] of files.entries()) {
      const fat = `${at}.files[${j}]`;
      if (!f || !isSafeRelPath(f.path) || f.path.split("/").length < 2) out.push(`${fat}.path is not a safe path inside the tarball`);
      else if (seen.has(f.path)) out.push(`${fat}.path repeats ${f.path}`);
      else seen.add(f.path);
      if (!f || typeof f.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(f.sha256)) out.push(`${fat}.sha256 is not a sha256`);
    }
  }
  const runtime = lock.runtime;
  if (!runtime || !names.has(runtime.package)) out.push("runtime.package names no locked package");
  else {
    const pkg = packages.find((p) => p.name === runtime.package);
    for (const key of ["module", "wasm"]) {
      if (!pkg.files?.some((f) => f.path === runtime[key])) out.push(`runtime.${key} names no locked file`);
    }
  }
  const grammars = lock.grammars && typeof lock.grammars === "object" ? lock.grammars : {};
  if (!Object.keys(grammars).length) out.push("grammars is empty");
  for (const [lang, g] of Object.entries(grammars)) {
    const pkg = packages.find((p) => p.name === g?.package);
    if (!pkg) out.push(`grammars.${lang}.package names no locked package`);
    else if (!pkg.files?.some((f) => f.path === g.wasm)) out.push(`grammars.${lang}.wasm names no locked file`);
  }
  return out;
}

/** Read and check a lock file. `{ lock, digest }` or `{ problem }`. Never throws. */
export function readLock(path) {
  let lock;
  try {
    lock = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    return { problem: `the parser lock at ${path} cannot be read: ${e.message}` };
  }
  const problems = lockProblems(lock);
  if (problems.length) return { problem: `the parser lock at ${path} is not valid: ${problems.join("; ")}` };
  return { lock, digest: lockDigest(lock) };
}

/** The directory every install lives under. Reads the strings it is handed, never the disk. */
export function parsersHome({ env = {} } = {}) {
  const home = String(env.HOME ?? "").trim() || String(env.USERPROFILE ?? "").trim() || homedir();
  return join(home, ".cortex", "parsers");
}

/** The directory the install for this digest lives in. */
export function installDir(digest, { env = {} } = {}) {
  return join(parsersHome({ env }), digest);
}

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

/**
 * Whether the install at `dir` is the one the lock describes. `{ state, problems }`, where state is
 *
 *   absent     no directory
 *   partial    a file the lock names is missing
 *   mismatch   a file is there and its sha256 is not the lock's
 *   ok         every file the lock names is there and matches
 *
 * Never throws.
 */
export function verifyInstall(dir, lock) {
  if (!existsSync(dir)) return { state: "absent", problems: [] };
  const missing = [];
  const different = [];
  for (const pkg of lock.packages) {
    for (const f of pkg.files) {
      const rel = installedPath(pkg, f);
      const full = join(dir, ...rel.split("/"));
      let buf;
      try {
        if (!statSync(full).isFile()) throw new Error("not a file");
        buf = readFileSync(full);
      } catch {
        missing.push(rel);
        continue;
      }
      if (sha256(buf) !== f.sha256) different.push(rel);
    }
  }
  if (different.length) return { state: "mismatch", problems: different.map((p) => `${p} differs from the lock`) };
  if (missing.length) return { state: "partial", problems: missing.map((p) => `${p} is missing`) };
  return { state: "ok", problems: [] };
}

/** `tree-sitter@<digest>`: what `index.parser` says when the add-on built the symbols. */
export function parserName(digest) {
  return `tree-sitter@${digest}`;
}
