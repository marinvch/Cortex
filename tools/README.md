# cortex tools (zero deps)

**Nothing to install.** The `.sh` half needs only bash (git-bash, zsh, WSL, Linux, macOS); the
`.mjs` half needs only the Node that already ships with the plugin — no packages either way, per
[ADR 0004](../docs/adr/0004-no-runtime-dependencies.md).

The split is by reader, not by taste. A tool a *user* runs on a machine that may not have Node is
bash (`cortex-init.sh` is curl-pipeable into any repo). A tool that reads structured state the code
already models — the version sites, the capability floors, the profile policy — is `.mjs`, so it
imports that model instead of re-deriving it in shell. `cortex-preflight.mjs` is the clearest case:
re-implementing `core/profile.js` in bash would be a fourth copy of the firewall rule.

`cortex.sh`, `cortex-rm.sh` and `cortex-scan-projects.sh` share `_cortex-lib.sh` (`slugify`,
`note_id`, `knowledge_files`). `cortex-init.sh` deliberately does not — it is a standalone
installer copied into other repos — so it keeps its own copy of the slug rule, pinned against
`mcp/lib/slug.js` by `mcp/test/slug-parity.test.js`.

## `cortex-init.sh` — install a codebase brain into any repo

Run one command inside a target repo and it scaffolds an `AGENTS.md` + agent shims
(Claude/Gemini/Copilot/Cursor) + dev-cycle skills + `docs/decisions.md`.

```bash
# from a clone of Cortex, inside the target repo:
bash /path/to/cortex/tools/cortex-init.sh

# or one-liner, no clone:
curl -fsSL https://raw.githubusercontent.com/marinvch/Cortex/master/tools/cortex-init.sh | bash
```

### Non-interactive (CI, scripts, no TTY)
With no TTY it reads answers from stdin (name, what-it-does, key rule, agents) — blanks fall back
to detected defaults. Or `--yes` to take every default:
```bash
printf 'MyApp\nWhat it does\nKey rule\nall\n' | bash tools/cortex-init.sh
bash tools/cortex-init.sh --yes
```

### Flags
```
--name <s>               Project name (default: package.json name / folder)
--purpose <s>            One line: what the project does
--rule <s>               A key rule the AI must always follow
--agents <list>          claude,gemini,copilot,cursor  or  all   (default: all)
--yes, -y                Accept all detected defaults; no prompts, no stdin
--additive               Refresh skills only; never touch AGENTS.md / shims
--register-to-vault <p>  Append a metadata-only project stub to <vault>/projects/
--help, -h               Show help
```

### What it does
1. **Detects** (does not read your source): `package.json` deps + scripts, lockfile → package
   manager, `tsconfig` (strict + `@/*` alias), eslint/prettier/CI presence, README first line,
   source dirs. Maps deps → framework (Next.js, Nuxt, Remix, Vue, Svelte, React, Express).
2. **Detects an old engine** (`.ai-os/`, `.github/ai-os/`, an MCP entry whose command points into
   `.ai-os/`) and tells you to run `/migrate-engine` first so its memory isn't lost. An entry named
   `ai-os` that runs Cortex's own `mcp/server.js` is a current registration, not the engine.
3. **Suggests skills** for the stack (e.g. React → `vercel-react-best-practices`).
4. **Scaffolds** into the current repo only (existing files → `*.bak`): `AGENTS.md` (source of
   truth), shims, `.claude/skills/plan-feature` + `investigate-bug`, `docs/decisions.md`.

### Safety on re-run / brownfield
- Never clobbers a curated `AGENTS.md` (writes `AGENTS.generated.md` to diff); curated shims kept.
- Non-clobbering backups: `file.bak`, then `file.bak.<timestamp>`.
- Gitignore-aware: warns if a generated file is ignored.

### Register with your personal vault (opt-in)
`--register-to-vault <path>` writes a **metadata-only** stub to `<vault>/projects/<repo>.md` (name,
path, stack, date). No code or secrets — the privacy firewall holds. Vault companion: `/scan-projects`.

## `cortex.sh` — the one viewer app (graph · notes · repos · gaps)

