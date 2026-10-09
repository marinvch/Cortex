# Design: a workspace is project files, and one page shows them together

- **Date:** 2026-10-09
- **Status:** Approved under the maintainer's delegated approval of 2026-10-09. Every decision taken
  on that authority is listed below so it can be reversed.
- **Parent:** [the next-level roadmap](2026-10-04-next-level-roadmap-design.md), Part 3. Plan step
  3.0 of [the plan](../plans/2026-10-04-next-level-roadmap.md); it gates steps 3.1, 3.2 and 3.3.
- **Record:** [ADR 0024](../adr/0024-a-workspace-is-project-files.md); the terms *project file* and
  *workspace* in [`CONTEXT.md`](../../CONTEXT.md).
- **Area:** `core/` (a new `project-file` module), `mcp/` (the writer, the listing, removal),
  `index/lib/view*.mjs` and `index/cortex-view.mjs` (a workspace page), `index/lib/routes.mjs`
  (relations), `skills/team-add/`, `skills/team-init/`, `skills/cortex-view/`. Scoped briefs:
  [`core/AGENTS.md`](../../core/AGENTS.md), [`mcp/AGENTS.md`](../../mcp/AGENTS.md),
  [`index/AGENTS.md`](../../index/AGENTS.md).

This step writes no code. It fixes what the three build steps may not decide for themselves.

## Decisions taken for the maintainer

One line each, with the alternative, so any of them can be reversed without re-reading the spec.

| # | Decision | Alternative not taken |
|---|---|---|
| D1 | A project file is `projects/<slug>.md` at the top of a team-brain, beside the notes folder `projects/<slug>/` | A new folder such as `workspace/`: a second place to look, and the parent spec already names `projects/` |
| D2 | The format is flat frontmatter, one `key: value` per line, then free prose | Nested YAML (`links:` as a map, lists): needs a parser Cortex does not have (ADR 0004) |
| D3 | Four link fields, one URL each: `repo`, `tracker`, `design`, `docs` | A list per kind, or a fifth kind `api`: an API reference goes in `docs`; more links go in the prose |
| D4 | `repo` is required | Optional `repo`, so `/team-init` could seed files from slugs alone: a project with no repo has nothing to index or relate |
| D5 | An unknown frontmatter key is a validation error | Ignoring it: a misspelt `trakcer:` would drop a link with no word said |
| D6 | No `status` field. A project that is gone is a deleted file | `status: retired`: two ways to say the same thing, and a page that must explain both |
| D7 | The parser and validator live in `core/project-file.js` | Importing `tools/cortex-frontmatter.mjs`: neither leaf may reach `tools/`, and both leaves read this file |
| D8 | An employer-shaped link is recognised by its host: a private-network host, or a tenant of a hosted work tool from a short list kept as data | An allow-list of public hosts: refuses a personal project's own docs site, and grows without end |
| D9 | The check is a floor and says so. A file that passes is not cleared | Claiming detection: ADR 0015 already says employer content cannot be detected deterministically |
| D10 | Under `home` the writer refuses the whole file; a reader shows the slug and the reason and withholds everything else | Dropping only the offending link and writing the rest: sanitising, which the firewall forbids |
| D11 | `list_projects` gains team entries; no new MCP tool | A `list_workspace` tool: one more description in every session for a read the existing tool can carry |
| D12 | Removal is `ai-os project remove`, documented in `/team-add`; no new ritual | A `/team-remove` ritual: description budget (ADR 0020) and trigger evals for a rare act |
| D13 | Removal deletes the file with `git rm` and a commit. The notes folder and other files' `related:` lines are left alone and reported | Archiving the file, or editing the files that still point at it: git history is the archive, and Cortex does not rewrite someone's file on its own authority |
| D14 | `/team-init` keeps seeding notes folders and writes no project file | Seeding stub files without `repo`: see D4 |
| D15 | The workspace page is a second file, `workspace.html`, made by `cortex-view.mjs --workspace`. The plain command is untouched | A Workspace tab on the repo page: changes today's page for every connected repo |
| D16 | The page takes the team-brain as a path (`--team-brain`), or finds one beside the checkouts. `index/` never reads `AI_OS_ROOT` | Resolving the clone through the brain: `index/` may not import `mcp/` |
| D17 | A checkout is matched to a project by its connector's `project`, then by its `origin` URL | Matching by directory name: a clone can be named anything |
| D18 | A found relation is a solid arrow, a declared one a dotted line with a ring at each end, and every line carries its word | Solid against dashed: a dashed box already means *missing* on the Structure tab |
| D19 | The relation diagram is drawn for up to 24 projects. Past that the page shows the table alone and says so | A diagram at any size: unreadable, and the table is the complete form anyway |
| D20 | The workspace page carries a Content-Security-Policy that forbids every request | Trusting review to keep fetches out: a guarantee code can keep belongs in code (ADR 0016) |
| D21 | Without a team-brain, `--workspace` on one repo writes the same bytes as the plain command; on several it draws a card per checkout with no links | Refusing without a team-brain: `cortex-routes --workspace` already works there |
| D22 | A personal vault's `projects/<slug>.md` is a *project stub* and is not part of any workspace | One format for both: the stub carries a machine path, which a shared file must never hold |

