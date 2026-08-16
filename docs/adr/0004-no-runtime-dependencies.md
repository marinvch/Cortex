# 0004. Cortex ships with no runtime dependencies

**Date:** 2026-08-16
**Status:** accepted

## Context

Cortex is distributed as a Claude plugin. Installing a plugin **clones the repository** — it does
not run `npm install`, does not honour a lockfile, and does not build. Whatever is in the tree is
what runs.

`mcp/server.js` opened with three imports from `@modelcontextprotocol/sdk`, declared as a
dependency in `mcp/package.json`. On this development machine `mcp/node_modules` existed, so all
166 tests passed, the CI job ran `npm ci` before testing, and the MCP brain worked perfectly.

On every other machine it was dead. A fresh clone produced:

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@modelcontextprotocol/sdk'
```

Which means `recall`, `remember` and `recall_memory` — the whole live half of the product — were
unavailable to every user who installed the plugin, from v2.0.0 onward. The test suite could not
see it because the test suite ran in the one environment where the dependency was present.

The SDK cost 22 MB across ~90 transitive packages (express, zod, jose, hono) to supply four
symbols: `Server`, `StdioServerTransport`, and two request schemas. The MCP surface Cortex actually
uses is `initialize`, `tools/list`, `tools/call` and `ping` over newline-delimited JSON-RPC 2.0.

## Decision

**Nothing in the shipped tree may import a package that is not a Node builtin.**

`mcp/lib/stdio.js` implements the MCP stdio transport directly — about 100 lines. `mcp/package.json`
declares no dependencies and `mcp/package-lock.json` is deleted. The CI workflow has no install
step.

`core/test/install.test.js` enforces it: it reads the source of `core/`, `index/` and `mcp/` and
fails on any non-relative, non-builtin import, and on any shipped `package.json` that declares a
dependency. It reads source rather than attempting an import, because the environment is precisely
what cannot be trusted — Node resolves `node_modules` by walking up, and on a normal machine the OS
temp directory sits below a home directory that has one.

## Alternatives rejected

| Option | Why not |
|---|---|
| Commit `node_modules` | 22 MB of someone else's code in the repo, updated by hand, and a supply-chain surface nobody reviews |
| Run `npm install` on first launch | Requires network at runtime, fails behind a proxy, and turns a missing package into an intermittent bug instead of a loud one |
| A `postinstall` hook | Plugin installs do not run npm lifecycle scripts at all — this fixes nothing |
| Publish to npm and depend on the published package | Contradicts ADR 0001; the plugin is a checkout, not a package install |
| Keep the SDK and document "run npm install first" | An install step users must discover after the thing silently fails is not an install step |

## Consequences

The plugin now works from a clone on any machine with Node 20+, which is the claim the README
already made. `git clone` is the whole install.

Cortex owns ~100 lines of protocol code and must track the MCP spec itself. This is a real cost,
bounded by the fact that the four methods above are the stable core of the protocol and version
negotiation already falls back to a supported version. `mcp/test/stdio.test.js` pins the edges an
SDK would have handled — notifications must not be answered, unknown methods return `-32601`,
messages split across reads must still parse, and a throwing tool must not kill the session.

The constraint is now load-bearing for the whole repo, not just `mcp/`: the indexer was already
dependency-free, and `core/` gained a `package.json` whose only job is `"type": "module"`, so its
ESM files no longer depend on Node's syntax-detection fallback resolving against whatever
`package.json` happens to sit above the install directory.
