# Design: the team-brain rollout — asks, contracts, mixed agents, trackers

- **Date:** 2026-10-24
- **Status:** Approved under delegation. The maintainer asked for all open issues to be fixed in
  one pass. The decisions below were taken so the four build steps share one model, and each one
  can be reversed alone.
- **Issues:** #620 (addressed asks), #621 (contract summaries), #623 (mixed agents), #624 (tracker
  integrations). #622 (organisation fork) ships first and adds `team.json`, which this design
  extends.
- **Area:** `mcp/lib/` (new `asks.js`, `roster.js`, `contract.js`, `trackers/`), `mcp/lib/tools.js`,
  `mcp/server.js`, `mcp/ai-os.js`, `index/lib/contract.mjs` + `index/cortex-contract.mjs`,
  `tools/cortex-setup.mjs`, `templates/team-brain/`, `skills/team-init`, `skills/team-add`. Scoped
  briefs: [`mcp/AGENTS.md`](../../mcp/AGENTS.md), [`index/AGENTS.md`](../../index/AGENTS.md),
  [`core/AGENTS.md`](../../core/AGENTS.md).

## Destination

A frontend developer's agent sends a question to the role `backend`. The developer who holds
`backend` sees it the next time a session starts, whatever agent they use and whichever repo they
are in. The answer comes back the same way. Each repo's API surface is readable from the brain, so
"who calls `/orders`" needs no clone. A team that plans in ServiceNow or Jira sees each ask there,
and the status moves back without anyone copying it.

## Decisions