Run in the **vault root** to (re)generate `cortex.html` and open it: a single self-contained app
with four tabs — **Map** (Obsidian-style force graph), **Notes** (read rendered markdown, click
`[[wikilinks]]` to navigate), **Repos** (registered codebase brains), and **Gaps** (orphan notes +
dead links to fix). No server, no runtime — everything is embedded; just open the file.

```bash
bash tools/cortex.sh               # writes ./cortex.html and opens it
```

It reads **`.cortexignore`** to decide what counts as knowledge, so scaffolding, backups, generated
views and skills never show up as noise. That one file is the single source of truth — read through
`knowledge_files()` in `tools/_cortex-lib.sh`, and ported to JS in `mcp/lib/cortexignore.js` so the
live brain agrees with the generators.

## `cortex-sync-skills.sh` — refresh the local `/slash` command mirror

`skills/` is canonical and is what an installed plugin loads. `.claude/skills/` is a **gitignored,
machine-local mirror** that exposes the rituals as `/slash` commands in this checkout — and because
it is gitignored, nothing keeps it current. The old advice (`cp -r skills/* .claude/skills/`) is run
once, never re-run, never refreshes a changed skill and never removes a deleted one. In practice it
had drifted to 22 of 30 skills with 9 stale local copies, so five v2.0 rituals were unavailable.

```bash
bash tools/cortex-sync-skills.sh                  # sync, then report
bash tools/cortex-sync-skills.sh --check          # report only; exit 1 if out of sync
bash tools/cortex-sync-skills.sh --prune-mirrored # also remove directories THIS tool wrote that
                                                  # canonical has since deleted, and only those
```

Each skill is replaced wholesale so a file deleted upstream does not linger. **Mirror-only skills
are reported and never removed by default** — a directory that exists only in the mirror may be
machine-local work with no git history to restore from, so deleting it would be unrecoverable.

Two mirror-only directories are not the same thing, though, and until the ledger they were
indistinguishable: one this tool wrote that canonical has since deleted (recoverable — the deletion
is in git) and one a person or a parallel session created here and nowhere else (not recoverable at
all). So a sync records what it mirrored, with a cksum digest, in
`.claude/skills/.cortex-sync-state` — inside the gitignored mirror, so it never enters git. The
report then names three groups, and only the first is ever removable:

| Reported as | Means | `--prune-mirrored` |
|---|---|---|
| `mirrored by this tool; canonical deleted it` | we wrote it and it still matches our digest | removes it |
| `mirrored then edited here` | we wrote it, someone has changed it since | refuses |
| `not mirrored by this tool` | nothing in the ledger claims it | refuses |

No ledger, an unreadable one, or a digest that no longer matches all mean **not mine** — the tool
never widens its claim when it is unsure. That direction is deliberate: the failure worth designing
against is an installer recording ownership of a file it did not write and later deleting the
user's work.

## `cortex-preflight.mjs` — where am I, and what may I write here

The three facts nearly every ritual re-derives before it may touch anything: which root it is standing
in, which world this install serves, and whether the index it is about to read still describes the
code. Each ritual used to restate those in prose, and prose copies drift — AGENTS.md described the
mode/audience seam as two questions long after `profile` made it three.

```bash
node tools/cortex-preflight.mjs                 # root, kind, profile, index freshness
node tools/cortex-preflight.mjs notes/foo.md    # ...and would that path be committed?
node tools/cortex-preflight.mjs --json
```

It writes nothing. The profile half is **not** re-derived here — it comes from `core/profile.js`,
which reads only `CORTEX_PROFILE` and is the one place that rule lives. Exit 1 means a path you named
would be committed, which is the answer `/capture`, `/wizard` and `/cortex-audit` each need before
writing anything sensitive; with no paths it always exits 0.

Staleness is mtime-based, so a fresh clone reads as stale. That error points at re-running a cheap
deterministic index; the opposite error hands someone a confident map of code that has moved.

## `cortex-plugin-check.mjs` — is the Cortex you run the Cortex you edit

A plugin reaches a session through three copies, each able to sit at a different version:

