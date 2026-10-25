# mcp/ — the live brain

An optional Node MCP server exposing Cortex over stdio, plus the `ai-os` CLI. The busiest part of
the repo by commit count, and — like every other part — **dependency-free**.

## The `ai-os` CLI

| Command | Does | Needs |
|---|---|---|
| `ai-os setup-plugins` | install the Cortex Core plugin bundle | nothing |
| `ai-os setup-plugins --status` | per tier, which plugins are installed; `--json`, `--tier`, `--plugins-dir`. Read-only | nothing |
| `ai-os team init` | seed and push a team-brain | a vault |
| `ai-os team add` | write this repo's project file into the team-brain, then the connector | a vault |
| `ai-os team member` | add or update one member (`--handle`, `--roles`, `--projects`, `--job`) in the brain's `team.json`; commit, push | a root, a team |
| `ai-os ask` | send `--to <role\|project> --title --body` as `asks/<id>.md`; commit, push | a root, a team |
| `ai-os inbox` | pull, then the open asks for you and the answers to yours; `--json` | a root, a team |
| `ai-os answer` | append `--body` to ask `--id`, set `--status`; commit, push | a root, a team |
| `ai-os contract publish` | write `--file <contract.json>` as `projects/<slug>/contract.json` + `.md`; commit, push when changed | a root, a team |
| `ai-os contract show` | one project's contract (`--project`, `--path`); `--json` | a root, a team |
| `ai-os contract who-calls` | which projects call `--path "[METHOD] /p"`, and which serve it; `--json` | a root, a team |
| `ai-os contract list` | the projects that have published a contract | a root, a team |
| `ai-os integrations list\|add\|remove\|workflow` | the trackers in `team.json`; `workflow --write` commits the scheduled sync | a root, a team |
| `ai-os sync` | asks ↔ trackers, one commit per run; `--dry-run`, `--status`, `--clone <checkout>` | a root, a team |
| `ai-os project list` | every project the brain knows, as JSON; the same as `list_projects` | a vault |
| `ai-os project check` | validate the team's project files; exit 1 on an error or a withheld file | a vault, a team |
| `ai-os project remove` | delete one project file with `git rm`, commit, push | a vault, a team |
| `ai-os digest` | append a git digest to a file | nothing |
| `ai-os catch-up` | notes and history since a date | a repo or a vault |
| `ai-os graph <op>` | the `graph` tool's answer: `stats`, `node`, `neighbors`, `cluster`, `hubs`, `bridges`, `path`; `--json`. Exit 2 on a missing or stale index. Read-only | a repo, its index |

## Invariants

- **No runtime dependencies, ever.** A plugin install clones the repo and never runs
  `npm install`, so a declared dependency is simply absent on the user's machine. `lib/stdio.js`
  is the ~100-line MCP transport that replaced `@modelcontextprotocol/sdk` for exactly this
  reason. `core/test/install.test.js` fails the build if an import creeps back in. See
  [ADR 0004](../docs/adr/0004-no-runtime-dependencies.md).
- **Only protocol messages go to stdout.** A stray `console.log` corrupts the JSON-RPC stream and
  the client reports something unrelated. Diagnostics go to stderr, and **every stderr line the
  server writes starts with `cortex:`**. One path printed `ai-os-mcp:` until #552, so one process
  read in a client's log as two programs. `test/root-name.test.js` starts the server every way it
  can start or refuse to and checks each line.
- **Every tool result is capped in the transport, never per tool.** `capResult()` in
  `lib/stdio.js` holds a result to `MAX_RESULT_CHARS` (40,000 — about 10k tokens, under 14k even
  at 3 characters per token) and replaces an oversized one with a parseable document marked
  `truncated: true` plus a hint to narrow the request. Claude Code cuts MCP output at 25,000 tokens
  by default; `recall_memory` returned 272,000 characters on a year of memory before this. Do not
  raise the cap to fit a tool — give the tool a way to return less.
