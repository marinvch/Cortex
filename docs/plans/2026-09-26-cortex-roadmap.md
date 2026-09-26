# Cortex roadmap — implementation plan

> **For agentic workers:** execute with superpowers:subagent-driven-development — one fresh
> implementer per step, in its own worktree, one PR per step; the orchestrator verifies the PR
> (suites, CI, diff scope) before merging and before any dependent step starts. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build steps 2–12 of the roadmap spec: official practice as checked code, a front door a
stranger can use, and a private five-repo proving ground.

**Architecture:** Rules live as evidence-backed data in `core/claude-code.js`; the checker is
ordinary findings in `index/`; site facts are extracted by a `tools/` script that asks the running
MCP server; the test setup is five private repos outside this repository, driven by a generic
multi-repo mode of the existing end-to-end test.

**Tech stack:** Node ≥ 20 (ES modules, `node:test`), Bash test fragments under `tools/test/`,
GitHub Actions; test setup: React + Vite + TS (pnpm workspaces), Node gateway, Spring Boot 3 /
Java 21 / Maven.

**Spec:** [`docs/specs/2026-09-26-cortex-roadmap-design.md`](../specs/2026-09-26-cortex-roadmap-design.md)
— read it first; decisions D1–D17 are not reopened here.

**Why this plan is per step and not code-complete.** The spec is a roadmap across three tracks, and
step 8 is defined by what step 7 finds. Code for later steps written now would be invented. Each
step below fixes its files, interfaces, tests and verification; its implementer writes the code
test-first inside the step's PR, and steps 8.3 and 9 open with their own short design.

## Global constraints

- No runtime dependencies in this repo (ADR 0004). Test setup repos may use their stacks' normal
  dependencies.
- `core/` depends on nothing; `index/` and `mcp/` never import each other
  (`core/test/architecture.test.js`). `tools/` does not import a leaf's internals.
- Never hand-edit a version — `node tools/cortex-version.mjs --set <x.y.z>`.
- Every destructive shell tool routes its target through `resolve_in_root`; every
  `tools/test/*.test.sh` sources `_helpers.sh` first and every `cd` carries `|| exit 1`.
- Every ritual declares a capability floor; every ritual is reachable (`cortex-skill-graph.mjs --check`).
- Frontmatter stays flat `key: value`, except the one `metadata:` map step 4 admits.
- CHANGELOG entries under `## [Unreleased]`; commit titles are sentences saying what was wrong or
  what now exists.
- Data-free: no employer, client or colleague names anywhere; the test setup's domain is invented.
- All suites green before merge: `node --test core/test/*.test.js`, `node --test index/test/*.test.mjs`,
  `(cd mcp && npm test)`, `node --test .claude/hooks/*.test.mjs`,
  `node --test evals/test/*.test.mjs && node evals/generate.mjs --check`, `bash tools/test/run.sh`,
  `node tools/cortex-frontmatter.mjs`, `node tools/cortex-skill-graph.mjs --check`; and CI on
  ubuntu **and** windows.

## Review focus