```
repo VERSION  →  marketplace clone  →  installed cache  →  this session
(what you edit)  (what update pulls)   (what actually runs)
```

```bash
node tools/cortex-plugin-check.mjs           # all three stages, and where they diverge
node tools/cortex-plugin-check.mjs --check   # exit 1 if the running copy is behind
node tools/cortex-plugin-check.mjs --remote  # also: is a newer Cortex published?
```

Run from an installed copy, the "repo" is the cache itself, so the three rows always agree and say
nothing about upstream. `--remote` reads `VERSION` from the default branch of the plugin's
repository, through a shallow fetch into a temp directory, and adds it as a fourth row. It is the
only part that uses the network, so it is opt-in. With `--check`, exit 1 means the running copy is
behind what is published and exit 2 means upstream could not be read. Pass a url after the flag to
read another repository.

Nothing announces a mismatch: every command is present, every skill loads, and the model follows last
week's instructions against this week's code — so a fix that was correct looks broken. Updating the
marketplace alone does **not** move the installed cache, which is why each stage is reported
separately instead of as one version number. Read-only. `/plugin-sync` is the ritual around it.

## `cortex-claude-docs.mjs` — are the Claude Code rules still what the docs say

`core/claude-code.js` vendors each official Claude Code rule with the sentence on its source page
that states it. This re-reads those pages and confirms every sentence is still there.

```bash
node tools/cortex-claude-docs.mjs --check          # exit 1 if a rule went stale, 2 if a page could not be read,
                                                   #      3 if an index lists a page not seen before
node tools/cortex-claude-docs.mjs --json
node tools/cortex-claude-docs.mjs --accept         # record every page now published as seen
node tools/cortex-claude-docs.mjs --pages <dir>    # read <dir>/<page>.md, llms.txt, platform-llms.txt and blog.html
                                                   #      instead of the network
node tools/cortex-claude-docs.mjs --seen <file>    # the seen-list to read and write
```

A page it could not fetch is reported as unchecked, never as ok — an offline run that printed green
would be the silent pass this exists to prevent. For the frontmatter key lists it also reports keys
the docs list that Cortex does not know, which is informational.

It also reads the docs index (`llms.txt`) and the blog's front page (`claude.com/resources/articles`, which
`claude.com/blog` redirects to since 2026-10), and reports each
page missing from `tools/claude-docs-seen.json`. The rule check cannot see a page no rule cites,
which is how Claude Code mods shipped with ten pages of docs and nothing here noticed. The blog's
front page lists customer stories beside product posts and the tool does not tell them apart; read
the titles and `--accept`.

A third index is the platform docs' `llms.txt`. It lists about 800 pages, most of them API
reference, so three sections are watched and the rest ignored: `agents-and-tools/agent-skills/`,
`build-with-claude/prompt-engineering/` and `test-and-evaluate/`. Those are the pages Cortex's
skills and authoring rules rest on. If the index reads but holds no page in any of the three, the
sections were renamed, and that is reported as unread instead of as nothing new.

Maintainer-only: the daily
`claude-docs.yml` workflow runs it and opens a `docs-drift` issue. [ADR
0017](../docs/adr/0017-anthropic-docs-are-the-authoring-source.md).

## `cortex-release-notes.mjs` — one version's section of the changelog

A release's notes are that version's section of `CHANGELOG.md`. This prints the section's body and
nothing else, so it can be piped into whatever cuts the release.

```bash
node tools/cortex-release-notes.mjs 2.41.36                 # the body, on stdout
node tools/cortex-release-notes.mjs v2.41.36                # a tag name works too
node tools/cortex-release-notes.mjs 2.41.36 --changelog <file>
```

It exits 1 and prints nothing on stdout when the section cannot be bounded exactly: the version has
no section or two, the section is empty, it ends at a `## ` heading that is not
`## [x.y.z] — YYYY-MM-DD` or at a version that is not lower, or a line inside it looks like a
version heading at the wrong level. Each of those is a heading that is nearly right, which is how a
hand-copied section runs on into the version below it. Exit 2 is a usage error.