- **Memory is read through `core/memory.js`, in both layouts.** `recall_memory` and the repo half
  of a catch-up call `recent()` and hand on its rows: one per file, a day file (`<date>.md`,
  `author: null`) or one author's file of a day (`<date>/<author>.md`, `author` the slug from the
  path). `days` and `since` count days, so every file of a day comes back together. Do not list
  `.cortex/memory/` here. `recall` in repo mode needs no rule of its own: it searches every `.md`
  under `.cortex/` through the Vault, and the path of a hit names the author. More authors mean
  more text for the same `days`; the transport cap below is what stops it, and it says so.
- **`remember` passes no author; `core/memory.js` finds it** (`CORTEX_AUTHOR`, then git
  `user.name` in the repo). The result is `{ path, day, author, layout }`. `layout` is `"author"`
  for `<date>/<author>.md` and `"day"` when no name was usable and the entry went to `<date>.md`;
  only then is there a `notice`, which is how the model learns to tell the person. Do not drop it.
  A test that spawns the server sets `CORTEX_AUTHOR` (`serverEnv` in `test/mode.test.js`), so it
  never reads the machine's git name.
- **`server.js` stays a thin switch.** All logic lives in `lib/`; the transport layer is a
  dispatch over tool names and nothing more.
- **`ai-os.js` parses flags and prints; it decides nothing.** It exports nothing and exits at
  module level, so a decision made in it can only be tested by starting a process. Three used to
  live there and are in `lib/` now: which sources, repo and project a catch-up reads (`catchUp` in
  `lib/catchup.js`), what `project check` counts as a problem (`checkProjects`), and the order of a
  join, project file before connector (`joinProject`, both in `lib/project-files.js`). The team a
  catch-up reads is `catchUpTeam`, which the server calls too. A new rule goes in `lib/` with a
  test that imports it; the subprocess tests are for wiring.
- **Two modes, decided by the root — never configured.** A root ending in `.cortex` is
  **repo mode** (`recall`, `remember`, `recall_memory`); anything else is **vault mode** (the
  personal-brain tools). Detection keeps the plugin manifest to one env var and makes a
  misconfiguration visible as a changed tool list.
- **The root has two names, and `rootFromEnv` in `core/paths.js` is the only code that orders
  them.** `CORTEX_ROOT` is the name to set. `AI_OS_ROOT` is what a registration made before #552
  carries: it is read with no warning and has no removal date, because that line lives in a user's
  config. `CORTEX_ROOT` wins when both are set, an empty value counts as unset, and two different
  paths produce one `cortex:` line on stderr from whichever adapter opened the brain
  (`brain.notices`). In `mcp/`, `lib/resolve.js` is the one caller; `brain.sources.root` says which
  variable answered, and `MissingRootError` names that one. A set `CORTEX_ROOT` that does not exist
  is refused and never swapped for a good `AI_OS_ROOT`. The plugin manifest sets `CORTEX_ROOT`
  alone, so a vault path in the user's own environment cannot take over the repo's server
  (`core/test/plugin.test.js`). **Not renamed, each because a command or a config a user already
  has would break:** the file `ai-os.js`, the CLI command name `ai-os`, the package name
  `ai-os-mcp`. Its `bin` map also answers to `cortex-mcp`.
- **Vault tools are hidden *and* refused in repo mode.** Offering `capture` or `catch_me_up` there
  invites an agent to write `inbox/` and `daily/` into someone's product repository — and a client
  that already knows the name never reads `tools/list`, so hiding is not refusing. Which mode a tool
  runs in is a field on its declaration in `lib/tools.js`; `toolsFor()` derives the advertised list
  and `assertAvailable()` derives the guard, so the two cannot disagree and a new tool cannot be
  added without saying where it runs. `mode.test.js` asserts the exact list for both modes **and**
  that a vault tool invoked in repo mode comes back refused with nothing written.
