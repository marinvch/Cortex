# 0029. Code parsers are an add-on the user installs, never a dependency

**Date:** 2026-10-25
**Status:** accepted. Amends [ADR 0004](0004-no-runtime-dependencies.md).

## Context

Cortex reads imports with regular expressions. That gives a file-level graph that is right often
enough to rank findings and to count dependents as a floor. It cannot tell which function calls
which, so "who calls `chargeCard`?" has no answer, and a symbol defined in one file and used in
another is invisible.

Graphify (Apache-2.0) answers those questions with tree-sitter, a parser with a grammar per
language. Porting its approach was agreed on 2026-10-25 (spec:
[`docs/specs/2026-10-25-graph-port-design.md`](../specs/2026-10-25-graph-port-design.md)).

ADR 0004 forbids it as written: *nothing in the shipped tree may import a package that is not a
Node builtin*. Its reason still holds. A plugin install clones the repository and never runs
`npm install`, so a dependency is simply absent on the user's machine, and the failure stays
invisible on the machine where the tests pass.

A feasibility probe on 2026-10-25 found that `web-tree-sitter` 0.27.1, the WebAssembly build of
tree-sitter, loads in Node 24 by absolute file path from an unpacked npm tarball. No
`node_modules`, no compiler and no install script are needed. The published grammar packages
ship a ready `.wasm` file: `tree-sitter-javascript` 0.25.0, `tree-sitter-typescript` 0.23.2
(TypeScript and TSX) and `tree-sitter-python` 0.25.0 each parsed a sample without error. All four
packages are MIT.

## Decision

**The shipped tree still imports nothing outside Node's builtins.** Parsers are an add-on that a
person chooses to install, kept outside the plugin, and Cortex is complete without them.

1. **One command installs them, and only when asked.** `node tools/cortex-parsers.mjs install`
   downloads the packages pinned in `index/parsers.lock.json` from the npm registry and checks each
   tarball's sha512 against the lock before unpacking. A mismatch refuses the whole install. The
   lock names an exact version and integrity per package; nothing floats. The files land in a
   user-level directory (`~/.cortex/parsers/<lock digest>/`), never in a repo and never in the
   plugin's own tree. `status` says what is installed, and `remove` deletes that directory through
   the root guard. This is the only Cortex command that fetches code. It says so before fetching,
   and nothing runs it on its own.
2. **One module loads them.** `index/lib/parsers.mjs` is the only file that may `import()` a
   computed path, and only one inside that directory whose digest matches the lock.
   `core/test/install.test.js` keeps refusing every static import of a package and fails on a
   dynamic `import()` in any other file.
3. **Without them, Cortex behaves as it does today.** With no parsers installed, or a partial or
   unreadable install, the index is built exactly as before, and the reason is stated once.
   Nothing that reads the index may require symbol data. Each consumer works with
   `index.parser === "regex"`.
4. **The index says which parser built it.** `index.parser` is `"regex"` or
   `"tree-sitter@<lock digest>"`. Determinism is restated: the same tree and the same parser give
   the same bytes. Two machines that differ only in having the add-on give different indexes, and
   each says why.
5. **Every edge says how sure it is.** Following Graphify, an edge carries `confidence`:
   `extracted` (stated in the source: an import, or a call resolved to one definition), `inferred`
   (resolved by name to one candidate in another file) or `ambiguous` (several candidates; all are
   kept). Regex import edges are `extracted`. Counts that include `inferred` or `ambiguous` edges
   say so, because a floor built on a guess is no longer a floor.

## Alternatives rejected

| Option | Why not |
|---|---|
| Declare `web-tree-sitter` as an npm dependency | The ADR 0004 failure exactly: absent on every installed plugin, present on the machine that runs the tests |
| Commit the `.wasm` files to the repo | About 4 MB of compiled binaries per handful of languages, unreviewable in a diff, and shipped to every user whether or not they want parsing |
| Native `tree-sitter` bindings | Need a C compiler at install time and break on each Node ABI change |
| Download grammars automatically on first index | A network call nobody asked for, inside a command documented as making none |
| Stay regex-only and match calls with patterns | Wrong too often: method calls, aliases and shadowed names. Every call edge would need `ambiguous` |
| Shell out to Graphify itself | A Python toolchain on every machine, and a second index that disagrees with the first. Reading its `graph.json` stays a possible import, not the engine |

## Consequences

- Cortex owns a small installer: an HTTPS fetch, gunzip from `node:zlib`, a tar reader of about 60
  lines and an integrity check. `tools/test/` and `index/test/` cover it with a fake registry
  serving fixture tarballs, so no test needs the network.
- Updating a grammar is an edit to `index/parsers.lock.json` and a re-run of `install`. The lock is
  reviewed like code, because it decides what code runs.
- The README's "What Cortex runs, sends and fetches" gains a bullet for `cortex-parsers.mjs install`,
  in the same PR that adds the command.
- An index built with parsers is bigger. Symbol nodes are kept out of `index.json`'s file list and
  live in their own section, so every reader of `files` is unchanged.
- ADR 0004's test grows one allowance with one owner, rather than a general exemption.
