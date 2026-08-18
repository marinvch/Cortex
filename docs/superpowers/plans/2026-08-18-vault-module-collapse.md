# Plan: the Vault module collapse

> **For agentic workers:** REQUIRED SUB-SKILL: use `superpowers:executing-plans` (or
> `superpowers:subagent-driven-development`) to implement this task by task. Steps use `- [ ]`.

**Goal:** make the root guard the *only* door to the vault filesystem, so path safety stops being
something five modules remember to call.

**Architecture:** one `mcp/lib/vault.js` owning `list` · `read` · `append` · `write`, wrapping the
existing `core/paths.js` guard. `cortexignore` · `projects` · `capture` · `recall` become callers
that never touch `node:fs` or join onto a root themselves. A structural test enforces it, in the
same spirit as `core/test/architecture.test.js` — a test is cheaper than remembering.

**Tech Stack:** Node 20+, `node:test`, no runtime dependencies (ADR 0004).

**Spec:** [`2026-08-15-three-mode-seam-design.md`](../specs/2026-08-15-three-mode-seam-design.md) —
Decision 3 and sequence item 9.

## Scope

This plan is **sequence item 9 only**. Item 10 (the three-mode resolver) is a separate subsystem
that only becomes meaningful once this interface exists, and it gets its own plan. Splitting them is
the spec's own sequencing, not a convenience.

## Global constraints

- **No runtime dependencies.** ADR 0004. Node built-ins only.
- **Layering holds.** `core/` depends on nothing in this repo; `index/` and `mcp/` never import each
  other. `core/test/architecture.test.js` fails the build otherwise.
- **Observable behaviour does not change.** This is a structural refactor. Every MCP tool returns
  what it returns today, including absolute paths in `recall` results. Characterization tests pin
  that *before* anything moves.
- **Verification for every task:**
  ```bash
  node --test core/test/*.test.js
  node --test mcp/test/*.test.js
  node --test index/test/*.test.mjs
  ```

## Where the Vault module lives — and why not `core/`

`mcp/lib/vault.js`, **not** `core/vault.js`.

`core/` is the shared kernel: it holds what *both* leaves need — the guard, the secret gate, memory,
date. `index/` has no use for vault semantics at all; it asks **git** what belongs to a repo
(ADR 0003) and deliberately does not read `.cortexignore`, because those answer different questions.
Moving vault logic into `core/` would grow the kernel with concepts one of its two consumers never
uses, which is the same mistake the layering was introduced to fix.

`core/paths.js` stays exactly where it is. It is the primitive; the Vault is the door built around
it. Recorded as ADR 0007.

## File structure

| File | Responsibility | Change |
|---|---|---|
| `mcp/lib/vault.js` | the only module that joins onto a vault root or calls `node:fs` on one | **create** |
| `mcp/test/vault.test.js` | the four operations, and that each refuses an escaping path | **create** |
| `mcp/test/vault-is-the-only-door.test.js` | the structural invariant | **create** |
| `core/paths.js` | `resolveInRoot` — the primitive the Vault wraps | unchanged |
| `mcp/lib/cortexignore.js` | parse + match ignore rules; no longer reads the file itself | modify |
| `mcp/lib/recall.js` | scoring and snippets; no longer walks the tree | modify |
| `mcp/lib/projects.js` | project shape; no longer lists a directory | modify |
| `mcp/lib/capture.js` | note routing; no longer resolves or appends | modify |
| `docs/adr/0007-the-vault-is-the-only-door.md` | the decision | **create** |
| `AGENTS.md` | the gotcha | modify |

`slug.js` and `gitsync.js` stay separate, per the spec — naming and remote sync are genuinely
different concerns. **Verified, not assumed:** `teamCloneDir` joins `slugify(team)` onto the root,
and `slugify` reduces `..` to the empty string, so it is not a traversal hole. Note that in the
invariant test's allowlist with this reason, so the next reader does not "fix" it.

---

## 1. Pin today's behaviour before moving it

**Touches:** `mcp/test/recall.test.js`, `mcp/test/projects.test.js`

A refactor with no characterization tests is a rewrite with extra steps. Before the collapse, pin
what callers actually observe:

- `recall()` returns `path` values that are **absolute**, and `listMarkdown` honours `.cortexignore`
  for both directories and files.
- `listProjects()` returns `{ slug, path }` with an absolute `path`, skipping ignored entries and
  dot-directories.

- [ ] **Step 1:** add the two characterization tests against a temp-dir fixture containing an
  ignored directory, an ignored file, a dot-directory and a normal note.
- [ ] **Step 2:** run them — they must **pass** now. These describe today, not tomorrow. If one
  fails, stop: the behaviour is not what this plan assumes and the plan is wrong.
- [ ] **Step 3:** commit.

**Verify:** `node --test mcp/test/recall.test.js mcp/test/projects.test.js`

## 2. The invariant test, failing

**Touches:** `mcp/test/vault-is-the-only-door.test.js`

Write the structural rule first, and watch it catch the three real offenders:
`cortexignore.js:56` (`join(root, ".cortexignore")`), `projects.js:7` (`join(root, "projects")`) and
`recall.js` (`walk(root, "")` with a raw `join` per entry).

Scan `mcp/lib/*.js` and `mcp/*.js` for a `join(`/`resolve(` whose first argument is a root-ish
identifier (`root`, `vaultRoot`, `aiOsRoot`), excluding `vault.js` itself and an allowlist of
`gitsync.js` (reason above) plus `version.js` / `setup-plugins.js`, which join onto the **Cortex
install directory**, a different root the vault guard has no authority over.

- [ ] **Step 1:** write the test, listing the allowlist with a one-line reason each.
- [ ] **Step 2:** run it. Expected: **FAIL**, naming exactly three offenders.
- [ ] **Step 3:** commit the failing test on its own, so the diff shows the rule arriving before the
  fix.

**Verify:** the failure message names `cortexignore.js`, `projects.js`, `recall.js` and nothing else.
If it names more, the extra ones are real findings — add them to this plan rather than the allowlist.

## 3. The Vault module

**Touches:** `mcp/lib/vault.js`, `mcp/test/vault.test.js`

```js
export function openVault(root) { /* returns { root, abs, exists, list, read, append, write } */ }
```

- `abs(rel)` → `resolveInRoot(root, rel)`. The single join.
- `exists(rel)` → boolean; never throws for a missing file, **does** throw `OutsideRootError` for an
  escaping one. Refusing to answer questions about paths outside the root is the point.
- `list(scope = "", { ext } = {})` → **root-relative** paths, `.cortexignore` applied to directories
  and files, dot-directories skipped. Recursive from `scope`.
- `read(rel)` → string.
- `append(rel, text)` → creates parent directories, appends.
- `write(rel, text)` → creates parent directories, overwrites.

`list` returning root-relative is the spec's wording and the safer default; callers that must emit
absolute paths do so explicitly through `abs()`. That is why task 1 pinned it — `recall` and
`listProjects` keep returning absolute paths, now by conversion rather than by accident.

- [ ] **Step 1:** write `mcp/test/vault.test.js` — each of the six operations against a temp fixture,
  plus **each of `read` / `append` / `write` / `exists` refusing `../escape.md` with
  `OutsideRootError`**. The refusal cases are the reason this module exists; they are not edge cases.
- [ ] **Step 2:** run it. Expected: FAIL, module not found.
- [ ] **Step 3:** implement `mcp/lib/vault.js`.
- [ ] **Step 4:** run it. Expected: PASS.
- [ ] **Step 5:** commit.

**Verify:** full suite still green — nothing imports the new module yet, so nothing else may move.

## 4. `cortexignore` stops reading the file

**Touches:** `mcp/lib/cortexignore.js`, `mcp/test/cortexignore.test.js`

Split parsing from fetching. `cortexignore.js` exports exactly one function:

```js
export function parseIgnore(text) { /* -> { skipDir, skipFile } */ }
```

Every existing matching rule is preserved; only the `readFileSync` leaves. `vault.js` does the read
itself — `parseIgnore(this.exists(".cortexignore") ? this.read(".cortexignore") : "")` — because the
`.cortexignore` file is a vault path like any other and must go through the same door.