## Destination

- A team-brain lists its projects as files. Each file names the project's repo, up to three outside
  links, and the projects it relates to.
- `/team-add` writes the file when a repo joins. A file is validated the same way wherever it is
  read. A project is removed by one command.
- A file with an employer-shaped link is refused on a `home` profile.
- `/cortex-view` can render one page for the whole workspace: every project, its links as text, and
  how the projects relate. A relation is marked found, declared, or absent.
- A repo with no team-brain is rendered exactly as it is today.

## Context

- **What a team-brain holds today.** `seedTeamBrain` in `mcp/lib/team.js` writes `team.md` and one
  folder per project, `projects/<slug>/`. `capture` files notes into those folders. Nothing in the
  team-brain says where a project's repo is, or what it links to.
- **What joins a repo to it.** `ai-os team add` clones the team-brain under the member's vault at
  `team/<team>/` and writes `.cortex/connector.json` as `{ team, project, teamBrainRepo }` into the
  product repo.
- **What already reads `projects/`.** `teamNotes` in `mcp/lib/catchup.js` skips a file directly
  under `projects/` ("belongs to no project"), so a project file there is not returned as a note.
  `listProjects` in `mcp/lib/projects.js` lists a personal vault's `projects/`, not a team's.
- **The word is taken.** The route-map spec defines a workspace as "every immediate child directory
  with a `.git`, minus team-brains", and `cortex-routes.mjs --workspace` takes such a directory.
  `index/lib/resolvers.mjs` uses "workspace" a third way, for a JS monorepo's packages. Section 1
  settles which meaning the glossary keeps.
- **The firewall is prose.** `core/profile.js` stores `refuses` per profile as a direction rituals
  consult, and enforces only `outwardSync`. ADR 0015 records that detecting employer content
  deterministically "is not possible, and pretending otherwise would be worse than the honest
  prose".
- **The page today.** `index/cortex-view.mjs` renders one repo to `.cortex/view/repo.html`. Tests
  hold it to no remote script or stylesheet, 7:1 contrast computed from `THEMES` and `CONTRAST`, no
  size under 13px, the same bytes for the same index, and no machine path.

## 1. A workspace and a project file

**A workspace is the set of project files in one team-brain.** It is not a store, a database, a
manifest or a directory of checkouts. Adding a project is adding a file. Removing one is deleting a
file. Git syncs it, and nothing else does.

**The directory of checkouts keeps its job and loses the name.** A machine reaches a project's code
through a checkout, and which projects are checked out differs per developer. The route map still
reads a directory of checkouts, and its flag is still `--workspace`. In prose that directory is "the
checkouts"; the workspace is the files. Where there is no team-brain, the checkouts stand in for
the workspace, each as a project with no links (D21). That keeps `cortex-routes.mjs --workspace`
working as it does now.

**A project file** is `projects/<slug>.md` at the top of a team-brain. On a member's machine that
is `<vault>/team/<team>/projects/<slug>.md`.

- The slug is the filename without `.md`. It must match `^[a-z0-9]+(-[a-z0-9]+)*$`, be at most 64
  characters, and equal the `project` a connector names.
- The file opens with frontmatter between two `---` lines. The grammar is the subset
  `tools/cortex-frontmatter.mjs` holds skills to: one `key: value` per line, the value plain or
  quoted, no nesting, no block scalar, no list syntax.
- Everything after the frontmatter is free prose. The page shows its first paragraph, cut at 280
  characters and escaped. A URL in the prose stays text.