- **A tool that returns someone else's text says so in its description.** `recall`,
  `recall_memory`, `get_project_context`, `list_projects`, `catch_me_up`, `inbox`, `contract` and `graph` all hand the model text
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
  The refusal stays in `core/`: it refuses rather than sanitises and names only the kind. The gate
  is `core/gate.js` — the credential scan, the employer denylist on `home`, personal data under
  `CORTEX_PII` — and `server.js` passes `brain.policy`, so the profile comes off the brain opened
  once. What it returns without refusing (`warnings`) rides back on the tool result; a caller that
  drops it hides a personal-data warning from the model that should tell the person.
  `contract.js` and `project-files.js` write published files outside the table and apply the
  credential scan and the denylist themselves.
- **A root that does not exist is a hard exit too** (`MissingRootError`, `lib/brain.js`, #550). The
  server used to start on it and fail in the first tool an agent called, with a raw `ENOENT`. In repo
  mode the directory that must exist is the repo, not `.cortex/`: the first write creates that. This
  holds for `ai-os catch-up` as well. A root that is set and wrong is not the unset root it may
  degrade on.
- **A root that is not set is a hard exit**, not a default: neither `CORTEX_ROOT` nor `AI_OS_ROOT`
  holds a non-blank value. Guessing a vault path would write someone's
  notes into the wrong place. `lib/resolve.js` upholds this — it throws `NoRootError` rather than
  falling back, and the three-mode spec's fallback chain was rejected on exactly these grounds
  ([ADR 0008](../docs/adr/0008-three-audiences-one-seam.md)). **Two CLI commands degrade instead,
  `ai-os catch-up` first.** It writes nothing, and with no root it reads only the git repository the cwd
  sits in — that repo's committed `.cortex/memory/` and its log — never a vault, and says in
  `skipped` which half it did not read. That is what a plugin install has: no vault, only the repo
  it was opened in, and `/whats-changed` failed on its first command there. It does not open a brain
  with an inferred root; it opens none (`open(…, { rootOptional })` in `ai-os.js`), so nothing
  downstream can mistake the repo for a place to write. `openBrain` resolves the profile *before*
  the root for this reason — a misspelt `CORTEX_PROFILE` still fails at entry. A second command
  wanting the same exemption must also write nothing; anything that writes stays a hard exit.
  `ai-os graph` is the second: it reads one index and writes nothing, and with no root it reads
  the git work tree the cwd sits in (`graphRepo`, `lib/graph.js`).
- **`capture`'s `team` argument is an override, not the switch.** The team comes from
  `lib/resolve.js` — a repo with a `.cortex/connector.json` writes to the team brain without the
  caller knowing it is on a team. Requiring the agent to pass `team` was the seam leaking. Do not
  reintroduce it as a required argument.
- **The connector names the team and the project in two fields: `{ team, project, teamBrainRepo }`.**
  It used to be `{ slug, teamBrainRepo }`, with `team add` writing the project into `slug` and the
  resolver reading it as the team, so every connected repo captured into `team/<project>/`, a
  directory that was not a clone. Old connectors are still read (`legacyTeam` in `resolve.js`
  matches the clone by its `origin`); do not reintroduce a field that means two things. A fourth,
  optional field, `source`, is the team's Cortex fork: `team init --source` writes it to the
  brain's `team.json`, `team add` copies it here (`readTeamSource`, `lib/team.js`), and
  `core/source.js` reads it. The resolver here ignores it.
- **Asks are one file per thread, `asks/<id>.md`, in the team-brain** (#620,
  [the design](../docs/specs/2026-10-24-team-brain-rollout-design.md) R1–R11). `lib/ask-file.js` owns
  the file's format, `lib/asks.js` the addressing and the inbox, `lib/roster.js` `team.json`'s
  `members`. `lib/sync.js` reads asks through `ask-file.js` and never imports `asks.js`, which calls
  it: the two imported each other until the format moved out. The rules:
  - **`to` is a role some member holds or a project in `projects/`, else refused** with both lists.
    A name that is both is the role. Never accept an addressee nobody is placed to see.
  - **The caller's handle is the memory author** (`core/author.js`, asked in the product repo in
    repo mode). A caller not in `members` still reads the asks for the connector's project, and
    `inbox` returns a `notice` naming `CORTEX_AUTHOR`. Do not refuse them.
  - **`ask`, `inbox` and `answer` are `mode: ANY` and need a team**: on a solo brain they throw
    `no_team`, naming `/join-team`. The clone is the brain's `teamClone`, cloned on first use from
    the connector's `teamBrainRepo` (`ensureTeamClone`, `lib/team.js`). In repo mode that is inside
    the product repo, so `.cortex/team/` is added to its `.gitignore` first, on every call, through
    `core/gitignore.js` — `index/lib/generated.mjs` uses the same writer.
  - **The gate covers every field written into the pushed file.** A row's `alsoPublishes` names
    arguments besides `content` that `assertPublishable` scans — an ask's `title` and `links`.
    `assertWellFormed` refuses a name the schema does not take. The CLI calls `assertPublishable`
    with the tool's name before it calls `lib/`, so both adapters pass the same gate.
  - **A member's `job` is one of `core/job.js`'s five words and never refuses anything.** It
    decides what the rituals offer first. A reader keeps a member whose job is wrong, reports it in
    `rosterErrors` and reads it as `developer`, as it reads no job; `setMember` refuses it, and
    keeps the recorded job when none is passed. `inbox` returns it as `me.job`, which is where
    `/setup-repo` and `/resume-work` read it.
  - **`inbox` pulls ff-only first, and a failed pull is returned in `pull`**, with the local asks.
  - **The start-up count is `instructions` on the `initialize` result** (`asksInstructions`), not a
    hook (ADR 0021). It reads the local clone, never pulls, never throws: a failure drops the count.
  - Asks and answers commit one path with `commitPath` and push only when `policy.outwardSync`
    allows; on `lab` the result says `outward_sync_disabled`.