**This direction is not negotiable, and it is why `makeIgnoreFilter(root)` cannot simply gain a
vault parameter.** `vault.list` applies `.cortexignore`, so `vault.js` imports `cortexignore.js`. If
`cortexignore.js` took a vault back, the two would import each other. Parsing takes **text**, never a
root and never a vault. `makeIgnoreFilter` disappears; `projects.js` and `recall.js` were its only
callers and after tasks 5–6 neither needs a filter of its own, because `vault.list` already applied
one.

- [ ] **Step 1:** adjust `cortexignore.test.js` to exercise `parseIgnore(text)` directly — most
  existing cases become simpler, not different, since they were already about matching rather than
  about reading a file.
- [ ] **Step 2:** run. Expected: FAIL.
- [ ] **Step 3:** implement the split; `cortexignore.js` no longer imports `node:fs`.
- [ ] **Step 4:** run the full mcp suite. Expected: PASS.
- [ ] **Step 5:** commit.

**Verify:** `grep -n "node:fs" mcp/lib/cortexignore.js` returns nothing.

## 5. `recall` stops walking

**Touches:** `mcp/lib/recall.js`, `mcp/test/recall.test.js`

`listMarkdown(root)` becomes `vault.list("", { ext: ".md" })`. `recall(root, opts)` keeps its
signature — it opens a vault internally — so `mcp/server.js` and every test calling it are untouched.
Scoring, `matchesProject` and snippets do not change.

`matchesProject` currently splits on `sep`. With root-relative paths from `list`, it must split on
`/` — the same "a separator is a fact about the string, not the host" reasoning already recorded in
`mode.js`. Task 1's characterization test is what catches this if it is missed.

- [ ] **Step 1:** run the task-1 characterization test. Expected: PASS (baseline).
- [ ] **Step 2:** rewrite `listMarkdown` over the vault; convert to absolute with `vault.abs` before
  returning hits.
- [ ] **Step 3:** run. Expected: PASS, unchanged output.
- [ ] **Step 4:** commit.

**Verify:** `node --test mcp/test/recall.test.js mcp/test/catchup.test.js` — `catchup` consumes
recall and is the integration check.

## 6. `projects` stops listing

**Touches:** `mcp/lib/projects.js`, `mcp/test/projects.test.js`

`listProjects(root)` uses `vault.list("projects")`; `getProjectContext` uses `vault.exists` /
`vault.read` instead of `resolveInRoot` + `readFileSync`. The traversal fix that landed standalone
(both candidate paths guarded) is preserved — its three regression tests must stay green untouched,
which is how we know the collapse did not quietly undo it.

- [ ] **Step 1:** rewrite over the vault.
- [ ] **Step 2:** run `node --test mcp/test/projects.test.js mcp/test/project-stub-contract.test.js`.
  Expected: PASS, including the escaping-slug and absolute-slug regressions.
- [ ] **Step 3:** commit.

## 7. `capture` stops resolving

**Touches:** `mcp/lib/capture.js`, `mcp/test/capture.test.js`, `mcp/test/capture.team.test.js`

Replace `resolveInRoot` + `appendFileSync` with `vault.append`. The scrub gate stays exactly where it
is — **the Vault does not scrub.** Secret refusal is a policy decision belonging to `core/scrub.js`
and its callers; folding it into the filesystem door would make every write pay for it and would hide
the refusal behind a path operation.

- [ ] **Step 1:** rewrite over the vault.
- [ ] **Step 2:** run both capture suites. Expected: PASS, including team-mode routing.
- [ ] **Step 3:** commit.

**Verify:** `node --test mcp/test/capture.test.js mcp/test/capture.team.test.js mcp/test/smoke.test.js`

## 8. The invariant goes green

**Touches:** none — this is the payoff step.

- [ ] **Step 1:** run `mcp/test/vault-is-the-only-door.test.js`. Expected: **PASS**, zero offenders.
- [ ] **Step 2:** run the full suite across all three packages.
- [ ] **Step 3:** confirm `mcp/lib/vault.js` is the only file under `mcp/` importing `node:fs` for
  vault paths, and that `core/paths.js` has exactly one non-test importer inside `mcp/` (the vault).