- A `.md` file in `projects/` whose frontmatter has no `type: project` is not a project file. It is
  skipped and counted, so a README there is not an error.

### Fields

| Key | Type | Required | Rule |
|---|---|---|---|
| `type` | the word `project` | yes | exactly `project`. It is what tells a project file from a note (`type: brain-note`) |
| `title` | one line of text | yes | 1 to 80 characters |
| `repo` | link | yes | an `https://` URL, or the `user@host:path` form git uses for SSH. No password, no token, no query, no fragment |
| `tracker` | link | no | an `http://` or `https://` URL. No password or token in it |
| `design` | link | no | as `tracker` |
| `docs` | link | no | as `tracker`. An API reference goes here |
| `related` | slugs, separated by commas | no | each a valid slug, none repeated, none the file's own. A slug with no file is a warning |
| `created` | date | no | `YYYY-MM-DD` when present. The writer sets it |

Any other key is an error that names the keys above (D5). A repeated key is an error.

**The four links are `repo`, `tracker`, `design` and `docs`. They are shown and never fetched.**
Cortex reads the characters of a link and nothing behind it: no request, no title lookup, no icon,
no check that it answers. That holds in the validator, the listing and the page.

Validation returns `{ ok, data, errors, warnings }` and never throws. An error names its line and
its key. Two rules are warnings because another file causes them: a `related` slug with no project
file, and two files naming the same `repo`.

**Rejected here.** JSON (no prose, and a team edits these in pull requests). Full YAML (D2). A
`path:` key for the checkout (a machine path in a shared file; the connector rule in `/team-add`
already forbids it). A `status` key (D6). Putting the links in each product repo's connector (the
workspace could then be listed only by cloning every repo).

## 2. Who writes, validates, lists and removes

**One module owns the format.** `core/project-file.js` exports the parser, the validator, the link
shape (section 3) and the renderer that writes a file from fields. `core/` because both leaves need
it and neither may import the other. It reads no file and no environment: text in, a result out.
The slug rule moves with it, so `index/` does not grow a third copy.

**`/team-add` writes it.** `ai-os team add` already takes `--name`, `--repo` (the team-brain) and
`--project`. It gains `--title`, `--project-repo`, `--tracker`, `--design`, `--docs` and
`--related`.

1. The fields are assembled. `repo` is `--project-repo`, or else the product repo's `origin`. An
   `origin` carrying a password or token is refused with a request for `--project-repo`; it is not
   stripped and written.
2. The file is validated, then checked against the profile (section 3), then passed through
   `core/scrub.js`, because it is about to be pushed. Any refusal stops here with nothing written to
   either repo.
3. If `projects/<slug>.md` does not exist it is written. If it exists it is left byte for byte,
   unless a field flag was passed; then only those frontmatter lines change, the prose is untouched,
   and the whole file is validated again.
4. The team-brain clone is pulled fast-forward only, the file is committed as `project: add <slug>`
   and pushed. `policy.outwardSync` decides the push, as it does for `capture`: on `lab` the commit
   stays local and the caller is told `outward_sync_disabled`.
5. The connector is written as today. The product repo is still never committed for the user.

Every path goes through `mcp/lib/vault.js`. `/team-init` is unchanged apart from its hand-off text
(D14); a folder under `projects/` with no file beside it is listed as *unregistered*.

**The brain lists them.** `list_projects` keeps its entries and adds one per project file when the
brain has a team clone. Each entry has `slug` and `path` as now, plus `source: "vault" | "team"`.
A team entry adds `title`, `repo`, `links`, `related`, `errors` and `warnings`. The tool stays
`returns: FOREIGN`, so its description keeps the untrusted-text sentence. `ai-os project list`
prints the same, and `ai-os project check` exits non-zero on any error. Neither command exists in
repo mode with no vault, because the clone lives under the vault.

**Removal is one command.** `ai-os project remove --project <slug>`:

- resolves `projects/<slug>.md` inside the team clone through a new `remove` operation on the
  Vault, which wraps `core/paths.js`. A slug such as `../x` is refused there, not by a string check;
- refuses a file that does not parse as `type: project`, so it cannot be pointed at a note;
- runs `git rm`, commits `project: remove <slug>`, and pushes under the same `outwardSync` rule;
- prints what it left behind: the notes folder `projects/<slug>/` (memory is never deleted), every
  project file whose `related:` still names the slug, and the connector line in the product repo.