- **Trackers are adapters behind one interface, and sync is the only caller** (#624, the design's
  R17–R20). `lib/trackers/{github,servicenow,jira}.js` each give `find`, `create`, `read`,
  `comment`, `close` over `lib/trackers/http.js`; `lib/integrations.js` owns `team.json →
  integrations | primary | routes`; `lib/sync.js` owns the run. The rules:
  - **The network is reached only when the team selected a tracker, and never on `lab`.**
    `syncAsks` returns before naming an adapter when `integrations` is empty or
    `policy.outwardSync` is false — calling a tracker is publishing. `trackers.test.js` runs the
    asks path with `fetch` replaced by a function that throws (R19). `fetch` is looked up at call
    time, so that test exercises the real path.
  - **Idempotent by construction.** The link (`{ kind, state: "pending" }`) is written to the ask
    file before `create` is called, and `find` searches the tracker for the ask's marker
    (`[ask:<id>]` in a GitHub title, `correlation_id` in ServiceNow, a label in Jira) before
    anything is created. Comments Cortex posts end with `[cortex:<ask>/<entry>]`, so a pull skips
    its own and a push skips what the tracker already holds. A run that learns nothing writes
    nothing, and so commits nothing; do not add a field that changes on every run.
  - **Conflicts:** the primary wins on status, and only when its status changed since the last
    sync (`link.status`) — an answer in the brain is not undone by a tracker it has not reached.
    The brain wins on the text. Pull from every tracker before pushing to any, or a comment takes
    two runs to cross and the second run commits.
  - **Scrub both ways.** Every text posted out and every comment pulled in passes `core/scrub.js`;
    a comment carrying a credential is withheld and the brain records only that it was.
  - **No credential in `team.json`**: `checkIntegration` refuses a key named like one and any
    credential-shaped value, and adapters read the environment only, naming the variable when it
    is missing. A missing credential leaves the link `pending`; it never fails the ask.
  - **`syncAfter` never throws**, and returns null with no integration, so `ask`/`answer`/`inbox`
    results on a team without trackers are the ones #620 shipped. No MCP tool configures trackers.
  - Removing an integration keeps its links in every ask; sync ignores a link whose kind is not
    selected, and `sync --status` lists it as inactive.
  - `templates/team-brain/sync.yml` is rendered by `lib/sync-workflow.js`, printed by default and
    written only with `--write` (ADR 0009).
