# 0024. A workspace is project files

**Date:** 2026-10-09
**Status:** accepted, under the maintainer's delegated approval of 2026-10-09 · design:
[the workspace spec](../specs/2026-10-09-workspace-and-project-files-design.md)

## Context

A team works on several repositories, and Cortex had no one place that says which they are. A
team-brain holds a notes folder per project and a list of slugs in `team.md`. A product repo holds a
connector that names its team and its project. Neither says where a project's repo is, what tracker
or design file belongs to it, or which other projects it depends on.

The route map (roadmap step 8.3) needed several repos at once and took the shortest definition
available: a workspace is "every immediate child directory with a `.git`, minus team-brains". That
answers one question, who serves this call, on one machine. It cannot carry a link, it differs for
every developer, and it disappears when a directory is tidied.

The next-level roadmap asks for more: projects listed with their links, added and removed over
time, shown together on one page, by a team of up to fifty. Three constraints were already fixed
before this record:

- Cortex ships no runtime dependency ([ADR 0004](0004-no-runtime-dependencies.md)), so there is no
  YAML parser and no database driver.
- Shared knowledge is synced by git and nothing else ([ADR 0002](0002-committed-repo-memory.md)).
- Employer material never enters a `home` install or this repository
  ([ADR 0015](0015-a-profile-is-the-world-an-install-serves.md)).

## Decision

**A workspace is the set of project files in one team-brain. It is not a store of its own.**

- A **project file** is `projects/<slug>.md` at the top of a team-brain: flat frontmatter (`type`,
  `title`, `repo`, and optionally `tracker`, `design`, `docs`, `related`, `created`) followed by
  free prose. `core/project-file.js` parses and validates it for both leaves.
- **Adding a project is adding a file. Removing one is deleting a file.** `/team-add` writes it,
  `ai-os project remove` deletes it with `git rm`, and both go through the Vault and the root guard.
- **Links are shown and never fetched.** Cortex reads the characters of a URL and nothing behind
  it, in the validator, the listing and the page.
- **A relation is found or declared.** The route map finds one where a call in one project reaches a
  handler in another. A project file declares one in `related:`. The page draws the two differently
  and labels both in words. A project with neither stands alone.
- **The directory of checkouts is how a machine reaches projects, not what the workspace is.** The
  route map keeps reading it, and its `--workspace` flag keeps its name.
- **On `home`, a project file with an employer-shaped link is refused**, by one function that reads
  `policy.refuses` from `core/profile.js`. The shape is a private-network host or a tenant of a
  hosted work tool. It is a floor: a file that passes is not cleared, and the firewall's prose rule
  still binds. ADR 0015's statement that employer content cannot be detected stands.

## Alternatives rejected

| Option | Why not |
|---|---|
| One manifest for the workspace (`workspace.json`, or the list in `team.md`) | Every add and every removal edits the same file, so two developers registering repos on the same day conflict. That is the failure part 4 of the roadmap exists to remove from memory. One file per project has no shared line |
| A database or an index under `.cortex/`, or state held by the MCP server | A second store needs its own sync, its own migration and its own backup. A team-brain is already cloned, pulled and pushed by `capture` and `/catch-me-up` |
| The directory of checkouts as the definition (the route map's) | It is local to one machine, holds no link, and gives each developer a different workspace. It stays as the way a machine reaches a project's code |
| The links in each product repo, as more fields on `.cortex/connector.json` | Listing the workspace would mean cloning every repo. Removing a project would mean a commit in a repo the remover may not have. The connector is also promised to stay three generic fields |
| A JSON project file | No room for prose, and a team reviews these in pull requests |
| Full YAML: a `links:` map, lists, nested relations | Cortex has no YAML parser and may not add one. The flat subset is the one the repo's skills are already held to |
| The personal vault's `projects/<slug>.md` stubs as the workspace | A stub carries a path on one person's machine, and a vault is one person's. A shared file must hold neither |
| Fetching a link to learn more: an OpenAPI document for relations, a tracker for titles | It needs the network and often a credential, and it makes the page differ from run to run. The roadmap ruled it out (Q13) |
| Recognising an employer link by an allow-list of public hosts | It refuses a personal project's own documentation site, and the list never stops growing. Neither list can see an employer's organisation on a public forge, so neither is a clearance |
| A `status: retired` field in place of removal | Two ways to say a project is gone, and every reader must handle both |
| A `/team-remove` ritual | Its description is paid for in every session ([ADR 0020](0020-the-vault-rituals-stay-in-the-one-plugin.md)) and it would need trigger prompts, for an act a team performs a few times a year |

## Consequences

- A team gets one page for all its projects from files it can read, diff and review. Nothing new
  has to be installed, hosted or synced.
- Links exist only where there is a team-brain. A solo repo has no workspace page; it renders as it
  did before.
- The flat format allows one link per kind and relations with no direction or reason. More than
  that goes in the prose, where the page shows it as text.
- Found relations cover what the route map reads: JS and TS callers reaching Spring handlers,
  through gateways. Every count is a floor. Everything else has to be declared by a person, and
  goes stale the way any hand-written line does.
- The found half of the page depends on which checkouts a developer has, so two developers can see
  different found relations for the same workspace. The page states how many projects it computed
  them over.
- The employer check can be passed by a link it does not recognise. That cost is accepted and
  stated in the refusal message, because the alternative was either no check or a false claim of
  detection.
- "Workspace" now names the files, while two commands keep a `--workspace` flag that takes a
  directory of checkouts. `CONTEXT.md` says which is which.
- A team-brain's `projects/` holds a file and a folder with the same slug: the project file, and the
  notes captured for that project. Removing the file leaves the folder.
- Revisit if a team needs more than one link per kind, or directed relations. Both are a format
  change to a file that teams will have committed by then, so measure the need first.
