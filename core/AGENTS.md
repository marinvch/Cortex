# core/ — the shared kernel

The modules both `index/` and `mcp/` depend on. Everything security-critical in Cortex lives
here, which is why the directory is small and stays small.

## Invariants

- **`core/` imports nothing else in this repo.** Not `index/`, not `mcp/`. Enforced by
  `test/architecture.test.js`; if you need something from a leaf, the dependency is backwards.
- **Every caller-supplied path goes through `resolveInRoot`.** It realpaths the nearest *existing*
  ancestor, so a symlink escape is caught even for a file that does not exist yet. `projects.js`
  once skipped this and `getProjectContext(root, "../../secret")` read any file on disk.
- **`rootFromEnv` in `paths.js` is the one place the root's two names are put in order.**
  `CORTEX_ROOT`, then `AI_OS_ROOT` (the name before #552, still read, never warned about); an empty
  value is unset; neither set is `root: null` and nothing is guessed. It reads the strings it is
  handed and never the disk. No other file in `core/` names either variable, and `profile.js` least
  of all: it reads `CORTEX_PROFILE` only. `test/root-from-env.test.js` holds both. The shell
  counterpart is `cortex_root` in `tools/_cortex-lib.sh`, and `tools/test/cortex-root.test.sh` runs
  the two over every pairing.
- **`scrub.js` refuses; it never sanitises.** `assertWritable` throws `RefusedWriteError` and the
  write does not happen. Silently rewriting a developer's note to remove a secret is a worse
  failure than declining it with a reason.
- **No error message may echo a secret.** `redact()` exists for this; `RefusedWriteError` names
  the *kind* of secret and its line, never the value.
- **Memory is append-only.** `append()` never rewrites an existing entry. Two developers writing
  on the same day append to one file and git merges it as text; there is no lost-update case, and
  introducing one would break the whole shared-memory model.
- **`list()` and `recent()` read two memory layouts, and are the only code that knows either.** A
  day is `memory/<date>.md` (a day file, no author) or a directory `memory/<date>/` holding one
  `<author>.md` per author, where the author is a slug matching `[a-z0-9][a-z0-9-]{0,39}`. One date
  can hold both, and then every file is its own row: nothing merges, replaces or deduplicates rows,
  so one layout cannot hide the other. Rows are `{ day, author, path }`, newest day first; within a
  day the day file, then authors by slug in code-unit order, so the order depends on the names
  alone. `author` comes from the path and is `null` for a day file. Never read it from the
  heading, which is text anyone can edit. `recent({ days })` counts days, not files. Anything else
  in the directory is skipped. Every reader in `index/` and `mcp/` calls these two; a second
  listing of the directory is how a repo that only has day directories gets told it has no
  memory. [The design](../docs/specs/2026-10-09-team-memory-design.md), "Layout" and "Readers".
- **`append()` writes one file per author per day, and finds the author itself.** The path is
  `memory/<day>/<author>.md`, headed `# <day> · <author>`. The author is the `author` option, else
  `CORTEX_AUTHOR`, else git `user.name` read in the repo that holds `.cortex`
  (`resolveAuthor`, `author.js`). Only the slug from `authorSlug` is written: never the raw name,
  and no email is ever read. The rules a change must keep:
  - **No caller passes the author in production.** The writer resolves it, so neither the CLI nor
    `remember` can forget to ([ADR 0016](../docs/adr/0016-a-guarantee-belongs-to-the-act-not-to-the-skill.md)).
    The option, `env` and `git` exist so a test names its author and reads no machine identity.
  - **No usable name is not an error.** The entry goes to the day file `memory/<day>.md`, and the
    result carries `layout: "day"` and a `notice` on every such write. Each caller passes the
    notice on. A day file is the layout that conflicts between branches, so the fallback must
    never be silent.
  - **A name someone set and got wrong is refused**: `invalid_author`, for `CORTEX_AUTHOR` and for
    the option. It is never swapped for git.
  - **The order is: empty, the secret gate, the root check, the author, then the disk.** A refused
    write leaves no file and no day directory, and `append()` never creates `.cortex/`.
    `test/memory.test.js` compares the whole tree after each refusal.
  - **`author.js` is the one module in `core/` that starts a process**: `git config user.name`, as
    an argument array. `test/author.test.js` injects git in every case.
  - `test/memory-fixture.js` builds every reader's fixture with this writer.
  [The design](../docs/specs/2026-10-09-team-memory-design.md), "What names an author".
- **`root` means the `.cortex` directory, and `append()` enforces it.** The contract used to live
  in a doc comment, so passing a repo root — the reading the word invites — wrote a dated file to
  `<repo>/memory/`, returned the path it had written and exited 0. Nothing reads there, and
  `generated.mjs` ignores only `.cortex/index|findings|view`, so it was not even gitignored: a
  confident wrong output rather than a failure. `assertCortexRoot()` refuses and names what it was
  given. Keep the check on the write path — it is the reason `cortex-memory.mjs` can rejoin the
  `rootProblem` check the other eight `index/` CLIs share.

- **`claude-code.js` is data, not policy code.** Anthropic's Claude Code rules, each with the
  sentence on its source page that states it. Checkers read values from it and never hard-code a
  limit. It holds no I/O and must stay that way — the fetching lives in
  `tools/cortex-claude-docs.mjs`, which a maintainer runs. A rule no official sentence states does
  not belong here. [ADR 0017](../docs/adr/0017-anthropic-docs-are-the-authoring-source.md).

- **`project-file.js` owns the project file's format, for both leaves.** A project file is
  `projects/<slug>.md` in a team-brain: flat frontmatter, then prose
  ([ADR 0024](../docs/adr/0024-a-workspace-is-project-files.md)). The rules it keeps:
  - **Text in, a result out.** It reads no file and no environment variable and cannot make a
    request. A link is the characters of a URL. `test/project-file.test.js` scans the source for an
    I/O import.
  - **Validation never throws.** It returns `{ ok, isProject, data, errors, warnings }`. An error
    names its line and its key and never repeats a value, because the value may be the secret.
  - **An unknown key is an error, and so is a repeated one.** Ignoring a misspelt `trakcer:` would
    drop a link without a word. Do not add a key here without the design spec changing first: teams
    have these files committed.
  - **`isProject: false` is not an error to a reader.** A README or a note in `projects/` has no
    `type: project` line; a listing skips and counts it.
  - **The grammar is the flat subset `tools/cortex-frontmatter.mjs` holds skills to**, restated
    here because `core/` may not import `tools/`. No nesting, no list syntax, no block scalar.
  - **`profileRefusal(data, policy)` reads `policy.refuses` and nothing else.** No profile name, no
    environment. A missing policy throws; it is never read as "refuses nothing". `profile.js` does
    not change for this.
  - **The employer check is a floor, and the message says so.** It recognises a private-network
    host and a tenant of a hosted work tool. An employer's repo on a public forge passes. Do not
    word any message as if a passing file were cleared. The host is read without the trailing dot
    of a fully-qualified name, and from a link with no scheme too: that link fails validation, but
    a reader on `home` must still withhold the file that holds it.
  - **`WORK_TOOLS` is data, and short on purpose.** Every row refuses a person who uses that tool
    for a project of their own. A row needs a comment saying why the address names an organisation,
    and an entry in `ROW_EXAMPLES` in the test, which fails without one. A public forge is never a
    row.
  - **Rendering does not validate or repair.** `renderProjectFile` and `setFrontmatter` write what
    they are given; the caller validates the result. `setFrontmatter` returns everything after the
    frontmatter byte for byte.

## Gotchas

- `stamp()` is re-exported from `memory.js` for convenience, but `date.js` **owns** it. There was
  briefly a second copy after the kernel extraction; do not add a third.
- `paths.test.js` skips its symlink case on Windows — creating a symlink there needs admin. The
  skip is expected in local runs and in the Windows CI leg.
- `scrub.test.js` carries a `cortex:allow-secrets` marker. Without it, Cortex reports its own test
  corpus as a critical finding on every run. If you add a new detector, add its fixture *there*,
  assembled at runtime — a realistic literal trips GitHub push protection and blocks the push.

## Tests

```bash
node --test core/test/*.test.js
```

`architecture.test.js` and `plugin.test.js` are drift guards rather than unit tests: they fail when
the layering or the plugin packaging rots, which no application test would notice.