- **A contract is `projects/<slug>/contract.json` plus `contract.md`, and `lib/contract.js` owns
  both** (#621, the design's R12–R14). `index/cortex-contract.mjs` extracts it; this package
  publishes and reads it. The rules:
  - **Publishing re-serialises; it never copies.** `parseContract` keeps the known keys, caps every
    string, sorts every list and refuses a file path that is absolute or climbs out. The bytes are
    a function of the contract, so an unchanged republish is no commit.
  - **The gate is in `publishContract`, on the input text and on the text written.** No tool row
    publishes a contract — it is a CLI step of `/join-team` — so the one function that writes is
    the act the guarantee attaches to (ADR 0016). Do not add a second write path around it.
  - **`contract` is one tool for two questions** (R6): `project` (narrowed by `path`) or `calls`.
    There is no `who_calls`. It is `mode: ANY`, team only, `FOREIGN`, `LOCAL`, and pulls ff-only
    first, returning a failed pull in `pull`.
  - **Matching is the route map's**, through `core/route-path.js`: one normal form (`/items/{}`), and
    a call's `{}` meets only an endpoint's `{}`. A question may carry a method and a trailing slash.
    Every answer is a floor and says so.
  - **Drift reads git, not the files**: `contractDrift` compares HEAD with the last commit before
    the day (`revBefore`, with `sinceArg` turning `YYYY-MM-DD` into midnight, since git reads a
    bare date as that day at the current time). Bounded per project and in projects.
- **`catch_me_up` pulls (ff-only) and reads the team's notes, not only its log.** A failed pull is
  returned in `pull`, never swallowed, and the local notes still come back; team notes are bounded
  in `catchup.js` so the result fits under the transport cap rather than being cut by it. Its
  `contracts` field is each project's contract drift since the date.
- **Every vault path goes through `lib/vault.js`** — not through `resolveInRoot` directly. The Vault
  is the only module here that joins onto a vault root or calls `node:fs` on one; it wraps
  `core/paths.js` so the guard is unavoidable rather than remembered. If you need an operation it
  does not have, add it to the Vault — do not reach around it.
  The full surface is `list` · `entries` · `read` · `append` · `write` · `remove` · `abs` ·
  `exists` · `isFile` · `isDirectory` · `mtimeMs`, all taking root-relative paths. `remove` deletes
  one regular file and refuses a directory, a link and a missing file; there is no recursive form,
  because notes live in folders.
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
  `openBrain({ cwd, env })` returns `root · mode · isRepo · audience · team · teamClone · project · teamBrainRepo · env ·
  profile · policy · sources · notices · describe()`, and throws `NoRootError` /
  `UnknownProfileError` **before** a command picks a branch. Neither adapter may read
  `env.CORTEX_ROOT` or `env.AI_OS_ROOT`, or call `resolve.js`,
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
  requirement wearing a fix's clothes. Skills reach the CLI as
  `node "${CLAUDE_PLUGIN_ROOT}/mcp/ai-os.js"`, never `<vault>/mcp/…`: a plugin install has no vault
  checkout, and `test/rituals-on-a-plugin-install.test.js` runs each command as its SKILL.md prints
  it, from a copy laid out like the plugin cache.
- **Every path that publishes must consult `policy.outwardSync` — including the CLI.** `lab` exists
  to be permissive locally *because* it is sealed outward, so the seal is the load-bearing half;
  `core/profile.js` calls a `lab` that still pushes "the leak with extra steps". For a while that is
  what `initTeamBrain` was: `capture()` honoured the policy and the team-brain push did not, and
  `ai-os.js` imported `core/profile.js` nowhere, so a misspelt `CORTEX_PROFILE` was a hard exit in
  the server and a silent default in the CLI. Both adapters now take the policy off the record
  `lib/brain.js` opens at entry, which is where the profile is resolved once. A new publish
  path that does not is the same bug again — write locally, decline the push, and tell the caller
  which, the way `capture()` does.
- **Every call that reaches a remote checks the destination first** (`core/destinations.js`,
  [ADR 0030](../docs/adr/0030-on-a-work-profile-nothing-leaves-except-to-an-approved-destination.md)).
  `pull`, `commitAndPush` and `pushHead` in `lib/gitsync.js` take `{ policy, env }` as a required
  option and check every URL git resolves for the clone's remotes (`remote get-url --all`, with
  `--push` for a push) before git runs; a refusal comes back as `error: "unapproved_destination: …"`
  in the shape a git failure already had, and `commitAndPush` keeps its commit. `cloneTeamBrain`
  takes the same option and throws before anything is created; `initTeamBrain` checks its push.
  `request` in `lib/trackers/http.js` checks the URL as `https` and never calls `fetch` on a
  refusal; `io.policy` comes from `syncAsks`. The env is `brain.env`, the environment `openBrain`
  was handed, so a lib function given the brain has both halves. A new outward call is the same
  bug as a new publish path that skips `outwardSync`: route it through the check, and add it to
  `test/destinations.test.js`, which runs git with `GIT_ALLOW_PROTOCOL=file` so a call that slips
  past fails on git's own transport error, not on the network.
