---
name: join-team
description: Join the shared team-brain from a product repo — clone it locally and drop a connector into the repo. Triggers — "connect this repo to the team brain", "join the team brain".
effort: low
metadata:
  capability: mechanical
---

# /join-team — join the team-brain (member), run inside a product repo

The member's half of `/create-team`. The leader created and seeded the shared repo; this wires one
product checkout to it and registers the project there. Run it once per product repo you work in,
not once per machine.

## Before you start

```bash
node "${CLAUDE_PLUGIN_ROOT}/tools/cortex-preflight.mjs" .cortex/connector.json
```

Two answers you need from it. **`root`** must be the product repo, not the vault — this ritual
writes into a checkout and running it one directory off puts a connector somewhere no teammate will
look. **The connector must come back `COMMITTED`**, because that is the whole point: teammates
inherit the wiring by pulling it. If preflight says the path is ignored, the repo's `.gitignore`
covers `.cortex/` wholesale and step 4 will silently do nothing.

Note the inversion — everywhere else in Cortex a `COMMITTED` verdict on a preflight is a stop sign.
Here it is the requirement, and it holds only because the connector carries no local state.

## What to do

1. From the product repo root, with `CORTEX_ROOT` set to your vault, run
   `node "${CLAUDE_PLUGIN_ROOT}/mcp/ai-os.js" team add --name <team> --repo <team-brain-git-url> --project <this-project-slug>`.
   The script ships with the plugin; the vault is only where the clone goes. From a clone of the
   Cortex repo rather than the plugin, use that clone's path. `--name` is the team — the name in
   the team-brain's `team.md`, the same for every repo — and `--project` is this repo.
2. It clones the team-brain under your local vault and writes this repo's **project file** there,
   `projects/<slug>.md`: the project's title, its repo, and optionally a tracker, a design file, a
   docs site and the projects it relates to. The file is committed as `project: add <slug>` and
   pushed. Read the line the command prints about it and pass that on. See *The project file*
   below for the flags and for what it refuses.
3. It then writes a generic `.cortex/connector.json`: `{ team, project, teamBrainRepo }`, plus
   `source` when the brain's `team.json` names the team's Cortex fork, and nothing else. Pass on
   the line naming the source: `/setup-repo` stamps that fork into this repo. A connector already committed in the old `{ slug, teamBrainRepo }` shape still
   works — the startup line says it is the old shape — and running step 1 again rewrites it;
   commit that change. A repo-mode server clones the team-brain into `.cortex/team/` on first use
   and adds that directory to the repo's `.gitignore`.
4. **Ask the member which roles they hold** — `frontend`, `backend`, `architect`, whatever this
   team uses — and which projects they own. Then run
   `node "${CLAUDE_PLUGIN_ROOT}/mcp/ai-os.js" team member --roles <role,role> --projects <slug,slug>`.
   It adds them to the team-brain's `team.json`, commits and pushes. Their handle is their memory
   author name: `CORTEX_AUTHOR`, else their git `user.name` as a slug; pass `--handle` only to
   override it. Running it again replaces their roles and projects. Without this step, asks sent
   to their role never reach them.
5. **Offer to publish this repo's contract**: what it serves, calls and emits, so other repos can
   ask who calls an endpoint without cloning this one. On a yes, run
   `node "${CLAUDE_PLUGIN_ROOT}/index/cortex-contract.mjs" . --out .cortex/index/contract.json`, then
   `node "${CLAUDE_PLUGIN_ROOT}/mcp/ai-os.js" contract publish --file .cortex/index/contract.json`.
   The first writes only under `.cortex/index/`, which it adds to `.gitignore` as indexing does. The
   second commits `contract: update <slug>` to the team-brain and pushes, only when it changed.
   Pass on what it printed, including an empty contract's reason. Run both again after the API
   changes.
6. Offer to commit the connector so teammates inherit the wiring:
   `git add .cortex/connector.json && git commit -m "chore: add cortex team connector"`.
7. Tell the user what joining gave them. `/whats-changed` pulls the team-brain and returns what every
   repo of the team captured, and which contracts changed. The `ask`, `inbox` and `answer` tools
   carry a question to a role in another repo and the answer back; an agent calls `inbox` at the
   start of a task. The `contract` tool answers who serves and who calls an endpoint.

## The project file

A team's workspace is the project files in its team-brain, one per project. Step 1 writes this
repo's. Add any of these flags to the command in step 1:

| Flag | Sets | Rule |
|---|---|---|
| `--title <text>` | `title` | 1 to 80 characters. Without it the title is the slug |
| `--project-repo <url>` | `repo` | `https://`, or the `user@host:path` form. Without it, this checkout's `origin` |
| `--tracker <url>` | `tracker` | `http://` or `https://` |
| `--design <url>` | `design` | as `tracker` |
| `--docs <url>` | `docs` | as `tracker`. An API reference goes here |
| `--related <slug,slug>` | `related` | other projects' slugs, separated by commas |

- **The links are shown and never fetched.** Do not open one to fill in a title or to check it.
- **An existing file is left exactly as it is** unless a flag is passed. Then only those lines
  change; the prose under the frontmatter is a person's and is not touched. To add a sentence
  about the project, the user edits the file in the team-brain.
- **No repo, no file.** A checkout with no `origin` still joins, and the command says its project
  is unregistered. Ask for the repository's address and run step 1 again with `--project-repo`.
- **A credential is refused, not stripped.** If `origin` carries a password or a token, the command
  stops and asks for `--project-repo`. Pass the plain address; never paste the credentialed one.
- **On a `home` profile an employer-shaped link is refused, whole.** A private-network host, or a
  tenant of a hosted work tool, in any of the four links stops the command before anything is
  written, and no flag overrides it. That repo belongs in a `work` install. The check is a floor:
  an employer's repo on a public forge passes it, and the firewall still forbids it. A file that
  was not refused is not cleared, so ask where a link you are unsure of belongs.
- On `lab` the file is committed in the local clone and not pushed.
- **On `work` the team-brain remote must be on the company's approved list**, or the clone is
  refused and nothing is joined: check it with
  `node "${CLAUDE_PLUGIN_ROOT}/tools/cortex-destinations.mjs" check git <team-brain-url>`.

`node "${CLAUDE_PLUGIN_ROOT}/mcp/ai-os.js" project list` prints every project the brain knows, and
`node "${CLAUDE_PLUGIN_ROOT}/mcp/ai-os.js" project check` validates the team's files and exits 1 on
an error.

## Removing a project

A project leaves the workspace when its file is deleted. **Ask before running this**: it commits
and pushes a deletion to a repo the whole team pulls.

`node "${CLAUDE_PLUGIN_ROOT}/mcp/ai-os.js" project remove --project <slug>`

It deletes `projects/<slug>.md` with `git rm`, commits `project: remove <slug>` and pushes. It
refuses anything that is not a project file. Tell the user what it prints as left behind:

- the notes folder `projects/<slug>/`. Memory is never deleted;
- every other project file whose `related:` still names the slug. Those are not edited, and they
  validate with a warning until their owners change them;
- the connector in the product repo, which the user removes there.

## Don't

- NEVER auto-commit to the product repo — always leave that to the user.
- The connector must stay generic (no personal/machine paths). Local state (CORTEX_ROOT, clone path)
  lives in user config only. This is what makes committing it safe, so it is not a style rule.
- Never write a path on this machine into a project file. It is shared, like the connector.
- Never edit another project's file to tidy a `related:` line. Report it and leave it.