- [ ] **Step 4:** commit.

If the invariant is still red here, **do not add to the allowlist** — the allowlist is for roots the
vault guard has no authority over, not for callers that have not been moved yet.

## 9. Record the decision

**Touches:** `docs/adr/0007-the-vault-is-the-only-door.md`, `AGENTS.md`

ADR 0007: one door, enforced by a test rather than by convention; why the module lives in `mcp/lib/`
and not `core/`; why `scrub` stays outside it; why `slug` and `gitsync` stay separate. Rejected
alternatives: guards at each call site (the state that produced the bug), a lint rule (nothing here
runs a linter — ADR 0004), and putting the Vault in `core/` (grows the kernel with what `index/`
never uses).

Add the gotcha to root `AGENTS.md`: **nothing under `mcp/` may join a path onto a vault root except
`vault.js`** — the allowlisted exceptions join onto the *install* directory, which is a different
root.

**Verify:** `node --test core/test/*.test.js` (link and structure checks).

## 10. Release

**Touches:** `CHANGELOG.md`, `VERSION`, both plugin manifests, `mcp/package.json`, `README.md`,
`CHANGELOG.md` link reference

Cut 2.5.0 — a structural change with no behaviour change, which the entry should say plainly.

**Verify:** `node --test mcp/test/version.test.js` — it guards **six** sites, not five. The
`[2.5.0]: <url>` link reference at the bottom of `CHANGELOG.md` is the one that gets missed, and tag
the release afterwards so the link is not dead on arrival.

---

## Out of scope

- The three-mode resolver (sequence item 10) — its own plan, after this.
- Any change to what the MCP tools return. If a task tempts you to improve output, that is a
  separate change on a separate branch.
- `core/paths.js` internals. The guard is correct; this plan changes who may call it, not what it
  does.

---

## Outcome — all tasks done, 2026-08-18

Shipped as **2.5.0**. `mcp/lib/vault.js` is the only door; it is also the only importer of
`core/paths.js` inside `mcp/`.

**Where the plan was wrong, and what the work found instead:**

- **The plan predicted three offenders; the honest answer was different.** A syntactic scan for
  `join(root, …)` finds `cortexignore` and `projects` but is structurally blind to `recall`, which
  reaches the same place through a closure variable. So the invariant is stated at two altitudes —
  the scan, plus "the four converted modules import no `node:fs`". The second caught `recall`, and
  caught `capture` too: guarded via `resolveInRoot`, but still writing the filesystem itself.
- **Task 4 was smaller than planned and task 3 was larger.** `parseCortexignore(text)` was already
  pure, so only `loadCortexignore` had to go. But `listProjects` is *shallow* while `list` recurses,
  so the Vault grew `entries()` — deriving one from the other would make an empty folder-project
  silently disappear. `isFile` / `isDirectory` / `mtimeMs` were pulled in the same way, by callers
  that needed them rather than by design up front.
- **Two bugs the tests caught in my own work.** `list("..")` normalised the leading dots away and
  listed the root — neutralising an escape instead of refusing it. And the root-join scan flagged
  the comment in `recall.js` explaining why the scan exists; it now skips comment lines. A rule that
  cannot survive being written about is too brittle to keep.

**Deliberately left outside the invariant, each checked rather than assumed:** `gitsync.teamCloneDir`
(slugify cannot emit a traversal segment — verified against `slug.js`), `version.js` and
`setup-plugins.js` (join onto the *install* directory), `catchup.js` and `team.js` (join onto the git
clone), `digest.js` (writes to an `--out` path the user named on the CLI). Refusing these would be a
category error, not extra safety.

**Verification:** core 38 · index 90 · mcp 113 — 0 failures. Plus an end-to-end run against a real
temp vault: capture → listProjects → recall (ranked and project-scoped) → getProjectContext all
behave as before, and both `vault.read("../escape.md")` and `getProjectContext(root, "../../secret")`
refuse with `outside_root`.

**Next:** sequence item 10, the three-mode resolver, which sits behind this interface.