- **A project file is written, listed and removed by `lib/project-files.js`, and judged by
  `core/project-file.js`.** A project file is `projects/<slug>.md` at the top of a team-brain, and
  a workspace is the set of them ([ADR 0024](../docs/adr/0024-a-workspace-is-project-files.md)).
  The rules that hold for every caller:
  - **The gates run before the write, in one order: valid, allowed by the profile, free of
    secrets.** `judge()` is the only way to a write. The first refusal throws `ProjectFileRefused`
    and leaves both repositories as they were. `ai-os team add` writes the connector last, so a repo
    whose project is refused has not joined.
  - **The profile check takes the policy object, never a profile name.** `profileRefusal(data,
    policy)` reads `policy.refuses`, and both adapters pass `brain.policy`. Do not write
    `brain.profile === "home"` at a call site. On a profile that refuses employer material, the
    writer refuses the whole file and `list_projects` returns `{ slug, path, source, withheld }` for
    it: title, links and relations are withheld, and the file is never deleted or moved.
  - **The check is a floor.** It recognises a private-network host and a tenant of a few hosted
    work tools. Never describe a file that passed as cleared, in a message or in a skill.
  - **A credential is refused, not stripped.** An `origin` carrying one stops `team add` with a
    request for `--project-repo`. The text is also passed through `core/scrub.js` before the write,
    because it is about to be pushed.
  - **An existing file is left byte for byte** unless a field flag is passed. Then
    `setFrontmatter` changes those lines only and the whole file is judged again. With no flag, an
    existing file the profile refuses stops the join: the file stays as it is and no connector is
    written. Reporting it as withheld and joining anyway was #586's open choice, settled 2026-10-12.
  - **No repo, no file.** A checkout with no usable `origin` and no `--project-repo` still joins;
    its project is listed as `unregistered`. A project file with no `repo` is never written.
  - **Removal resolves the slug against the team's `projects/` directory, through the Vault's
    `remove`.** That root is what makes `../x` an `OutsideRootError` and not a string check. After
    the guard the target must be a slug, exist, and parse as `type: project`. Removal runs `git rm`
    and commits `project: remove <slug>`. It never deletes the notes folder and never edits another
    file's `related:` line; it reports both in `left`.
  - **Every commit is pushed only when `policy.outwardSync` allows.** On `lab` the commit stays
    local and the result says `outward_sync_disabled`, for a write and for a removal.
  - **`list_projects` grew fields, not a tool.** Each entry has `source: "vault" | "team"`. A vault
    entry is a project stub or a notes folder; a team entry is a project file. The two share a
    filename and are never merged. A `.md` under the team's `projects/` with no `type: project` is
    skipped and counted. `ai-os project list|check|remove` are the CLI's half and are refused in
    repo mode, because the clone lives under the vault.
  - **A link is never fetched**, here or in `core/`. No title lookup and no reachability check.