| # | Decision | Alternative it beat |
|---|---|---|
| R1 | **`team.json` at the team-brain root is the one machine-read config.** It holds `source` (#622), `members`, `integrations`, `primary` and `routes` (#624: a per-role or per-project tracker override, named `routes` because a top-level `roles` would read as the members' roles). `team.md` stays prose for people | A `## Members` list parsed out of `team.md`. Two people editing prose is a merge conflict, and prose is not a schema |
| R2 | A member is `{ handle, roles: [], projects: [], github? }`. **`handle` is the author slug from `core/author.js`**: `CORTEX_AUTHOR`, otherwise the slug of git `user.name`. Whoever is named in memory files is named the same way in asks | Email as identity. ADR-level rule T6 of the team-memory design: no email address is written to a path or a header |
| R3 | The caller is resolved the same way. A caller whose handle is not in `members` can still send asks and read asks addressed to the projects of the repo they are in. `inbox` says it could not place them and names the variable to set | Refusing to start for an unknown member |
| R4 | An ask is `asks/<id>.md` in the team-brain. Frontmatter: `id`, `from` (handle), `fromProject`, `to`, `toKind: role\|project`, `status: open\|answered\|decided\|wontfix`, `created`, `updated`, `links: []`. The body is the question. Each answer is appended as `## Answer · <date> · <handle> · <status>`. The id comes from `lib/noteid.js` | One file per message. A thread split across files is the thing an inbox has to stitch back |
| R5 | **`to` must name a role some member holds, or a project in `projects/`.** Anything else is refused, and the refusal lists the roles and projects that exist (#620's acceptance) | Accepting it and letting nobody see it |
| R6 | **Four new MCP tools, grouped by intent:** `ask` (send), `inbox` (read mine), `answer` (reply, optionally change status), `contract` (read a project's surface with `project`, or who calls an endpoint with `calls`). There is no separate `who_calls`. Anthropic's guidance is to group tools by intent, and tool choice degrades past 30–50 definitions ([folding subagents](https://claude.com/resources/articles/building-agents-when-to-fold-subagents-into-your-main-agent-loop)) | One tool per verb in the issues: `ask`, `inbox`, `answer`, `contract`, `who_calls`, `team_init`, `team_add` |
| R7 | **The four tools run in either mode (`mode: ANY`) and need audience `team`.** On a solo brain they refuse with one sentence naming `/team-add`. In repo mode the brain's `teamClone` is used, and it is cloned on first use from the connector's `teamBrainRepo`. Its directory is gitignored in the product repo, which `index/lib/generated.mjs` already does for `.cortex/` or must be extended to do | Vault mode only. That leaves out exactly the plugin install, which is a repo-mode server |
| R8 | `ask` and `answer` are `writes: PUBLISHED` and take their text in `content`. The existing gate in `server.js` scrubs them. They commit and push the way `capture` does, and on `lab` they commit and do not push | A scrub call inside the new module, which is the shape ADR 0007 rejected |
| R9 | `inbox` and `contract` return `FOREIGN` text and carry `UNTRUSTED_NOTE` | — |
| R10 | **No hook for "N asks waiting".** The plugin ships no hooks ([ADR 0021](../adr/0021-cortex-ships-no-mod-and-keeps-the-claude-md-shim.md)). The server's `initialize` result carries `instructions`. On a team it says how many asks are open for the caller and tells the agent to call `inbox` at the start of a task. It reads the local clone and does not pull. Every MCP client reads `instructions`, so Claude Code, Copilot, Gemini CLI and Codex get the same line (#623 item 3) | A `SessionStart` hook, which only Claude Code runs and the plugin may not ship |
| R11 | `inbox` pulls (ff-only) first, as `catch_me_up` does. A failed pull is returned, never swallowed, and the local asks still come back | Reading only the local clone |
| R12 | **Contract extraction is deterministic and lives in `index/`.** `index/lib/contract.mjs` reads an OpenAPI or Swagger file when there is one, and otherwise the route handlers it can detect by regex. It records what the repo serves, the endpoints it calls (fetch, axios and similar call sites with a literal path) and the events it publishes or consumes where they are detectable. It writes `contract.json` to stdout or to a file. It never writes into a team-brain | Extraction in `mcp/`. It reads the index, and the leaves never import each other |
| R13 | **Publishing a contract is `mcp/`'s job:** `ai-os contract publish --file <contract.json>` writes `projects/<slug>/contract.json` and `contract.md`, and commits only when the content changed. `/team-add` runs extract then publish. The secret gate reads the whole JSON text | The index CLI pushing to git |
| R14 | `catch_me_up` reports contract drift: added, removed and changed endpoints since the date, computed from the brain's git history of each `contract.json` | A separate drift tool |
| R15 | **#623's setup is `tools/cortex-setup.mjs --agents claude,copilot,gemini,codex`.** It writes project-scope config where the agent has one, so it is committed once for the team, and user scope otherwise. It writes through the same merge discipline as `index/lib/shared-plugin.mjs`: parse first, never replace, refuse an unreadable file. Each agent's path and format is verified against that agent's current docs, and the check date is recorded in the file header | A setup per agent, or a plugin per marketplace |
| R16 | **Every team command is also an `ai-os` CLI command:** `ai-os ask`, `ai-os inbox`, `ai-os answer`, `ai-os contract`, `ai-os sync`, `ai-os integrations`. The CLI parses flags and calls the same `lib/` function the tool calls. The Claude skills say to run the CLI. Behaviour lives in one place | Skills that re-describe the behaviour |
| R17 | **Trackers are adapters behind one interface** (`create`, `read`, `comment`, `close`) in `mcp/lib/trackers/`: `github`, `servicenow` and `jira`. They use the global `fetch` (Node 20+), so there is no dependency. Configuration lives in `team.json → integrations`. Credentials come from environment variables only, and the adapter names the variable it needs | `gh` for GitHub. That gives the three adapters three transports and makes the GitHub tests depend on a binary |
| R18 | **Sync is idempotent, and each run is one commit.** The link is written to the ask's frontmatter before the remote call returns and is marked `pending` until it succeeds. The primary tracker wins on status, and the brain wins on the ask's text. Comments are de-duplicated by origin id. `ai-os sync --dry-run` prints the plan. A scheduled workflow is stamped into the team-brain repo from `templates/team-brain/sync.yml` | Sync only when an agent is open |
| R19 | **With no integration selected nothing touches the network except `git`.** A test asserts it by running the asks path with `fetch` replaced by a function that throws | Trusting it |
| R20 | **Tests never reach a real tracker.** Each adapter is tested against a local `node:http` server that plays the API's documented request and response shapes. The shapes are taken from the vendor's REST docs, and the URL and date are recorded in the adapter's header | Recorded fixtures from a live instance, which nobody here has |

## Build order

1. #622. It adds `team.json` with `source`.
2. #620: R1–R11. Roster, asks, the three tools, the CLI, `instructions`, and `/team-add` asking
   for the member's role.
3. #621: R12–R14.
4. #623: R15–R16, plus `contract` and the ask tools reachable from the CLI. A CI test compares the
   generated configs with fixtures.
5. #624: R17–R20. The GitHub adapter replaces #620's optional step 5 (the issue mirror).

Each step is one PR with its own changelog entry, and a release follows each.

## What is not built

- A web inbox or an email sender. Notification is the tracker's job (#624).
- Cross-team asks. `to` resolves inside one team-brain.
- Contract extraction for languages the indexer does not resolve. The summary says what it could
  not read, and an empty contract is a valid result (#621's acceptance).
