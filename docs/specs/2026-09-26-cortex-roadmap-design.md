# Cortex roadmap — official practice, strangers can find it, proven on a real team

- **Date:** 2026-09-26
- **Status:** approved in conversation, awaiting written-spec review
- **Decided by:** the maintainer, through two interviews (`/grilling`, then brainstorming)

## Goal

Over the next month Cortex succeeds when **a stranger can find it, understand it and get it
running** — and what they install behaves the way Anthropic's own Claude Code documentation says a
plugin should, proven on a realistic multi-repo team rather than on fixtures.

Three tracks serve that goal. They run in the order in [Sequence](#sequence); each numbered step is
one PR, merged before the next that depends on it starts. No PR stacks on another.

- **Track A — official practice.** Cortex's own plugin, what it writes into repos, and a checker
  that grades any repo's Claude setup, all against Anthropic's docs.
- **Track B — the front door.** README, GitHub metadata, a rebuilt public site kept in sync with the
  source, a live demo, marketplace listings.
- **Track C — the proving ground.** A private five-repo test setup shaped like a real FE + BE team,
  and the gaps it exposes.

## Decisions

| # | Decision | Rejected alternative, and why |
|---|---|---|
| D1 | The core deliverable of Track A is a **checker** that grades a repo's Claude setup against the official docs | Only fixing Cortex's own files — helps no one else's repo |
| D2 | Official rules are **vendored as data** with source URL, a verbatim evidence sentence and a checked date; a maintainer tool plus weekly CI re-verifies them ([ADR 0017](../adr/0017-anthropic-docs-are-the-authoring-source.md)) | Fetching docs live at runtime — offline breakage, non-deterministic output |
| D3 | Rule violations **fail CI in Cortex's own repo**, and are **findings** (never failures) in a user's repo | Failing builds in someone else's repo |
| D4 | Cortex's custom frontmatter keys (`capability`, `reached-by`) move under the official `metadata:` map | Keeping them top-level — the docs reserve top-level keys and may reject unknown ones |
| D5 | Claude-only features (`` !`cmd` ``, `context: fork`, `paths`, hooks) are used only where the skill still reads correctly as plain markdown in other agents | Depending on them — Cortex also serves Codex/Gemini through `AGENTS.md` |
| D6 | The prompt-gate hook stays repo-local until it stops firing on clear requests | Shipping it in the plugin now |
| D7 | The checker is **findings in `index/`** plus a judgment lens in `/optimize-context` — no new ritual | A `/claude-setup-audit` ritual — 44 rituals already cost context in every session |
| D8 | Checker scope first: `CLAUDE.md`/`AGENTS.md`, skills, subagents, hooks, and the model/API checks in D11. Permissions and MCP config come later | All six areas at once |
| D9 | Everything `/cortex` writes must pass the checker, as a test | Trusting the templates |
| D10 | Rituals set `effort:` from their `capability` floor — `mechanical` → `low`, `judgment` → default (`medium`), `strong` → `high` — and a level is kept only if the evals hold their score at it | Leaving effort to the session; setting it without measurement |
| D11 | Opus 5.5 prompting guidance becomes `model.*` rules in the same data module, with the same evidence discipline | A prose-only note |
| D12 | The public site is rebuilt in a **separate repo** `cortex-site` (renamed from `ai-os-site`, keeping its Vite/React stack) | Moving the site into this repo — would add dependencies to a zero-dependency repo (ADR 0004) |
| D13 | The site is kept current by **`/site-sync`** on top of a deterministic facts file and a CI drift check (#416) | A check alone — every prose change stays manual forever |
| D14 | `/site-sync` is a **deliberate exception** to D7's "no new rituals": drafting prose needs judgment a check cannot make | — |
| D15 | Discovery channels: README first screen, GitHub metadata, marketplace listings, a demo run on a known public repo | — |
| D16 | The test setup is built **early** (step 7), as the proving ground for every later step | Building it last — gaps found then reopen finished work |
| D17 | Test setup size: **lean, five repos** | Eight repos — more to keep green before it proves more |

## Sequence

| Step | Track | What | Size | State |
|---|---|---|---|---|
| 1 | A | #426 prompt-gate tuning · #427 official rules + docs check · #428 four bugs | — | **merged** |
| 2 | A | Opus 5.5 rules (D11) + the `cortex-cron.sh` API fix + hook scripts stamped executable | S | |
| 3 | A | The checker (D1, D7, D8, D9) | M | |
| 4 | A | Cortex applies its own rules (D3, D4, D10) | M | |
| 5 | B | Front door basics | S | |
| 6 | B | `tools/cortex-site-facts.mjs` | M | |
| 7 | C | Build the test setup | L | |
| 8 | C | Close the gaps it exposes — each its own designed PR | L | |
| 9 | B | Rebuild the site (#415) | L | |
| 10 | B | `/site-sync` + drift CI (#416) | M | |
| 11 | A | `/optimize-context` lens + `paths:` in `/cortex-skills` output | S | |
| 12 | B | Demo run + marketplace listings | M | |

Step 7 precedes step 9 because step 8 changes what Cortex can do, and the site should describe the
product as it will be. Step 12 is last because a listing is a first impression.

---

## Step 2 — Opus 5.5 rules and the direct-API fix

**Source:** `https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-opus-5-5`.
Each rule below lands in `core/claude-code.js` with a verbatim `evidence` sentence from that page,
and `tools/cortex-claude-docs.mjs --check` re-verifies it weekly like the rest.

| Rule id | What it pins |
|---|---|
| `model.effort.default-medium` | Opus 5.5 defaults to `medium`; test levels against evals rather than carrying one over |
| `model.thinking.counts-toward-max-tokens` | Thinking tokens count toward `max_tokens` |
| `model.response.read-by-block-type` | Do not assume the first content block is text |
| `model.thinking.cannot-disable` | `thinking: {"type": "disabled"}` is not accepted |
| `model.prompt.no-reasoning-in-response` | Asking the model to write out its reasoning can be refused (`reasoning_extraction`) |
| `model.agentic.end-turn-is-a-report` | A text-only end of turn is a report, not proof the task is done |
| `model.agentic.continuation-cap` | Stop after two or three automatic continuations |

Rules whose sentence cannot be found verbatim are dropped, not paraphrased.

**`tools/server/cortex-cron.sh`** (the one place Cortex calls the API directly):

- Read the summary from the first block whose `type` is `text`, not `.content[0].text`.
- Raise `max_tokens` from 800 to 16,000 — room for thinking plus a short digest — and name the
  reason inline (`model.thinking.counts-toward-max-tokens`).
- Treat `stop_reason` of `refusal` or `max_tokens` as a failed summary, reported on stderr the same
  way a missing `jq` already is — never a silent empty digest.
- A shell test with a canned response whose first block is `thinking` must produce the summary.

**Prompt gate: "yes" / "ok" + any verb is a go-ahead.** After #426 the gate still scored
"yes write the spec" 4/5, because only `yes`/`ok` + do/go/merge/ship/fix/run bypass. A go-ahead
word followed by any verb, within the existing 8-word limit, bypasses; the prompt joins the
regression table.

**Hook scripts stamped executable.** `templates/loop/settings.hooks.json` runs
`.claude/hooks/*.sh` directly, and the templates are stored non-executable, so on macOS/Linux the
hook fails with "permission denied". The step that stamps them sets the executable bit; a test
asserts every hook script `/cortex` writes is executable.

## Step 3 — The checker

Findings in `index/` (a new `index/lib/claude-setup.mjs`, consuming `core/claude-code.js`),
surfaced wherever findings already appear: the `/cortex-install` report, `cortex-view`,
`cortex-next`. Every finding cites the rule id and its source URL.

| Area | Findings |
|---|---|
| `CLAUDE.md` / `AGENTS.md` | over `claude-md.max-lines`; emphasis (`IMPORTANT`, `MUST`, …) on many lines; an `@` import to a missing file |
| Skills | description + `when_to_use` over 1,536 chars; body over 500 lines; unknown frontmatter key; trigger lists on a `disable-model-invocation` skill; a referenced supporting file that is missing |
| Subagents | unknown key; missing `name`/`description`; a name containing `:`; `hooks`/`mcpServers`/`permissionMode` on a plugin subagent (silently ignored); an agent described as read-only that can edit |
| Hooks | a settings command naming a script that does not exist; a script that is not executable; a `PostToolUse` hook that can exit 2 |
| Model / API | `.content[0].text`; a literal `max_tokens` under 4,096 in a Messages API request (Cortex's threshold, not a documented number — the finding says so); `thinking: disabled`; a prompt asking to write out reasoning |

**Test (D9):** stamp a fixture repo with everything `/cortex` writes, run the checker, assert zero
findings. The `format-changed.sh` bug fixed in #428 is the class this catches.

## Step 4 — Cortex applies its own rules

- Move `capability` and `reached-by` under `metadata:` in all 44 skills. `tools/cortex-frontmatter.mjs`
  learns the one nested map it must accept; `cortex-capability.mjs` and `cortex-skill-graph.mjs`
  read the new location. The flat-`key: value` rule stays for everything else.
- Run the step-3 checker over Cortex itself in CI; any finding fails the build (D3).
- **Effort (D10):** add `effort:` per the mapping. Before keeping a level on `/ship`, `/resume` and
  `/cortex-review`, run their evals at `low`, `medium` and `high`; keep the mapped level only if its
  held-out score is not below the current one. Record the measured scores in the CHANGELOG.
- The unattended runners — the `agent-evals.yml` template and `evals/skillopt/` — treat a text-only
  end of turn as a report and cap automatic continuations (`model.agentic.*`).
- Fix the two authoring drifts ADR 0017 recorded: `/skill-creator` says ~500 **words** where the
  docs say 500 **lines**; `/writing-for-agents` cites only mattpocock/skills and gains the official
  sources.

## Step 5 — Front door basics

- **README first screen**, in this order: one line on what Cortex is and who it is for; a Cortex
  View screenshot (`docs/images/cortex-view.png`, from a real run); the three install steps; four
  bullets on what lands in a repo; then the existing sections unchanged. The vault-era lines
  ("capture first, organize later", the MCP-and-vault paragraph) move into the existing personal
  vault section — moved, not deleted.
- **GitHub metadata:** topics `claude-code`, `claude-plugin`, `agents-md`, `context-engineering`,
  `codebase-analysis`, `legacy-code`, `developer-tools` via `gh repo edit --add-topic`.
- **Social preview:** a 1280×640 image is produced; GitHub has no API for it, so the maintainer
  uploads it in the repo settings.
- The Website field waits for step 9.

## Step 6 — The facts file

`tools/cortex-site-facts.mjs` writes `site-facts.json`: deterministic (sorted keys, no timestamps,
byte-identical across runs), no network, no dependencies.

| Fact | Source |
|---|---|
| `version` | `VERSION` |
| `node` | `mcp/package.json` → `engines.node` |
| `install` | the fenced blocks under "Install as a Claude plugin" in `README.md` |
| `rituals[]` — name, when, does, invocation (model / user) | the ritual table in `AGENTS.md`, joined with each `skills/*/SKILL.md` frontmatter |
| `mcpTools[]` — name, modes, description | the running server: `mcp/server.js` started in repo mode and in vault mode, asked for `tools/list` |

Asking the server rather than importing `mcp/lib/tools.js` reports exactly what users get and keeps
`tools/` off a leaf's internals.

`--check <file>` compares against a last-synced copy, exits non-zero, and names each change in plain
words ("ritual `/resume` added", "install command changed"). It fails — rather than choosing — when
the `AGENTS.md` table and the skill folders disagree.

**Tests:** fixture repos per kind of change; byte-identical output; every skill directory appears in
`rituals[]`; a table/folder mismatch fails.

## Step 7 — The test setup

**Firewall.** The setup mirrors the *shape* of a real team — a React monorepo with a gateway,
Spring services split by country and by feature, several FE and BE developers using Claude Code.
Domain, countries, names and code are **invented**. Nothing is copied from any employer. The repos
are private and live outside this repository.

| Repo | Contents |
|---|---|
| `harbor-web` | pnpm-workspaces monorepo: `apps/tracking`, `apps/checkout` (React + Vite + TS), `packages/ui`, `packages/api-client`, and a Node `gateway/` routing `/api/shipments/*` → `harbor-shipments` and `/api/countries/{north,south}/*` → the country services |
| `harbor-shipments` | Spring Boot 3, Java 21, Maven; REST controllers; calls the country services |
| `harbor-country-north` | Spring Boot country-data service |
| `harbor-country-south` | Spring Boot country-data service, same API shape, different rules |
| `harbor-team-brain` | the Cortex team-brain (`/team-init`) |

- **Real, working code.** Every repo builds and passes its own tests in GitHub Actions. The Spring
  repos deliberately include same-package references with no `import`.
- **A team's history.** Commits from six identities (`fe1`–`fe3`, `be1`–`be3`) across several
  simulated weeks, so churn, memory and `/resume` have material.
- **Cortex stays data-free.** The existing real-project test (`CORTEX_E2E_REPO=<path>`) gains a
  multi-repo mode, `CORTEX_E2E_WORKSPACE=<dir>`, that runs the deterministic scenarios against
  whatever repos sit in that directory. Only the generic runner lives in this repository.

### Acceptance scenarios

"Working" means all four pass. A scenario that cannot pass yet is listed as an **expected failure**
naming the step-8 piece that will close it — never silently omitted.

| # | Scenario | Checked by code | Checked by a model run or a person |
|---|---|---|---|
| S1 | **Install + correct map** | index all four code repos; `apps/tracking → packages/ui` resolves; Java same-package references resolve; the step-3 checker reports zero findings on everything `/cortex` wrote | — |
| S2 | **Team memory across repos** | `be1` records a memory in `harbor-shipments`; it reaches the team-brain; `fe1`'s `catch_me_up` in `harbor-web` returns it | the summary, via `claude -p` with a stated completion condition |
| S3 | **FE ↔ BE: who serves this call** | a gateway route resolves to the Spring controller that serves it | — |
| S4 | **Daily team rituals** | two identities editing overlapping files get a warning (#408); `/cortex-review` runs in CI on a PR | `/resume` and `/ship` over several people's branches and PRs, scored like the evals |

Expected failures at step 7: S1's workspace and same-package assertions, S3 entirely, S4's overlap
warning.

## Step 8 — Close the gaps

Each is its own PR with its own short design, in this order, each turning an expected failure into
a pass:

1. **Monorepo workspaces** — resolve `package.json` `workspaces` / `pnpm-workspace.yaml` package
   names to their directories (S1).
2. **Java same-package references** — resolve a bare type name to a class in the same package
   directory (S1). Regex resolution stays (ADR 0004); the edge is a floor, like every other.
3. **FE ↔ BE route map** — extract gateway routes and Spring `@RequestMapping`-family annotations
   into the index, and resolve a route across repos in one workspace (S3). Needs its own design:
   it is the first cross-repo feature.
4. **Overlap warning (#408, v0)** — `/cortex-impact` takes another session's changed-file set and
   reports overlap plus one-hop dependency collisions. No daemon, no tick loop (S4).

## Step 9 — Rebuild the site (#415)

- Rename `ai-os-site` → `cortex-site`, with the mechanical path changes #415 lists landing in the
  same push. **The maintainer confirms the rename immediately before it happens** — it changes a
  public URL.
- Rewrite every page from the source file #415 maps it to. Fact pages (rituals table, MCP tools,
  version badge, install block) render from the committed `site-facts.json`, so they cannot drift.
- Remove the npm button; there is no npm package.
- Set the Cortex repo's Website field and add a README link to the site.

## Step 10 — `/site-sync` (#416)

- **CI:** on push to `master`, run `cortex-site-facts.mjs --check` against `cortex-site`'s committed
  facts; open or update one issue listing drifted facts.
- **`/site-sync`:** run the check (no drift → say so and stop); read `CHANGELOG.md` and `git log`
  since the site's synced version; map each changed fact to the pages it affects; draft the edits
  in a clone of `cortex-site`; **show the diff and stop for the user**; on approval, commit on a
  branch and open a PR on `cortex-site`. It never pushes to `cortex-site`'s `main`, which deploys.
- `/ship` points to `/site-sync` when the check reports drift.
- The skill declares `capability: judgment`, is reachable from `/ship`, and follows every step-3 rule.

## Step 11 — `/optimize-context` lens and `paths:`

- `/optimize-context` applies the official `CLAUDE.md` test — "would removing this cause Claude to
  make mistakes?" — and the include/exclude table from the best-practices page, citing the rule ids.
- `/cortex-skills` writes `paths:` on the stack skills it generates (a Prisma skill loads only when
  Prisma files are touched). Harmless in agents that ignore it (D5).

## Step 12 — Demo and listings

- Run `/cortex` on a well-known public repository whose license permits it; publish its Cortex
  View page and the `AGENTS.md` it wrote on the site as a live example, linked from the README.
- Submit Cortex to the community Claude plugin marketplace and to the maintained plugin/awesome
  lists, pointing at the README and the site.

## Out of scope for this roadmap

- Checker areas deferred by D8: permissions (`settings.local.json` accumulation, deny rules, secrets
  in `env`) and MCP config (inline credentials vs `headersHelper`).
- Adopting `` !`cmd` `` injection and `context: fork` in Cortex's own rituals — after step 4, and
  only once measured against the evals (D5, D10).
- Skill outcome telemetry (#407) — blocked on whether the plugin ships hooks at all (D6).
- The personal vault half of Cortex.

## Verification

Each step's PR shows its evidence in the PR body: the suites it ran and their counts, and for
steps 7–8 the acceptance table with each scenario's state. The roadmap is done when every step is
merged and S1–S4 all pass on the test setup with no expected failures left.
