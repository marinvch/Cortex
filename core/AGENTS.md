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
- **`gate.js` is the publish gate, and both callers go through it** — `append()` here and
  `assertPublishable` in `mcp/lib/tools.js`. Three checks, in order: a credential (`scrub.js`), the
  employer denylist (`denylist.js`, only where `policy.refuses === "employer"`), personal data
  (`scanPersonal`, by `CORTEX_PII`, else `policy.pii`). Add a fourth check here, never at one caller. Every refusal is a
  `RefusedWriteError` subclass with its own `code` (`employer_denylist`, `personal_data`), so a
  handler written for credentials still stops the write. [ADR 0026](../docs/adr/0026-the-employer-firewall-checks-the-names-you-give-it.md),
  [ADR 0027](../docs/adr/0027-personal-data-in-committed-memory-is-warned-about-and-erasable.md).
- **`denylist.js` matches names the person gave it; it detects nothing.** The file lives outside any
  repo (`CORTEX_DENYLIST`, else `~/.cortex/employer-denylist`) and never ships in a fixture with a
  real name. No file at the default path is no check, and preflight says so; a `CORTEX_DENYLIST` set
  to no readable file refuses every published write on `home`, because a typo must not switch the
  check off. A bad line is a `problem` with its line number and the rest still apply. A refusal names
  the entry's kind and line in the denylist — never the matched text, never the entry. It reads
  `policy.refuses` and no profile name; tests hand it a HOME of their own.
- **`destinations.js` decides where an outward call may go, from `policy.destinations`** — `any`
  (home), `approved` (work), `none` (lab, which still allows a pull or a clone). The list is
  `CORTEX_DESTINATIONS`, else `~/.cortex/allowed-destinations`, outside any repo. On `approved` no
  list refuses everything (`absent` and `missing` both): a list of what to allow fails closed, the
  opposite of the denylist. The host matches exactly and case-insensitively, never by suffix; a
  path prefix matches whole segments; a `.` or `..` segment and an address that cannot be parsed
  never match. Local paths, `file://` and loopback http(s) are always allowed; a UNC path is a
  remote host. A refusal is `DestinationRefusedError` (`unapproved_destination`) built from the
  normalised host and path, so no userinfo can reach the message. A missing policy, or one without
  `destinations`, throws a TypeError. [ADR 0030](../docs/adr/0030-on-a-work-profile-nothing-leaves-except-to-an-approved-destination.md).
- **`policy.pii` is the personal-data mode when `CORTEX_PII` is unset** (`refuse` on work, `warn`
  elsewhere), and `gate.js` passes the policy to `gatePersonal` for it. `CORTEX_PII` still wins.
- **The personal-data scan reports kind and line only** — not even a redacted value, since a
  half-starred email address is most of one. It is conservative on purpose: a phone detector that
  fires on dates and versions is a gate people learn to skip, so add a false-positive case to
  `test/personal-data.test.js` with every new shape. An unknown `CORTEX_PII` throws, like an unknown
  profile.
- **Memory is append-only.** `append()` writes with `appendFileSync` and nothing else: no entry is
  rewritten and no file is moved, renamed or split, a day file included. A feature that mutates an
  existing entry brings back the lost update
  ([ADR 0002](../docs/adr/0002-committed-repo-memory.md)). Append-only does not make two writers
  merge: two branches that append to one file on one day conflict. The layout in the writer bullet
  below is what prevents that, by giving each author a path of their own.
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
  - **The order is: empty, the publish gate (`gate.js`), the root check, the author, then the disk.** A refused
    write leaves no file and no day directory, and `append()` never creates `.cortex/`.
    `test/memory.test.js` compares the whole tree after each refusal.
  - **`author.js` and `index-file.js` are the two modules in `core/` that start a process**, each
    one git command as an argument array: `git config user.name`, and `git ls-files` for
    freshness. `test/author.test.js` injects git in every case; `indexFreshness` takes `tracked`.
  - `test/memory-fixture.js` builds every reader's fixture with this writer.
  [The design](../docs/specs/2026-10-09-team-memory-design.md), "What names an author".
- **`root` means the `.cortex` directory, and `append()` enforces it.** The contract used to live
  in a doc comment, so passing a repo root — the reading the word invites — wrote a dated file to
  `<repo>/memory/`, returned the path it had written and exited 0. Nothing reads there, and
  `generated.mjs` ignores only `.cortex/index|findings|view`, so it was not even gitignored: a
  confident wrong output rather than a failure. `assertCortexRoot()` refuses and names what it was
  given. Keep the check on the write path — it is the reason `cortex-memory.mjs` can rejoin the
  `rootProblem` check the other eight `index/` CLIs share.