The files that still declare a relation are not edited (D13). They validate with a warning, and the
page draws that relation as *declared, to a project not in the workspace*. This answers the parent
spec's open question.

No shell tool is added. If one ever is, it routes its target through `resolve_in_root`
(`tools/_cortex-lib.sh`), and `tools/test/destructive-guard.test.sh` fails it otherwise.

`/team-add` gains a short section naming the removal command and what it leaves behind, and asks
before running it (D12).

## 3. The firewall

**One policy, read in one place.** The refusal is a function in `core/project-file.js` that takes a
validated file and a policy object from `core/profile.js`. It refuses when `policy.refuses` is
`"employer"` and the file has an employer-shaped link. It reads no environment variable and compares
no profile name. Callers pass the policy they already hold: `mcp/` from the record `lib/brain.js`
opens, `index/` from the profile the Overview already resolves. `core/profile.js` does not change.

**What "employer-shaped" means.** A link is employer-shaped when its host is one of two shapes:

| Shape | Recognised by | Example in a fixture |
|---|---|---|
| A private-network host | a single-label host, a private or link-local address, or a host ending in `.internal`, `.corp`, `.lan`, `.intranet`, `.local` or `.home.arpa` | `https://tracker.internal/browse/SHOP-12` |
| A tenant of a hosted work tool | `<tenant>.<suffix>` for a suffix in a short list kept as data in the module, or a first path segment on a host that puts the tenant there | `https://tenant.atlassian.net/browse/SHOP-12` |

The list of suffixes is a table in the module with a test per row. All four link fields are
checked, `repo` included.

**It is a floor.** A repo under an employer's organisation on a public forge has the same shape as a
personal one. So does a self-hosted tool on a company domain. Neither is recognised. Passing the
check clears nothing: the rule in [`templates/vault-AGENTS.md`](../../templates/vault-AGENTS.md)
still binds the person and the agent, and the ritual still says so. The check exists so the
recognisable cases cannot be written by accident. ADR 0015 stands unchanged.

**What each profile does.**

| Profile | Writing | Reading (the listing, the page) |
|---|---|---|
| `home` | A file with an employer-shaped link is refused whole. The message names the field and the shape, and says it belongs in a `work` install. There is no override flag | The entry carries the slug and the reason. Title, links and prose are withheld |
| `work` | Every link is accepted. No shape marks a link as personal, so nothing is refused by code; the prose rule covers personal material | Shown in full |
| `lab` | Every link is accepted and the file is committed locally. Nothing is pushed | Shown in full |

A reader on `home` never deletes or moves the file. It reports it, which is what `/audit` and
`/cortex-audit` already treat as a critical finding.

**Rejected here.** An allow-list of public hosts (D8). A `--force` flag on `home` (the answer to an
employer link on a home machine is a different machine). A profile test of the form
`profile === "home"` at the call site (a fourth profile would then need every call site found).

## 4. The workspace page

**The command.** `node index/cortex-view.mjs <dir> --workspace [--team-brain <path>] [--out FILE]`.
`<dir>` holds the checkouts. The team-brain is `--team-brain`, or else the one directory in `<dir>`
shaped like a team-brain (`team.md` and `projects/`), which `workspaceRepos` already recognises.
Two such directories and no flag is a refusal. `/cortex-view` passes the clone path it reads from
the brain; `index/` reads no `AI_OS_ROOT` (D16). The output is `<dir>/.cortex/view/workspace.html`
unless `--out` says otherwise.

**A workspace of one renders exactly as today.** Two properties, both tested:

- The plain command, with no `--workspace`, is not changed by this part. A repo with a connector and
  a repo without one both render through the same code as before.
- `--workspace` over one repo and no project file writes the same bytes as the plain command for
  that repo, and says so on stderr.

A team-brain holding a single project file is still a workspace with a page of its own: one card and
an empty Relations tab.

**One self-contained file.** Data inlined through `safeJson`, no remote script, no remote
stylesheet, no image, no font, no icon request. The page carries
`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline';
style-src 'unsafe-inline'; img-src data:">`, so a request is refused by the browser and not only by
review (D20). A link is an ordinary `<a href>` with `rel="noopener noreferrer"`: the page asks for
nothing until a person clicks. Only `http:`, `https:` and the SSH form reach an `href`; the SSH form
is shown as text. Paths on the building machine are removed as on the repo page (`scrubPaths`).

