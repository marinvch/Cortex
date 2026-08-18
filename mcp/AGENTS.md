# mcp/ — the live brain

An optional Node MCP server exposing Cortex over stdio, plus the `ai-os` CLI. The busiest part of
the repo by commit count, and — like every other part — **dependency-free**.

## Invariants

- **No runtime dependencies, ever.** A plugin install clones the repo and never runs
  `npm install`, so a declared dependency is simply absent on the user's machine. `lib/stdio.js`
  is the ~100-line MCP transport that replaced `@modelcontextprotocol/sdk` for exactly this
  reason. `core/test/install.test.js` fails the build if an import creeps back in. See
  [ADR 0004](../docs/adr/0004-no-runtime-dependencies.md).
- **Only protocol messages go to stdout.** A stray `console.log` corrupts the JSON-RPC stream and
  the client reports something unrelated. Diagnostics go to stderr.
- **`server.js` stays a thin switch.** All logic lives in `lib/`; the transport layer is a
  dispatch over tool names and nothing more.
- **Two modes, decided by the root — never configured.** `AI_OS_ROOT` ending in `.cortex` is
  **repo mode** (`recall`, `remember`, `recall_memory`); anything else is **vault mode** (the
  personal-brain tools). Detection keeps the plugin manifest to one env var and makes a
  misconfiguration visible as a changed tool list.
- **Vault tools must stay hidden in repo mode.** Offering `capture` or `catch_me_up` there invites
  an agent to write `inbox/` and `daily/` into someone's product repository. `mode.test.js` asserts
  the exact tool list for both modes.
- **`AI_OS_ROOT` unset is a hard exit**, not a default. Guessing a vault path would write someone's
  notes into the wrong place.
- **Every vault path goes through `lib/vault.js`** — not through `resolveInRoot` directly. The Vault
  is the only module here that joins onto a vault root or calls `node:fs` on one; it wraps
  `core/paths.js` so the guard is unavoidable rather than remembered. If you need an operation it
  does not have, add it to the Vault — do not reach around it.
  `test/vault-is-the-only-door.test.js` fails the build otherwise. [ADR 0007](../docs/adr/0007-the-vault-is-the-only-door.md).
- **`mcp/` never imports from `index/`.**

## Gotchas

- **`lib/cortexignore.js` is a faithful port of `knowledge_files()` in `tools/_cortex-lib.sh`.**
  The two must agree; CI diffs them in `cortex-init-test.yml`. Change one, change both. It is also
  **pure** — it decides what the patterns mean and never reads a file; the Vault fetches the text
  and passes it in. The dependency only runs one way: `vault.js` imports it, never the reverse.
- **`test/manifest-parity.test.js` guards a deliberate duplication**: `tools/cortex-init.sh`
  hardcodes `CORE_PLUGINS` to stay jq-free, and this test is the only thing preventing drift from
  `plugins/cortex-core-plugins.json`.
- `lib/gitsync.js` uses `execFileSync` with an argument array, never a shell string, so slugged
  project and team names cannot inject. Keep it that way.
- `lib/version.js` reads the repo-root `VERSION` file. It exists because `server.js`,
  `package.json` and the docs actually drifted apart once between 1.0.0 and 1.1.0.
- Path handling carries Windows-specific cases; this is the primary dev platform, and CI has a
  Windows leg for exactly that reason.

## Tests

```bash
cd mcp && npm test
```

No install step — there is nothing to install. `smoke.test.js` and `mode.test.js` spawn the real
server over stdio; if they time out, read the captured stderr in the failure message before
assuming a test bug. `stdio.test.js` drives the transport over in-memory streams instead, so the
protocol edges (notifications, framing, parse errors) are pinned without spawning anything.