Code fences are not tracked. The changelog has a prose line that begins with four backticks, and a
fence tracker reads it as an opening fence and hides eleven version headings after it.

For 2.41.8 to 2.41.18 its output equals the body of the release already published. One old
section is refused: 2.0.0 ends at a second `## [Unreleased]` heading further down the file.

## `cortex-release-plan.mjs` — what one push to master releases

`.github/workflows/release.yml` cuts a release when a merge raises `VERSION`
([ADR 0022](../docs/adr/0022-stamping-a-version-on-master-releases-it.md)). A workflow cannot be
run before it is pushed, so what it decides is here, where a test runs it on scratch repos.

```bash
node tools/cortex-release-plan.mjs --before <sha>                # the plan, as key=value lines
node tools/cortex-release-plan.mjs --before <sha> --sha <sha>    # refuse unless <sha> is checked out
node tools/cortex-release-plan.mjs --before <sha> --notes-out <file> --repo <dir> --remote <name>
node tools/cortex-release-plan.mjs --highest < tag-names         # the highest v<x.y.z> on stdin
```

`--before` is the commit the branch was on before the push. The plan is one of three:

| `action=` | Means | Also printed |
|---|---|---|
| `none` | `VERSION` is the same before and after the push. Nothing else is checked | `reason` |
| `exists` | the tag `v<version>` is already on the remote | `tag`, `points`, `untagged` |
| `release` | create `v<version>` on the checked-out commit | `tag`, `target`, `previous`, `latest`, `untagged` |

It exits 1 and prints nothing on stdout when the push must not be released: there is no commit
before it or that commit is not an ancestor, `VERSION` was lowered or is not `x.y.z`, a version
site disagrees (`cortex-version.mjs`), the notes do not extract (`cortex-release-notes.mjs`), or
the remote's tags cannot be listed. The tree is judged before the remote is asked for the tag.
Exit 2 is a usage error.

The workflow appends stdout to `$GITHUB_OUTPUT` whole, so every value printed has been matched
first: a version is `x.y.z`, a commit is hex. Keep it that way when adding a key.

`latest` is `true` when the version is above every `v<x.y.z>` tag on the remote. `untagged` lists
every other version with a changelog section and no tag. The notes file is written only for
`release`. It creates no tag and no release, and reads tags with `git ls-remote`, so a tag that
exists only in the checkout decides nothing.

## `cortex-site-facts.mjs` — the facts a public page states, read from source

The public site restated Cortex's facts by hand and drifted from v0.15 to v2.38 unnoticed (#415).
This extracts them instead — version, Node floor, install commands, every ritual, every MCP tool —
as `site-facts.json`, so a page can render them and `--check` can name what moved since it synced.

```bash
node tools/cortex-site-facts.mjs                    # print the facts
node tools/cortex-site-facts.mjs --out <file>       # write them
node tools/cortex-site-facts.mjs --check <file>     # exit 1, one line per changed fact ("ritual /resume added")
node tools/cortex-site-facts.mjs --check <file> --json
```

Byte-identical across runs (sorted keys, no timestamps) and no network. Rituals are the `AGENTS.md`
table joined with the skill folders, and a row or folder the other lacks **fails** the run (exit 2)
rather than being skipped. MCP tools come from the checkout's own `mcp/server.js`, spawned in repo
mode and vault mode and asked for `tools/list` — what users get, not a reading of `mcp/lib/`.

## `cortex-site-demo.mjs` — a `/cortex` run on three small repos, captured for the site

The site's home page plays a `/cortex` run step by step. This records the output it plays, so the
walkthrough is what Cortex prints and not a copy somebody typed. It builds three repos in the OS
temp dir, runs the indexer, the findings and the loop on each, and removes them:

- `new`: an empty git repo.
- `legacy`: a small Express service with tests and CI, and no agent files.
- `team`: the same service with a team-brain connector, so the shared-plugin row is offered.

```bash
node tools/cortex-site-demo.mjs                  # print site-demo.json
node tools/cortex-site-demo.mjs --out <file>     # write it
node tools/cortex-site-demo.mjs --check <file>   # exit 1 when <file> is not what a run gives now
```