**Sections.** The top bar is today's: brand, tabs, a filter box that `/` focuses, the theme button.

| Tab | Holds |
|---|---|
| **Projects** (opens first) | a status line, then one card per project, sorted by slug, in a grid that becomes one column on a phone |
| **Relations** | the diagram when there are 24 projects or fewer, the relations table always, then the projects that stand alone |
| **Problems** | validation errors and warnings by file, relations to a project not in the workspace, files withheld by the profile, checkouts that match no project file, folders with no project file |

The status line says how many projects there are, how many are on this machine, the profile, and
the commit the team-brain was read at. It carries no clock reading, so the same inputs give the
same bytes.

**A project card shows:**

- the title and the slug;
- **on this machine** or **not on this machine**, as words;
- each link as its kind and the whole URL as text, in the order `repo`, `tracker`, `design`, `docs`;
- the first paragraph of the prose;
- its relations in words: `calls billing-api (found, at least 4 calls)`, `auth-service (declared)`;
- for a project on this machine, the route facts the index holds (calls, handlers, gateways, and
  how many URLs were built at runtime and not read) and whether its index was stored or built in
  memory for this page. Nothing is written into a checkout.

**The three relation states, and how each is drawn.**

| State | Diagram | Table and card |
|---|---|---|
| Found by the route map | a solid line with an arrowhead at the project that serves | the word **found**, the direction, `at least N calls`, up to five `repo/file:line` |
| Declared in a project file | a dotted line with an open ring at each end and no arrowhead | the word **declared**, and which file declares it |
| Unlinked | no line; the project sits in a separate group headed **Stands alone** | `no relation found or declared` |

A pair that is both found and declared draws the solid arrow and adds the word `declared` to its
label. Every line has its word beside it at 13px or more, so neither colour nor stroke carries the
state alone. The dotted ringed line is chosen over a dashed one because a dashed box on the
Structure tab already means *missing* (D18).

A project that is not on this machine cannot have found relations computed. Its card and its row
under **Stands alone** say `not on this machine, so found relations were not computed`. Absent and
unknown are different answers and are never drawn the same.

**The diagram** is an inline SVG. Positions come from the slug order and the direction of found
relations, never from a simulation or a random number. It reuses the existing theme tokens. Any new
token is added to both themes and to `CONTRAST`, so the 7:1 test covers it.

**Past twenty projects.** Cards stay compact and the filter narrows them by slug, title or link
text. Past 24 the diagram is not drawn (D19) and the page says the table below is complete.

## 5. Relations

**Found.** The page runs `resolveRoutes` over the reachable checkouts, named by directory exactly as
`cortex-routes.mjs --workspace` names them, so the two commands agree on the same disk. It then maps
each directory to a project (D17):

1. by the `project` in its `.cortex/connector.json`;
2. else by its `origin` URL equal to the file's `repo` after normalising (host in lower case, no
   scheme, no user, no `.git`, no trailing slash, the SSH form read as host and path);
3. else it is listed under Problems as a checkout with no project file.

A found relation A → B exists when at least one call in A reaches a handler in B and A is not B.
Its count is the number of distinct call sites. A call that passes through a gateway in a third
project C is one relation A → B labelled `via C`, and C is not left standing alone. A call whose
target could not be narrowed to one project counts toward each, and the row says how many did.

**Every number is a floor.** The route map is regex over text. A URL built at runtime is counted in
`unread` and never guessed, and the map reads JS and TS callers and Spring handlers only. So the
field is `atLeast`, the page prints "at least", and "no relation found" is never "no relation". The
remedy for a relation the map cannot see is to declare it.

**Declared.** One line in the frontmatter:

```markdown
---
type: project
title: Storefront
repo: https://github.com/example-org/storefront
tracker: https://github.com/example-org/storefront/issues
docs: https://storefront.example.com/docs
related: billing-api, auth-service
created: 2026-10-09
---

The customer-facing shop. Calls billing-api for checkout.
```

`related` has no direction. Declaring it in either file is enough, and declaring it in both draws
one line. A slug with no project file draws a dotted line to a ringed stub labelled `not in the
workspace`.

`resolveRoutes` and `index.routes` do not change shape. What step 3.3 adds to `routes.mjs` is one
pure function that folds `links` into relations between repos.