- **`setup-plugins --status` reads and never installs** (#548). It starts no `claude` and writes
  nothing; `test/rituals-on-a-plugin-install.test.js` compares the whole tree. The registry is read
  by `core/plugin-registry.js`, and `tierStatus` (`lib/setup-plugins.js`) is handed the result, so
  it has no path of its own. A registry that was not read makes every tier `unknown` and every
  plugin's `installed` `null`: do not turn that into `false`, which reads as "offer it". The
  findings offer a tier from the index alone, because the index may not read the machine
  ([`index/AGENTS.md`](../index/AGENTS.md)); this is the machine's half, and
  `/setup-repo` and `/connect-mcp` ask it before they offer one.
- **`mcp/` never imports from `index/`.** When both need the same rule, the rule moves to `core/`
  and `index/` re-exports it. `core/route-path.js` was the first; the `graph` tool is the second.
- **The `graph` tool answers from the index `index/` wrote, through `core/`, and never spawns or
  imports the indexer** (G3 of [the code-graph design](../docs/specs/2026-10-25-code-graph-design.md)).
  `lib/graph.js` holds the ops; its header holds the rules. The seam was a choice between three:
  - **Chosen: the computation moved to `core/`.** `core/graph.js` scores hubs and bridges and
    finds cycles; `core/path-kinds.js` holds the area and fixture rules the score reads;
    `core/index-file.js` reads `index.json` and `enriched.json` and decides whether the index is
    stale. Each depends on nothing in a leaf, so the move was a move. `cortex-graph.mjs --json` and
    the tool return equal hubs and bridges because they run one function, and
    `test/graph.test.js` checks it on a fixture repo.
  - **Rejected: a reader in `mcp/` that recomputes.** `node`, `neighbors`, `cluster` and `path` are
    plain reads and would have been fine, but hubs and bridges are scored, and a second copy of a
    score drifts the first time the score changes. The freshness rule is the same case: "stale"
    has one definition (`index/AGENTS.md`), and `mcp/` could not reach it in `index/lib/open.mjs`.
  - **Rejected: spawning `cortex-graph.mjs --json`.** It welds the server to the indexer at run
    time, which is the dependency the layering forbids, with a process boundary hiding it. It also
    pays for coverage, which reads every file's text, on every call.
  - **The rules it keeps:** repo mode only, read-only, `returns: FOREIGN` (a file's summary is
    model-written prose). A missing, unreadable, wrong-format or stale index is refused with the
    command that rebuilds it, never answered from; outside git, freshness is `unknown` and said.
    The question is checked before the index is read, and every file argument goes through
    `resolveInRoot`, so a path out of the repo is an `OutsideRootError` whatever the index's state.
    Lists stop at `LIST_MAX` (50) and carry `total` and `truncated`; `hubs` and `bridges` are the
    report's top ten with `bridgeCount`. Validated on eight cloned repos: hubs, bridges and every
    count equal to `cortex-graph.mjs --json`. 20 guards mutated (freshness, the guard, the caps),
    20 test failures.

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
