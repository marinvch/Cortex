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
- **Vault tools are hidden *and* refused in repo mode.** Offering `capture` or `catch_me_up` there
  invites an agent to write `inbox/` and `daily/` into someone's product repository — and a client
  that already knows the name never reads `tools/list`, so hiding is not refusing. Which mode a tool
  runs in is a field on its declaration in `lib/tools.js`; `toolsFor()` derives the advertised list
  and `assertAvailable()` derives the guard, so the two cannot disagree and a new tool cannot be
  added without saying where it runs. `mode.test.js` asserts the exact list for both modes **and**
  that a vault tool invoked in repo mode comes back refused with nothing written.
- **A tool that returns someone else's text says so in its description.** `recall`,
  `recall_memory`, `get_project_context`, `list_projects` and `catch_me_up` all hand the model text
  written outside the conversation — a teammate's committed `.cortex/memory/`, a note in a shared
  vault — and the result itself carries nothing marking it as data rather than instruction, which is
  the standard prompt-injection path through a retrieval tool. The description is the one place the
  model reliably reads, so `UNTRUSTED_NOTE` in `lib/tools.js` is stated **once** and interpolated,
  and `returns: FOREIGN | OWN` is a field on the declaration next to `mode`. `assertWellFormed()`
  runs at import and refuses a row that skips the question or claims `FOREIGN` without the sentence,
  so the next tool cannot ship unmarked. Do not add it to `remember` or `capture`: they take input
  and hand back a path, and a warning on every tool is a warning on none.
- **A tool that publishes is gated by its declaration, not by its caller.** `writes: LOCAL |
  PUBLISHED` is the third field on a row in `lib/tools.js`, and `assertPublishable()` in
  `server.js`'s dispatch applies `core/scrub.js` to the `content` of every `PUBLISHED` one — the
  same shape as `mode`/`assertAvailable()` beside it. `remember` was gated inside `core/memory.js`
  because `.cortex/memory/` is committed; `capture` on a team commits and **pushes** a note to a
  remote other people pull and was not, because `assertWritable` had exactly one caller and being
  the second was a thing you had to remember. That is the shape [ADR 0007](../docs/adr/0007-the-vault-is-the-only-door.md)
  rejected for path safety. `assertWellFormed()` refuses a row that omits `writes`, **and** a
  `PUBLISHED` row that does not take its payload in `content` — otherwise the gate reads a field
  that is not the one being written. A **personal, non-team** capture is gated too: where a capture
  lands is decided at runtime by a connector found by walking up from the cwd, so the call site
  cannot know whether it publishes, and a gate conditional on that is off exactly when nobody can
  see that it is off. `tools.test.js` drives the property off the table and `mode.test.js` proves
  it over a spawned server — the unit test alone passes happily when the dispatch never calls it.
  The refusal stays in `core/scrub.js`: it refuses rather than sanitises and names only the kind.
- **`AI_OS_ROOT` unset is a hard exit**, not a default. Guessing a vault path would write someone's
  notes into the wrong place. `lib/resolve.js` upholds this — it throws `NoRootError` rather than
  falling back, and the three-mode spec's fallback chain was rejected on exactly these grounds
  ([ADR 0008](../docs/adr/0008-three-audiences-one-seam.md)).
- **`capture`'s `team` argument is an override, not the switch.** The team comes from
  `lib/resolve.js` — a repo with a `.cortex/connector.json` writes to the team brain without the
  caller knowing it is on a team. Requiring the agent to pass `team` was the seam leaking. Do not
  reintroduce it as a required argument.
- **Every vault path goes through `lib/vault.js`** — not through `resolveInRoot` directly. The Vault
  is the only module here that joins onto a vault root or calls `node:fs` on one; it wraps
  `core/paths.js` so the guard is unavoidable rather than remembered. If you need an operation it
  does not have, add it to the Vault — do not reach around it.
  The full surface is `list` · `entries` · `read` · `append` · `write` · `abs` · `exists` ·
  `isFile` · `isDirectory` · `mtimeMs`, all taking root-relative paths.
  `test/vault-is-the-only-door.test.js` fails the build otherwise, and it checks **twice**: a scan
  for `join(root, …)`, plus an assertion that the converted modules import no `node:fs` at all —
  because `recall` once bypassed the guard through a closure variable without ever writing that
  call, so the scan alone was blind to it. The three allowlisted files join onto the **install**
  directory or a git clone, never a vault. The Vault does not scrub: secret refusal is policy and
  stays in `core/scrub.js`, so do not add filtering here.
  [ADR 0007](../docs/adr/0007-the-vault-is-the-only-door.md).
- **`mode` and `audience` are different questions.** `lib/mode.js` answers *what kind of brain this
  root is* (repo vs vault); `lib/resolve.js` answers *who it serves* (solo · team · server). They
  are orthogonal — a repo-mode brain can run on a server, a vault-mode brain can belong to a team.
  Solo and team are **detected** from a `.cortex/connector.json` found by walking up from the cwd;
  server is **declared** with `CORTEX_AUDIENCE=server`, because it leaves no filesystem trace and
  declaring beats detecting. `core/profile.js` answers a third question (home · work · lab) and
  reads only `CORTEX_PROFILE` — nothing here may move it.
- **Every adapter opens the brain at entry, through `lib/brain.js`.** `server.js` and `ai-os.js` are
  two adapters over the same operations, so the seam between them is real and therefore a module:
  `openBrain({ cwd, env })` returns `root · mode · isRepo · audience · team · teamClone · profile ·
  policy · sources · describe()`, and throws `NoRootError` / `UnknownProfileError` **before** a
  command picks a branch. Neither adapter may read `env.AI_OS_ROOT` or call `resolve.js`,
  `mode.js` or `core/profile.js` itself — `brain.test.js` scans both for that, because the way this
  rule broke was a second adapter re-deriving the answer by hand: `ai-os catch-up` read the root raw
  and passed `args.team` alone, so inside a repo with a `.cortex/connector.json` it consulted no
  connector, reached no team clone, and printed `commits: []` as a success. That is the `capture`
  invariant below, arriving through the other door. `ai-os.js` resolving the profile inside `team
  init` only is the same shape: `team add` took a typo as `home` while the server exited on it.
  The record **composes three answers and never merges the three questions** — mode from the root
  string, audience from the connector or `CORTEX_AUDIENCE`, profile from `CORTEX_PROFILE` alone.
  Three fields, never one enum; ADR 0008 and ADR 0015 stand unchanged. A command that reads no
  brain (`digest`, `setup-plugins`) does not open one — demanding a root there would be a new
  requirement wearing a fix's clothes.
- **Every path that publishes must consult `policy.outwardSync` — including the CLI.** `lab` exists
  to be permissive locally *because* it is sealed outward, so the seal is the load-bearing half;
  `core/profile.js` calls a `lab` that still pushes "the leak with extra steps". For a while that is
  what `initTeamBrain` was: `capture()` honoured the policy and the team-brain push did not, and
  `ai-os.js` imported `core/profile.js` nowhere, so a misspelt `CORTEX_PROFILE` was a hard exit in
  the server and a silent default in the CLI. Both adapters now take the policy off the record
  `lib/brain.js` opens at entry, which is where the profile is resolved once. A new publish
  path that does not is the same bug again — write locally, decline the push, and tell the caller
  which, the way `capture()` does.
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