## 6. Verification

Fixtures use generic names only: `storefront`, `billing-api`, `auth-service`, `docs-site`, a team
called `example-team`, and hosts under `example.com`, `example-org` and `.internal`.

| Step | Plan's "Verified by" | How |
|---|---|---|
| 3.1 | tests with generic fixture projects | `core/test/project-file.test.js`: one failing fixture per rule in the field table, and each rule mutation-checked (removing it breaks a test). `mcp/test/`: `team add` against a bare repo on disk writes, commits and pushes the file; an existing file is left byte for byte; `list_projects` returns the team entries; `project remove` deletes, commits, reports what it left, and refuses `../x` and a file that is not a project file |
| 3.1 | a file with an employer-shaped link is refused under a `home` profile | the same input is refused on `home` with both repos' trees unchanged by fingerprint, written and pushed on `work`, written and not pushed on `lab`; a test per row of the suffix table; a test that the refusal follows `policy.refuses` and not a profile name. `vault-is-the-only-door.test.js` and `architecture.test.js` stay green |
| 3.2 | the page is self-contained | the existing no-remote-script and no-remote-stylesheet assertions run on the workspace page, plus: the policy tag is present, and every `http` in the page is inside an `<a href>` or inside text. No `<img>`, `<link rel=preload>` or `url(` names a host |
| 3.2 | the contrast and 13px tests cover the new surfaces | the 13px test runs on the workspace HTML; the token-parity test runs on it; any new token is in `THEMES` and `CONTRAST`, and the row count of the contrast table does not fall |
| 3.2 | a workspace of one renders as today | `--workspace` over one repo and no project file equals the plain command's bytes; the plain command's bytes do not depend on a team-brain sitting beside the repo |
| 3.2 | (also) | the same inputs give the same bytes; no machine path in the page; on `home` a withheld file's title and links are absent from the page's bytes; the phone-width test runs on the page |
| 3.3 | a fixture workspace with one found, one declared and one unlinked project renders all three states | `storefront` calls a Spring handler in `billing-api` (found), declares `auth-service` (declared), and `docs-site` has neither (unlinked). Asserted in the view data and in the HTML by word and by mark. Removing the call makes the found relation disappear; removing the `related` line makes the declared one disappear |
| 3.3 | (also) | a relation to a missing slug renders as `not in the workspace`; a project not on disk says found relations were not computed; counts print "at least"; `resolveRoutes` over the same directories returns what `cortex-routes.mjs --workspace --json` prints. Run once over the acceptance workspace (`CORTEX_E2E_WORKSPACE`), read-only by fingerprint |

Each step also runs the five suites the plan names.

## 7. Out of scope

- Fetching any link, including an OpenAPI or Swagger document, to learn a relation or a title.
- A hosted page, a server, or a page that updates itself.
- A workspace built from a personal vault's project stubs (D22).
- A direction, a kind or a reason on a declared relation. `related` is a plain list.
- More than one link per kind, and link kinds beyond the four.
- A link from a project card to that repo's own page. The path would be the building machine's.
- Editing a project file from the page, or from any MCP tool. The writer is the CLI.
- Detecting personal material on a `work` profile.
- Relations the route map does not read: back-end to back-end clients, non-Spring handlers, shared
  packages across repos. They are declared until the map learns them.
- A migration for existing team-brains. A team-brain with no project files is valid, and each repo
  gains its file the next time `/team-add` runs there.

## Risks and edges

- **A floor read as a clearance.** Someone on `home` writes an employer's public-forge repo and
  nothing refuses it. The refusal message, the ritual and the ADR all say the check is a floor.
- **The word.** `--workspace` on two commands takes a directory of checkouts while the glossary
  says a workspace is files. The glossary entry names both and says which is which.
- **Two things called a project file.** `skills/scan-projects/SKILL.md` calls a vault stub "a
  project file". Step 3.1 changes that sentence to "project stub".
- **`team.md` lists projects too.** The list `/team-init` writes there is not the registry and goes
  stale. Step 3.1 replaces it in new seeds with a pointer to `projects/`.
- **A page that differs per machine.** Found relations depend on which checkouts a developer has.
  The status line says how many projects they were computed over.
- **Untrusted text.** A project file is written by a teammate. It reaches a model through
  `list_projects`, which is already marked as returning foreign text, and reaches the page only
  escaped.