Byte-identical across runs: no timings, no absolute paths, no commit ids. The apply step is not
run, because a model does that; each loop row names the paths it would write and the site shows
those. It needs `git` on the path, calls no network, and exits 2 when a CLI fails. `/site-sync`
refreshes the file together with `site-facts.json`; nothing checks it on every push, since a
reworded loop row is not drift until a release ships it.

## `cortex-skill-usage.mjs` — which skills anyone actually reached

Every other audit reads the skills. This reads the **session record**, because a skill's real defect
is usually invisible in its own file: well written, correct, wired in, and never reached. The first
run here found 28 of 42 skills untouched across 51 sessions.

```bash
node tools/cortex-skill-usage.mjs             # typed vs auto, per skill
node tools/cortex-skill-usage.mjs --unused    # the never-reached list
node tools/cortex-skill-usage.mjs --days 60   # a window instead of all history
```

Two counts, kept separate on purpose — the gap is the diagnosis. `typed > 0, auto = 0` means the
description does not match how the work arrives; `typed = 0, auto > 0` means the slash command is
decoration; both zero sends you to `cortex-skill-graph.mjs` to find out whether it is a wiring
problem or a missing front door.

**It reads a directory holding everything the user has ever typed, and extracts skill names and
timestamps only** — no prompt text, in any output mode. `tools/test/skill-usage.test.sh` asserts that
first, before it asserts any counting, and points every case at `CORTEX_SESSIONS_DIR` so no test ever
reads real transcripts. `/skill-audit` is the ritual around it.

## `cortex-skill-graph.mjs` — which rituals reach which

The rituals are meant to compose: define a thing once, point at it from everywhere else. This
measures whether that held, by reading the skill bodies rather than a maintained list of edges — a
maintained list would be a second copy, which is the failure it exists to catch.

```bash
node tools/cortex-skill-graph.mjs               # in/out counts, plus anything stranded
node tools/cortex-skill-graph.mjs --check       # exit 1 if a ritual is isolated both ways
node tools/cortex-skill-graph.mjs cortex-brief  # one ritual's neighbourhood
```

Isolated in one direction is normal — a router is nearly all outbound, a shared discipline nearly
all inbound. Isolated in **both** is the defect, and it has no error state: the ritual still works
when you type its name, it is just never reached. `/wizard` and `/team-add` each sat that way, so
every ritual that scaffolded a repo needing manual credential setup re-explained the steps instead of
handing off to the skill that writes the script.

A ritual genuinely triggered from outside declares `reached-by: <what triggers it>` under its
frontmatter's `metadata:` map and is reported rather than failed. `tools/test/skill-graph.test.sh` pins all of it,
including that the hatch cannot be a bare `true`.

## `cortex-rm.sh` — remove a note the safe way

Used by the **🗑 Remove** button in the viewer (which copies this command for the exact note — no
file hunting). It archives the note to `archives/removed/` (move, don't delete), strips inbound
`[[wikilinks]]` so no dead links remain, and regenerates `cortex.html`.

```bash
bash tools/cortex-rm.sh areas/some-note.md
```

> Self-contained: copy `cortex.sh` + `_cortex-lib.sh` to any machine and it runs with just bash — no
> install, no internet, no engine.

## Trying Cortex on your own repo, without letting it write anything

If you want to see what Cortex makes of a codebase before you let it touch one, point the test at
it. This is the same pass CI runs, aimed at a repo you choose:

```bash
CORTEX_E2E_REPO=/path/to/your/repo bash tools/test/run.sh install-on-a-project
```

It indexes your repo, produces the findings report and the `--offers` worklist the install wizard
walks — and asserts that **your repo is left without a `.cortex/` directory**. Everything is written
through `--out` into a temp dir, so nothing lands in your project and nothing about your project
lands in Cortex. That last part is checked, not promised: the assertion fails the run if a
`.cortex/` appears.

Without the variable the same file runs against a Next.js-shaped repo it builds in a temp directory,
which is what keeps it working on every machine — a test that names a path on somebody's disk runs
on exactly one.

When you do want the real thing, `/cortex-install` is the ritual, and it asks before the first
write.