1. **Windows vs POSIX.** CRLF working copies, the executable bit, and `\` paths. Every new parser
   strips `\r`; the executable-bit test (step 2) is skipped on Windows with a stated reason, not
   silently; paths are compared normalised. Pinned in steps 2, 3, 6.
2. **A repo with none of it.** No `CLAUDE.md`, no `.claude/`, no skills: the checker emits zero
   claude-setup findings and does not throw. Pinned in step 3.
3. **Non-ASCII descriptions.** Descriptions carry Bulgarian trigger phrases; the 1,536 cap counts
   characters (code points via `[...str].length`), not bytes. Pinned in step 3.
4. **No network.** `cortex-site-facts.mjs` and the checker never touch the network; the docs check
   distinguishes "could not check" from "stale" (already true since #427). Pinned in step 6.
5. **Malformed input.** Frontmatter with a BOM, an unterminated `---`, or a hook settings file that
   is not JSON: reported as one finding, never a crash of the whole report. Pinned in step 3.

---

### Step 2: Opus 5.5 rules, the direct-API fix, the go-ahead gate, executable hooks

**Files:**
- Modify: `core/claude-code.js` (add `model.*` rules), `core/test/claude-code.test.js`
- Modify: `tools/cortex-claude-docs.mjs` only if the new source page needs a URL form it lacks
- Modify: `tools/server/cortex-cron.sh`; Test: `tools/test/cortex-cron.test.sh` (create or extend)
- Modify: `.claude/hooks/optimize-prompt.mjs`, `.claude/hooks/optimize-prompt.test.mjs`,
  `skills/optimize-prompt/SKILL.md`
- Modify: whatever stamps `templates/loop/*.sh` (per `skills/cortex/SKILL.md` destinations and
  `index/lib/loop.mjs`); Test: the loop/stamping test that already enumerates templates
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: `RULES`, `rule(id)`, `limit(id)`, `CHECKED` from `core/claude-code.js`.
- Produces: rule ids `model.effort.default-medium`, `model.thinking.counts-toward-max-tokens`,
  `model.response.read-by-block-type`, `model.thinking.cannot-disable`,
  `model.prompt.no-reasoning-in-response`, `model.agentic.end-turn-is-a-report`,
  `model.agentic.continuation-cap` — each `{ id, value, source, evidence, checked }`; `source` is
  `https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-opus-5-5`.

- [ ] Fetch the source page (`.md` form if served) and copy each `evidence` verbatim; drop any rule
      without a verbatim sentence and say so in the PR.
- [ ] Extend the module-shape test to accept the `platform.claude.com` host; add the rules; run
      `node --test core/test/claude-code.test.js` → pass; `node tools/cortex-claude-docs.mjs --check`
      → exit 0 live.
- [ ] `cortex-cron.sh` test first: canned responses (a) `content: [{type:"thinking",…},{type:"text",text:"S"}]`
      → digest contains `S`; (b) `stop_reason:"refusal"` → stderr names it, deterministic digest
      still written; (c) `stop_reason:"max_tokens"` → same. Run → fails. Then: jq
      `[.content[] | select(.type=="text") | .text] | join("")`, `max_tokens` 16000 with the rule id
      in a comment, stop_reason handling. Run → passes. Point `CORTEX_API_URL` at a local file
      server or stub `curl` via `PATH` — no network.
- [ ] Gate test first: `"yes write the spec"`, `"ok update the readme"`, `"yes open the pr"` must
      bypass; `"make it better"` and `"fix stuff"` must still fire. Then generalise the go-ahead
      rule to go-ahead word + any verb within 8 words; update the skill's rule text (the
      word-list-sync test enforces it).
- [ ] Executable hooks test first: after stamping a fixture repo, every `.claude/hooks/*.sh` has the
      user-execute bit (skip on `win32` with the reason in the skip message). Then set mode `0o755`
      where the stamp copies; if the stamp is a documented skill step rather than code, move the
      copy into code (ADR 0016: the guarantee belongs to the act).
- [ ] Full suites → green. Commit per concern; PR; CI green on both OSes; merge.

### Step 3: The checker

**Files:**
- Create: `index/lib/claude-setup.mjs`; Test: `index/test/claude-setup.test.mjs`
- Create fixtures under `index/test/fixtures/claude-setup/` (or build them in temp dirs via
  `index/test/tmp.mjs`, matching the neighbouring tests)
- Modify: `index/lib/findings.mjs` (call the new module from `analyse`)
- Create: the stamp-then-check test (`index/test/cortex-output-passes.test.mjs` or a
  `tools/test/*.test.sh` fragment, whichever can reach the stamping code without a layering break)
- Modify: `index/AGENTS.md` (one routing line), `CHANGELOG.md`

**Interfaces:**
- Consumes: `rule`, `limit` from `core/claude-code.js`; step 2's `model.*` ids; the index object
  `analyse(index, root, { text })` already receives.
- Produces: `export function claudeSetupFindings(index, root, { read }) → Finding[]` where
  `Finding` is findings.mjs's `{ severity, kind, title, detail, evidence, offer }`. Every `kind`
  starts `claude-setup/` (e.g. `claude-setup/skill-description-too-long`); every `detail` names the
  rule id and its source URL; severity is `medium` for rule breaches, `low` for style
  (emphasis count). Never `critical` — D3: findings, not failures.

- [ ] Write one failing test per row of the spec's step-3 table, each with a minimal fixture that
      breaks exactly that rule, asserting the `kind` and that `detail` cites the rule id.
- [ ] Write the Review-focus tests: empty repo → `[]`; a 1,536-code-point Cyrillic description →
      no finding, 1,537 → finding; BOM + CRLF frontmatter parses; unterminated frontmatter and
      non-JSON settings → one finding each, no throw.
- [ ] Implement until green. Keep it table-driven: one entry per check, so step 11 and later
      additions are rows, not branches.
- [ ] Stamp-then-check test: stamp everything `/cortex` writes into a fixture, run
      `claudeSetupFindings` → assert `[]`. Temporarily break a template (e.g. remove a hook
      script) to confirm the test fails, then restore.
- [ ] Wire into `analyse`; run `node index/cortex-findings.mjs .` on this repo and on two cloned
      public repos (memory: validate against real repos) — record counts in the PR body.
- [ ] Full suites → green; PR; CI; merge.

### Step 4: Cortex applies its own rules

**Files:**
- Modify: all `skills/*/SKILL.md` frontmatter (`capability`, `reached-by` → `metadata:`; add `effort:`)
- Modify: `tools/cortex-frontmatter.mjs` (accept exactly one nested `metadata:` map),
  `tools/cortex-capability.mjs`, `tools/cortex-skill-graph.mjs`, `core/test/plugin.test.js`,
  `docs/changing-cortex.md` (the capability bullet names the new location)
- Create: `tools/test/cortex-follows-its-own-rules.test.sh` (runs `claudeSetupFindings` over this
  repo; any finding fails)
- Modify: `templates/loop/agent-evals.yml`, `evals/skillopt/cortex_skill/adapter.py`,
  `skills/skill-creator/SKILL.md` (500 **lines**), `skills/writing-for-agents/SKILL.md` (cite the
  official pages), `CHANGELOG.md`

**Interfaces:**
- Consumes: `claudeSetupFindings` (step 3).
- Produces: frontmatter shape `metadata:\n  capability: <floor>\n  reached-by: <ritual>` —
  `cortex-capability.mjs` output is unchanged for callers.

- [ ] Frontmatter parser test first: a `metadata:` block with two indented keys parses into
      `{ metadata: { capability, "reached-by" } }`; any other nested key still fails.
- [ ] Migrate with a throwaway `*.tmp.mjs` script (gitignored), then delete it; `git diff --stat`
      shows 44 SKILL.md files, frontmatter only.
- [ ] Effort: add `effort: low` to `mechanical`, `effort: high` to `strong`, nothing to `judgment`.
      Run the evals for `/ship`, `/resume`, `/cortex-review` at the mapped level and at `medium`
      (`evals/skillopt/run.py eval … --split valid_unseen`, counting `target call failed` = 0
      first). Keep a level only if its held-out score ≥ the current one; record both in the CHANGELOG.
- [ ] Unattended runners: a text-only end of turn with open work gets at most 2 continuations,
      then the run is reported partial (test with a stubbed `claude -p` returning a status-only
      message).
- [ ] Self-check test green; full suites green; PR; CI; merge.

### Step 5: Front door basics

**Files:**
- Modify: `README.md` (first screen per spec; vault lines moved, not deleted)
- Create: `docs/images/cortex-view.png` (screenshot of a real `node index/cortex-view.mjs .` page,
  taken with the Playwright/Chrome tooling), `docs/images/social-preview.png` (1280×640)
- Modify: `CHANGELOG.md`

- [ ] Generate the view, screenshot it, commit the PNG (keep it under ~400 KB).
- [ ] Rewrite the first screen; verify every moved sentence still exists further down
      (`git diff --word-diff` shows moves, not losses); the doc-link test passes.
- [ ] `gh repo edit marinvch/Cortex --add-topic …` for the seven topics; verify with `gh repo view --json repositoryTopics`.
- [ ] PR; CI; merge. Social-preview upload is left for the maintainer.

### Step 6: The facts file

**Files:**
- Create: `tools/cortex-site-facts.mjs`; Test: `tools/test/site-facts.test.sh`
- Modify: `tools/README.md`, `CHANGELOG.md`

**Interfaces:**
- Produces: `site-facts.json` = `{ schema: 1, version, node, install: { commands: string[] },
  rituals: [{ name, when, does, invocation: "model"|"user" }], mcpTools: [{ name, modes:
  ("repo"|"vault")[], description }] }`, keys sorted, arrays sorted by `name`.
  CLI: `--out <file>`, `--check <file>` (exit 1 + one plain line per change), `--json`.

- [ ] Tests first against fixture copies of the repo: byte-identical output across two runs;
      adding a skill dir without a table row → exit non-zero naming it; changing an install
      command → `--check` prints "install command changed"; MCP tools come from a spawned
      `mcp/server.js` (repo mode and vault mode) answering `tools/list`, with `UNTRUSTED_NOTE`
      stripped from descriptions; the run makes no network call.
- [ ] Implement; full suites; PR; CI; merge.

### Step 7: The test setup

**Outside this repo** (private repos under the maintainer's account), plus one change here.

- [ ] Create private repos `harbor-web`, `harbor-shipments`, `harbor-country-north`,
      `harbor-country-south`, `harbor-team-brain` (`gh repo create --private`).
- [ ] Build each per the spec's step-7 table with an invented parcel-delivery domain; each repo
      has a GitHub Actions workflow that builds and tests it, and it is green.
- [ ] Spring repos include at least two same-package references with no `import`; `harbor-web`
      apps import `@harbor/ui` and `@harbor/api-client` through pnpm workspaces; the gateway routes
      `/api/shipments/*` and `/api/countries/{north,south}/*`.
- [ ] History: commits authored by `fe1`–`fe3` / `be1`–`be3` (`GIT_AUTHOR_*`/`GIT_COMMITTER_*`
      with past dates over ~4 weeks), several merged PR-shaped branches.
- [ ] Install Cortex on the four code repos (`/cortex` via `claude -p` or the stamping code) and
      `/team-init` + `/team-add` against `harbor-team-brain`.
- [ ] **In this repo:** `tools/test/install-on-a-project.test.sh` gains `CORTEX_E2E_WORKSPACE=<dir>`:
      runs S1–S4's deterministic checks over every repo in `<dir>`, prints one line per scenario
      as `PASS` / `FAIL` / `XFAIL (<step 8.n>)`, and exits non-zero only on an unexpected `FAIL`.
      Without the variable the fragment behaves exactly as today. PR; CI; merge.
- [ ] Record the first acceptance table (expected: S1 workspace + same-package and S3 and S4
      overlap as XFAIL).

### Step 8: Close the gaps — one PR each, in order

For each: a short design in the PR body, tests first against minimal fixtures **and** the
harbor workspace, the scenario flips from `XFAIL` to `PASS`, full suites, CI, merge.

- [ ] **8.1 Workspaces** — `index/lib/resolvers.mjs`: map workspace package names
      (`package.json` `workspaces`, `pnpm-workspace.yaml` globs) to directories; resolve
      `@scope/pkg` and `@scope/pkg/sub` imports. Validate on two public monorepos too.
- [ ] **8.2 Java same-package** — resolve a bare capitalised type name used in a `.java` file to
      `<same dir>/<Name>.java` when it exists and is not imported from elsewhere.
- [ ] **8.3 FE ↔ BE route map** — design first (it is the first cross-repo feature): extract
      gateway routes and Spring `@RequestMapping`/`@GetMapping`/… into the index; resolve a
      route across the repos of one workspace. Its own spec section in the PR.
- [ ] **8.4 Overlap warning (#408 v0)** — `index/cortex-impact.mjs --against <file-list>`:
      overlap + one-hop dependency collisions between two changed-file sets. Close #408's v0.

### Step 9: Rebuild the site (#415)

- [ ] **Confirm the rename with the maintainer immediately before it** (public URL change).
- [ ] Rename `ai-os-site` → `cortex-site` with the mechanical changes from #415 in the same push.
- [ ] Rewrite pages from their mapped sources; fact pages render from a committed
      `site-facts.json` (step 6 output). Remove the npm button.
- [ ] Deploy; load every page (Playwright) and confirm no 404s and no "AI OS"/"Copilot"/`npx`
      strings remain; set Cortex's Website field; add the README link (PR here). Close #415.

### Step 10: `/site-sync` (#416)

**Files:** Create `skills/site-sync/SKILL.md`; `.github/workflows/site-drift.yml`; modify
`skills/ship/SKILL.md` (pointer), `AGENTS.md` ritual table, `CHANGELOG.md`.

- [ ] Workflow: on push to `master`, check out `cortex-site`, run
      `node tools/cortex-site-facts.mjs --check <site>/site-facts.json`, open/update one
      `site-drift` issue on failure.
- [ ] Skill per the spec (stops at the diff; PRs to `cortex-site`, never pushes `main`);
      `metadata: capability: judgment`; reachable from `/ship`; passes step 3's checker.
- [ ] Skill-graph, frontmatter and self-check tests green; PR; CI; merge. Close #416.

### Step 11: `/optimize-context` lens and `paths:`

- [ ] `/optimize-context` cites `claude-md.prune-test` and the include/exclude table.
- [ ] `index/lib/skills.mjs` candidates gain a `paths` glob per stack; the written SKILL.md
      carries `paths:`; test that a Prisma candidate writes `paths: prisma/**, **/*.prisma`.
- [ ] Suites; PR; CI; merge.

### Step 12: Demo and listings

- [ ] Pick a well-known, permissively licensed public repo; run `/cortex` on a clone; publish the
      Cortex View page and generated `AGENTS.md` on the site under `/demo`; link from README.
- [ ] Prepare listing submissions (community plugin marketplace, maintained awesome lists) as
      ready-to-open PR texts; **the maintainer approves before any is submitted** — they publish to
      third-party repos.