- **`source.js` is the one place that says where Cortex comes from** (#622). An organisation's fork
  names itself in the marketplace entry `index/lib/shared-plugin.mjs` writes and in the clone URL
  of `cortex-review.yml`, and both ask here. The order is `--source`, `CORTEX_SOURCE`, the
  connector's `source`, then `marinvch/Cortex`, and an empty value is unset. A value that is set and
  wrong is refused, never skipped for the next one down: a fork that misspelt its source must not
  quietly get upstream. A URL carrying a credential is refused through `carriesCredential`, and the
  message never repeats it. The default's entry stays byte-for-byte what Cortex wrote before.

- **`job.js` holds the five jobs and what each is offered first** (R1 of
  [the role-packs design](../docs/specs/2026-10-25-role-packs-design.md)). `mcp/lib/roster.js`
  validates `members[].job` with it, and `JOB_SKILLS` is the design's table of what each job gets,
  checked against `skills/` by `test/job.test.js`. A job decides what is offered,
  never what is allowed: nothing may refuse an action because of it. No job is `developer`. Pure.
- **`gitignore.js` is the `.gitignore` writer both leaves share** (#620). It appends missing
  entries under a marker line, never rewrites one, and honours a bare `.cortex/` the user wrote.
  Which entries is the caller's: `index/lib/generated.mjs` passes the generated directories, and
  `mcp/lib/team.js` passes `.cortex/team/` before it clones a team-brain into a product repo.
- **`json-text.js` inserts one entry into a JSON file's text** (#623), for
  `index/lib/shared-plugin.mjs` and `tools/cortex-setup.mjs`. It only finds and inserts, in the
  file's own indent and line endings. Parsing first, refusing, keeping an existing entry and
  re-parsing to compare are each caller's job, and both do all four. Pure.
- **`route-path.js` is the one normal form for an HTTP path** (#621): `/items/{}`, every variable
  spelling folded to `{}`. `index/lib/routes.mjs` writes the route map and the contract in it, and
  `mcp/lib/contract.js` normalises a "who calls" question with it. `callReaches` is the route
  map's rule — a call's `{}` meets only an endpoint's `{}` — so both leaves match the same way.
  Pure; it reads nothing.

- **`graph.js`, `path-kinds.js` and `index-file.js` are the import graph's shared half** (G3 of
  [the code-graph design](../docs/specs/2026-10-25-code-graph-design.md)). `index/cortex-graph.mjs`
  prints the graph report and the `graph` MCP tool returns it, and the two must agree exactly, so
  the computation lives here rather than in either leaf. The rules a change must keep:
  - **`graph.js` is pure**: an index in, plain data out. Hubs, bridges, cycles, the bridge score,
    `edgeWeight` and Tarjan's `components`. Its header holds the scoring rules and why each was
    measured.
  - **`path-kinds.js` is what a path says alone**: the area (`layerKeyFor`), a fixture
    (`isTestData`), code that serves tests (`inTestSupportDir`). `index/lib/langs.mjs` builds its
    wider test-like rule from `TEST_DATA_DIRS` here, so a fixture directory is added once.
  - **`index-file.js` reads `index.json` and `enriched.json` and decides staleness.** One
    definition of stale, one reader of each file; `index/lib/open.mjs`, `format.mjs` and
    `enrich.mjs` re-export them. A refusal names the kind (`absent`, `unreadable`, `version`) and
    the command that rebuilds.
  - Everything here is re-exported by the `index/` module that used to hold it, so `index/` still
    asks its own modules. Do not import these from `index/` callers directly.

- **`parser-lock.js` is what the parser add-on is, for its installer and its loader** (G4,
  [ADR 0029](../docs/adr/0029-code-parsers-are-an-add-on-the-user-installs.md)).
  `tools/cortex-parsers.mjs` installs and `index/lib/parsers.mjs` loads, and neither may import the
  other. The rules it keeps:
  - **The digest is of the lock's meaning**: sha256 of the parsed lock with sorted keys, so a CRLF
    checkout names the same `~/.cortex/parsers/<digest>/`. Any edit to the lock moves the directory,
    so an install from another lock is never loaded.
  - **`lockProblems` is checked before anything trusts the lock**: exact versions, an https
    registry origin, a tarball URL that names that package and version on it, sha512 integrity,
    and file paths with no dot segments, each with a sha256.
  - **`verifyInstall` hashes every file the lock names** and answers `absent`, `partial`,
    `mismatch` or `ok`. Only `ok` may be loaded. It checks against the lock, never against a
    manifest the installer wrote.
  - It never reads the lock's path itself: the caller passes it, because the lock lives in
    `index/` and `core/` names no leaf.

- **`claude-code.js` is data, not policy code.** Anthropic's Claude Code rules, each with the
  sentence on its source page that states it. Checkers read values from it and never hard-code a
  limit. It holds no I/O and must stay that way — the fetching lives in
  `tools/cortex-claude-docs.mjs`, which a maintainer runs. A rule no official sentence states does
  not belong here. [ADR 0017](../docs/adr/0017-anthropic-docs-are-the-authoring-source.md).

- **`plugin-registry.js` is the one reader of Claude Code's plugin registry**
  (`<home>/.claude/plugins/installed_plugins.json`). `tools/cortex-plugin-check.mjs` and
  `mcp/lib/setup-plugins.js` both need it and may not import each other. It only reads.
  `readRegistry` returns a `state`, and only `read` says what is installed: `absent` and
  `unreadable` mean unknown, never "nothing installed". The directory is a parameter, so a test
  hands in its own and never reads the machine's. `installedHere` counts a `user` or `managed`
  entry everywhere and a `project` or `local` one in its `projectPath` and below.

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
