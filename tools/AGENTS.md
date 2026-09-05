# `tools/` — the scripts around the product

Read [`docs/changing-cortex.md`](../docs/changing-cortex.md) first; it holds the invariants that
apply to every package. This file owns what is specific to `tools/`.

These are the scripts a **person** runs, not the ones a ritual imports. `core/`, `index/` and `mcp/`
are the product; this is the maintenance shelf around it — installers, the viewer generator, the
version stamper, the checks that keep the repo honest about itself. Nothing here is imported by the
product, which is why `core/test/architecture.test.js` does not walk this directory. That freedom is
the reason the rules below have to be written down: the layering test will not catch a mistake here.

## `.sh` or `.mjs` — decided by the reader, not by taste

- **`.sh`** when a *user* runs it on a machine that may not have Node. `cortex-init.sh` is
  curl-pipeable into any repo; that is the whole reason it exists in bash.
- **`.mjs`** when the script reads structured state the product already models — the version sites,
  the capability floors, the profile policy. It imports that model instead of re-deriving it.
  `cortex-preflight.mjs` is the clearest case: reimplementing `core/profile.js` in bash would be a
  fourth copy of the firewall rule.

Importing from `core/` is fine and expected. Importing from `index/` or `mcp/` is a smell — it means
a tool is reaching into a leaf, and the shared piece probably belongs in `core/`.

## The copies that are deliberate, and the tests that pin them

Three rules exist in more than one place **on purpose**, because the files needing them cannot share
code — `cortex-init.sh` is a zero-dependency installer copied into other repos, and
`tools/server/cortex-cron.sh` lands on a server beside only `server-setup.sh`.

| Rule | Copies | Pinned by |
|---|---|---|
| the slug | `_cortex-lib.sh`, `mcp/lib/slug.js`, the generated HTML | `mcp/test/slug-parity.test.js` |
| the clock | `_cortex-lib.sh`, `cortex-init.sh`, `cortex-cron.sh` | `tools/test/date-parity.test.sh` |

**Never "improve" one copy alone.** The parity test is what makes the duplication safe; without it
these drift into two behaviours nobody can tell apart. A *new* shared helper goes in
`_cortex-lib.sh` and is sourced — a fourth copy is not a pattern, it is the failure the parity tests
were written about.

## A destructive tool routes its target through `resolve_in_root`

`_cortex-lib.sh` holds it — the shell counterpart of `core/paths.js`. Not a string-prefix check: a
symlink out of the root passes any prefix comparison and is still an escape.
[ADR 0010](../docs/adr/0010-the-shell-half-gets-the-guard-too.md).

## Tests: behaviour, not syntax

`bash tools/test/run.sh` (add `<filter>` for one file). **Add a case when you touch anything here.**
`bash -n` and shellcheck never *run* a script, which is how four real bugs shipped in
`tools/server/`. Tests build real git repos in temp dirs — a bare repo on disk is a complete remote,
so no network.

Four assertions in `_helpers.sh`, deliberately. A test framework that grows features is a dependency
by another name; if a test wants a fifth helper, it is usually the test that wants simplifying.

**Every test touching the home directory must override the variable the platform actually reads.**
`os.homedir()` answers `USERPROFILE` on Windows and `HOME` elsewhere, so a fixture that sets only
`HOME` leaves a Windows run reading the developer's real machine — and passing for the wrong reason.
`plugin-check.test.sh` sets both, through one `as_home()` helper, and hands node a native path
because node resolves a bare `/tmp/...` against the current drive on Windows.

## The self-checks, and why each one exists

Each of these guards a failure with **no error state** — the repo keeps working while quietly lying
about itself, so nothing surfaces until a reader is misled.

| Run | Fails when |
|---|---|
| `cortex-version.mjs --check` | the seven version sites disagree. Never hand-edit one; `--set` writes them all |
| `cortex-capability.mjs` | a ritual declares no capability floor |
| `cortex-skill-graph.mjs --check` | a ritual has no edges at all, in either direction, and declares no `reached-by:` |
| `cortex-skill-usage.mjs --unused` | (reports, does not fail) which skills the session record shows nobody ever reached |
| `cortex-plugin-check.mjs --check` | the running plugin is behind the repo, so a correct fix looks broken |
| `cortex-sync-skills.sh --check` | the gitignored `.claude/skills/` mirror has drifted from `skills/` |

**The graph check cannot see a front door.** It fails only on `out.length === 0 && in.length === 0`
(`cortex-skill-graph.mjs:106`), so a ritual keeps passing however thoroughly its *inbound* edges are
stripped — one outbound edge is enough. Keep that `&&`: a router like `/cortex-next` is nearly all
outbound and a shared discipline like `/writing-for-agents` nearly all inbound, so failing on a low
inbound count would force exactly the decorative "see also" edges that make a graph look healthier
than it is. The consequence is worth stating plainly, because the surrounding prose implies more:
the check proves a ritual is **wired to something**, not that anything leads **to** it. It catches
total disconnection, which is real and worth catching, and nothing short of it.

Inbound edges are also not equal, and counting them hides that. `/connect-brain` and
`/migrate-engine` have one each — from `/setup-plugins` and `/install-project`, both causally
correct, and both from rituals the session record shows at 0/0. A door behind a door nobody opens.
`cortex-skill-usage.mjs` is the instrument for that half; no static graph can answer it.

A tool added here that answers a question about the repo should get a `--check` mode and a test. The
report is the point; the exit code is what lets CI or a ritual act on it.
