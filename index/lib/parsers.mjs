// parsers.mjs — the one loader of the parser add-on.
//
// docs/adr/0029: the shipped tree imports nothing outside Node's builtins. A parser is an add-on the
// person installs with `node tools/cortex-parsers.mjs install`, into `<home>/.cortex/parsers/<lock
// digest>/`, and this is the only module allowed to `import()` a computed path. Everything that
// reads symbols goes through `loadParsers`, and everything works when it returns null.
//
// The rules this module keeps:
//
//   - **It loads only an install that matches the lock.** The directory is named by the lock's
//     digest, and every file in it is hashed against the lock's sha256 before anything is imported
//     (`verifyInstall`, core/parser-lock.js). The WebAssembly runtime and each grammar are then
//     loaded from the bytes that were hashed, never by path, so a file swapped after the check is
//     not the one that runs. Only the runtime's JavaScript is imported by path, after its check.
//   - **No add-on is not an error.** `loadParsers` returns null when nothing is installed, when the
//     install is partial or differs from the lock, and when the runtime fails to start. `parserState`
//     says which, in one sentence, for the caller to print once. The index is then built exactly as
//     it is without the add-on, and says `parser: "regex"`.
//   - **It decides which grammar reads a file, by extension**, and nothing else: `.js .mjs .cjs .jsx`
//     with the JavaScript grammar, `.ts .mts .cts` with TypeScript, `.tsx` with TSX, `.py` with
//     Python. Anything else has no symbols.
//   - **One load per process.** The runtime is a WebAssembly module with global state, so the first
//     successful load is kept and returned again.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { installDir, installedPath, parserName, readLock, verifyInstall } from "../../core/parser-lock.js";

/** The lock this tree reads. Resolved from this file, never from the working directory. */
export const LOCK_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "parsers.lock.json");

/** The grammar for each extension. Kept in one table so a language added in G5 is one row. */
const GRAMMAR_BY_EXT = {
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "javascript",
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  tsx: "tsx",
  py: "python",
};

/** Which grammar reads `path`, or null. */
export function grammarFor(path) {
  const name = String(path).split("/").pop().toLowerCase();
  const dot = name.lastIndexOf(".");
  return dot < 0 ? null : GRAMMAR_BY_EXT[name.slice(dot + 1)] ?? null;
}

const INSTALL_HINT = "node tools/cortex-parsers.mjs install";

/**
 * What the loader would find, without loading anything. `{ state, digest, dir, note }`:
 *
 *   ok         the install matches the lock
 *   absent     nothing installed for this lock (the usual case; `note` is null)
 *   partial    a file is missing
 *   mismatch   a file differs from the lock
 *   lock       the lock itself cannot be read
 */
export function parserState({ env = process.env, lockPath = LOCK_PATH } = {}) {
  const read = readLock(lockPath);
  if (read.problem) return { state: "lock", digest: null, dir: null, note: `symbols not built: ${read.problem}` };
  const dir = installDir(read.digest, { env });
  const check = verifyInstall(dir, read.lock);
  const note =
    check.state === "ok" || check.state === "absent"
      ? null
      : `symbols not built: the parser add-on at ${dir} is ${check.state === "partial" ? "incomplete" : "not the one the lock pins"} ` +
        `(${check.problems[0]}). Run ${INSTALL_HINT} again.`;
  return { state: check.state, digest: read.digest, dir, lock: read.lock, note };
}

let loaded = null;

/**
 * Load the add-on, or return null. The result:
 *
 *   name       `tree-sitter@<digest>`, what `index.parser` records
 *   digest     the lock digest
 *   grammars   { javascript: "tree-sitter-javascript@0.25.0", … }
 *   parse(grammar, text) → a tree, which the caller must `delete()`
 *
 * `onNote` receives the one sentence explaining a null, when there is something to explain.
 */
export async function loadParsers({ env = process.env, lockPath = LOCK_PATH, onNote = () => {} } = {}) {
  const s = parserState({ env, lockPath });
  if (s.state !== "ok") {
    if (s.note) onNote(s.note);
    return null;
  }
  if (loaded?.digest === s.digest) return loaded;

  const { lock, dir } = s;
  const pkgOf = (name) => lock.packages.find((p) => p.name === name);
  // Read a locked file and check it again, so the bytes that run are the bytes that were hashed.
  const bytesOf = (pkgName, path) => {
    const pkg = pkgOf(pkgName);
    const file = pkg.files.find((f) => f.path === path);
    const buf = readFileSync(join(dir, ...installedPath(pkg, file).split("/")));
    if (createHash("sha256").update(buf).digest("hex") !== file.sha256) throw new Error(`${path} changed since it was checked`);
    return buf;
  };

  try {
    const runtime = pkgOf(lock.runtime.package);
    const modulePath = join(dir, ...installedPath(runtime, { path: lock.runtime.module }).split("/"));
    bytesOf(runtime.name, lock.runtime.module);
    const mod = await import(pathToFileURL(modulePath).href);
    const { Parser, Language } = mod;
    await Parser.init({ wasmBinary: bytesOf(runtime.name, lock.runtime.wasm) });

    const languages = {};
    const grammars = {};
    for (const key of Object.keys(lock.grammars).sort()) {
      const g = lock.grammars[key];
      languages[key] = await Language.load(new Uint8Array(bytesOf(g.package, g.wasm)));
      grammars[key] = `${g.package}@${pkgOf(g.package).version}`;
    }
    const parsers = {};
    loaded = {
      name: parserName(s.digest),
      digest: s.digest,
      grammars,
      parse(grammar, text) {
        if (!languages[grammar]) return null;
        if (!parsers[grammar]) {
          parsers[grammar] = new Parser();
          parsers[grammar].setLanguage(languages[grammar]);
        }
        return parsers[grammar].parse(text);
      },
    };
    return loaded;
  } catch (e) {
    onNote(`symbols not built: the parser add-on at ${dir} did not start (${e.message}). Run ${INSTALL_HINT} again.`);
    return null;
  }
}
