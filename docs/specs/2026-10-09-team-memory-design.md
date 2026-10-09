# Design: memory for a large team — one file per author per day

- **Date:** 2026-10-09
- **Status:** Approved under delegation (see "Decisions taken for the maintainer")
- **Decided by:** the maintainer in Q6 and Q16 of the
  [next-level roadmap](2026-10-04-next-level-roadmap-design.md); the details below under the
  approval delegated on 2026-10-09
- **Plan step:** 4.0 of [the roadmap plan](../plans/2026-10-04-next-level-roadmap.md). It gates
  4.1, 4.2 and 4.3.
- **Area:** `core/memory.js` and a new `core/author.js`, `index/cortex-memory.mjs`,
  `index/lib/overview.mjs`, `index/lib/view-html.mjs`, `index/lib/next.mjs`, `index/lib/loop.mjs`,
  `mcp/lib/catchup.js`, `mcp/lib/tools.js`. Scoped briefs: [`core/AGENTS.md`](../../core/AGENTS.md),
  [`index/AGENTS.md`](../../index/AGENTS.md), [`mcp/AGENTS.md`](../../mcp/AGENTS.md).

This step writes no product code. It reproduces the problem, settles the layout, and says how each
of the three build steps is verified.

## Destination

- Two developers who each write memory on the same day, on different branches, merge with no
  conflict in `.cortex/memory/`.
- Every reader shows every entry, whichever layout it was written in, and says who wrote it when
  the layout knows.
- A repo that already has memory needs no migration and keeps its old files unchanged forever.
- The secret gate and the append-only rule hold exactly as they do today.

## Decisions taken for the maintainer

Each line is one decision and the alternative it beat, so it can be reversed alone. The reasons
are in the sections named.

| # | Decision | Alternative | Section |
|---|---|---|---|
| T1 | The part is real and is built as planned. The conflict reproduces in both forms | Re-scope the part | Reproduction |
| T2 | One file per author per day. `merge=union` is not used and not stamped | Keep one file per day and stamp a `.gitattributes` line | `merge=union`, weighed |
| T3 | The path is `.cortex/memory/<date>/<author>.md`, a directory per day | A flat `<date>.<author>.md`; a directory per author | Layout |
| T4 | The file opens with `# <date> · <author>`. Entries keep `## HH:MM · kind` | An author on every entry heading | Layout |
| T5 | An author is named by `CORTEX_AUTHOR` when set, otherwise by a slug of git `user.name` | Email, a hash, a required setting | What names an author |
| T6 | No email address is ever written to a path or a header | The email's local part as a fallback | What names an author |
| T7 | The slug is ASCII: `a-z`, `0-9`, `-`, at most 40 characters | Unicode letters kept in file names | What names an author |
| T8 | With no usable name, the entry goes to the old day file and the writer says so | Refuse the write; a shared `unknown.md` | What names an author |
| T9 | A `CORTEX_AUTHOR` that is set and unusable refuses the write | Fall through to git silently | What names an author |
| T10 | Readers take the author from the path, never from the header | Parse the header | Readers |
| T11 | Within a day: the old day file first, then authors by slug. The timeline sorts entries by time, then slug | Interleave by commit time; group by author | Readers |
| T12 | `recent({ days })` counts days, not files | Keep counting files | Readers |
| T13 | No migration. Old files are never moved, split or rewritten | A one-time split of old files by `git blame` | Existing repos |
| T14 | The writer uses the new layout as soon as 4.2 ships. No setting turns it on | Opt in per repo; opt out per machine | Existing repos |
| T15 | `core/author.js` reads git itself, with an argument array | Each caller passes the author in | Architecture |
| T16 | 4.1 also covers `index/lib/next.mjs` and `index/lib/loop.mjs`, which the plan did not list | Leave them reading the old layout only | Readers |
| T17 | No `author` filter is added to `recall_memory` in this part | Add it now | Risks |

## Context

- Memory is `<repo>/.cortex/memory/<date>.md`, committed, append-only, one file per day
  ([ADR 0002](../adr/0002-committed-repo-memory.md)). `append()` in `core/memory.js` is the one
  writer. It has two callers: `index/cortex-memory.mjs` (the CLI `/dream` uses) and the `remember`
  tool in `mcp/server.js`.
- Entries carry no author. The file has one `# <date>` heading, and each entry is
  `## HH:MM · kind` followed by its text.
- The code and three documents say that two developers appending to the same day's file "merge as
  ordinary text": the header comment of `core/memory.js`, the append-only bullet in
  `core/AGENTS.md`, and `skills/dream/SKILL.md`. The reproduction below shows that this is false.
- The roadmap spec decided the direction (Q16: one file per author per day, both layouts readable)
  and left three questions open: what names an author, how readers present many authors, and
  whether existing repos migrate.
- No ADR and no earlier spec mentions `merge=union` or an author for memory. ADR 0002's rejected
  alternatives are a separate team-brain repo, local-only state and sanitising on write. Nothing
  here proposes any of the three.

## Reproduction

Run on 2026-10-09 with git 2.47.1.windows.1 and Node 24.13.0, in a scratch directory outside the
repository. The writer is the real one. `$C` is a Cortex checkout and `$W` is the scratch repo.

### Case 1 — the day's file is new on both branches

```bash
mkdir -p "$W/.cortex"
git -C "$W" init -q -b main
git -C "$W" config user.name dev-base
git -C "$W" config user.email dev-base@example.invalid
git -C "$W" config core.autocrlf false
echo "# fixture" > "$W/README.md"
git -C "$W" add -A && git -C "$W" commit -q -m base

git -C "$W" checkout -q -b a main && mkdir -p "$W/.cortex"
node "$C/index/cortex-memory.mjs" append "dev-a: chose the queue over the cron job." \
  --kind dream --root "$W/.cortex"
git -C "$W" add -A && git -C "$W" commit -q -m "dev-a dreams"

git -C "$W" checkout -q -b b main && mkdir -p "$W/.cortex"
node "$C/index/cortex-memory.mjs" append "dev-b: the parser drops a trailing comma." \
  --kind dream --root "$W/.cortex"
git -C "$W" add -A && git -C "$W" commit -q -m "dev-b dreams"

git -C "$W" checkout -q main
git -C "$W" merge -q --no-edit a
git -C "$W" merge --no-edit b
git -C "$W" status --short
```

```
Auto-merging .cortex/memory/2026-10-09.md
CONFLICT (add/add): Merge conflict in .cortex/memory/2026-10-09.md
Automatic merge failed; fix conflicts and then commit the result.
AA .cortex/memory/2026-10-09.md
```

The merge exits 1. Both entries were written in the same minute, so the file after the merge is:

```
# 2026-10-09

## 05:54 · dream

<<<<<<< HEAD
dev-a: chose the queue over the cron job.
=======
dev-b: the parser drops a trailing comma.
>>>>>>> b
```

### Case 2 — the day's file already exists on `main`

The same steps, with one entry appended and committed on `main` before the branches are cut.

```
Auto-merging .cortex/memory/2026-10-09.md
CONFLICT (content): Merge conflict in .cortex/memory/2026-10-09.md
Automatic merge failed; fix conflicts and then commit the result.
UU .cortex/memory/2026-10-09.md
```

The CLI takes no time argument, so the case was run again through `append()` in `core/memory.js`
with fixed times (09:00 on `main`, 10:15 for `dev-a`, 16:40 for `dev-b`), to show that the
conflict does not depend on two people writing in the same minute:

```
# 2026-10-09

## 09:00 · dream

base: the day started with one entry.

<<<<<<< HEAD
## 10:15 · dream

dev-a: chose the queue over the cron job.
=======
## 16:40 · dream

dev-b: the parser drops a trailing comma.
>>>>>>> b
```

### Case 5 — the proposed layout

An old day file committed on `main`, then `2026-10-09/dev-a.md` on one branch and
`2026-10-09/dev-b.md` on the other, written by hand in the layout this spec proposes:

```
Merge made by the 'ort' strategy.
 .cortex/memory/2026-10-09/dev-b.md | 6 ++++++
 1 file changed, 6 insertions(+)
 create mode 100644 .cortex/memory/2026-10-09/dev-b.md
```

`git ls-files .cortex` afterwards lists `.cortex/memory/2026-10-09.md`,
`.cortex/memory/2026-10-09/dev-a.md` and `.cortex/memory/2026-10-09/dev-b.md`. A file and a
directory with the same date live side by side, on Windows too.

### Verdict

**The part is real (T1).** Any two branches that each write memory on the same day conflict when
they meet: add/add when the day's file is new on both, a content conflict when it already existed.
A team where every developer runs `/dream` at the end of the day hits this on every merge after
the first one of each day. The sentence "git resolves it as an ordinary text merge" is wrong
wherever it appears, and step 4.3 removes it.

One more thing the reproduction showed: `append()` fails with `ENOENT` when `.cortex/` does not
exist, because `resolveInRoot` resolves the root first. Git does not keep an empty directory, so a
fresh branch of a repo whose `.cortex/` holds nothing committed has no `.cortex/` until something
creates it. That is the consent gate working as designed (the writer never creates `.cortex/`),
and this part does not change it.

## `merge=union`, weighed

Git has a built-in merge driver that is set with one `.gitattributes` line and needs no code:

```
.cortex/memory/*.md merge=union
```

Git's documentation describes it this way
(<https://git-scm.com/docs/gitattributes>, under "Built-in merge drivers", read 2026-10-09):

> Run 3-way file level merge for text files, but take lines from both versions, instead of
> leaving conflict markers. This tends to leave the added lines in the resulting file in random
> order and the user should verify the result. Do not use this if you do not understand the
> implications.

Each case above was run again with that line committed on `main` first.

**What it fixes.** Both conflicts go away, the add/add case included. Every merge below exited 0
with `Merge made by the 'ort' strategy.` The `# <date>` heading appeared once in every result.

**What it breaks.**

1. *Two entries in the same minute become one.* Both sides wrote the identical heading line
   `## 10:15 · dream`, so the result has one heading and both texts under it:

   ```
   ## 10:15 · dream

   dev-a: chose the queue over the cron job.
   dev-b: the parser drops a trailing comma.
   ```

   `memoryEntries()` in `index/lib/overview.mjs` makes one timeline entry per heading and takes
   the first line under it as the title. The second developer's entry is in the file and missing
   from the timeline. Nothing reports it.

2. *The order is the order of the merges, not the order of the day.* With `dev-b`'s 16:40 entry
   merged before `dev-a`'s 10:15 entry:

   ```
   ## 16:40 · dream

   dev-b: the parser drops a trailing comma.
   ## 10:15 · dream

   dev-a: chose the queue over the cron job.
   ```

   Every reader assumes the newest entry is last in the file (`readMemory()` reverses each file to
   put the newest first).

3. *The blank line between the two entries is lost*, as the output above shows. The headings
   still parse.

4. *It never reports a conflict, whatever the edit.* The driver takes lines from both sides for
   any overlapping change, not only for appends. A branch that edited an old entry (which the
   append-only rule forbids, and which a hand edit can still do) would merge silently with both
   versions of the line kept.

5. *It still names no author.* The roadmap asked for attribution as well as clean merges.

6. *It is a write to a file the team owns.* `.gitattributes` belongs to the target repo. Cortex
   would have to stamp a line into it behind the consent gate and track it in the stamp record.

7. *A host may not apply it.* A local `git merge` reads `.gitattributes`. Whether a hosted merge
   button does is the host's choice. For GitHub the only statement found is a third-party report
   from 2016 in <https://github.com/rubocop/rubocop/pull/3594>, which added `merge=union` for a
   changelog and says: "GitHub doesn't support the feature." GitHub's behaviour today is not
   confirmed (see "Not confirmed"). If the button ignores the line, the pull request shows the
   conflict of case 1 or case 2 and has to be resolved by hand, which is the situation this part
   exists to remove.

Two structured entries that share lines (`Decided:`, `Next:`) written at different times were also
tried, to see whether the driver interleaves them. It did not: each entry came out whole.

**Decision (T2).** One file per author per day. Two developers then never write the same path, so
no merge driver is involved, on any host, and the attribution comes with the path. `merge=union`
would be cheaper to build and it removes the conflict locally, but it hides entries from the
timeline in the same-minute case, puts the file out of order, and depends on a host behaviour
that could not be confirmed. Cortex does not stamp the line. A team that keeps writing old day
files for a while (see "Existing repos") may add it by hand, knowing the list above.

## Layout

```
.cortex/memory/
  2026-10-08.md            old layout: one file per day, no author
  2026-10-09.md            old layout, still valid on a day that also has the new one
  2026-10-09/
    dev-a.md               new layout: one file per author per day
    dev-b.md
```

**The path is `.cortex/memory/<date>/<author>.md` (T3).** `<date>` is `YYYY-MM-DD` from
`core/date.js`, as today. `<author>` is the slug defined in the next section.

The two layouts cannot be confused:

| Entry in `.cortex/memory/` | Matches | Meaning |
|---|---|---|
| a file | `^\d{4}-\d{2}-\d{2}\.md$` | an old day file |
| a directory | `^\d{4}-\d{2}-\d{2}$` | a day in the new layout |
| a file inside such a directory | `^[a-z0-9][a-z0-9-]{0,39}\.md$` | one author's file for that day |
| anything else | | ignored, as a stray `README.md` is ignored today |

An old day file ends in `.md` and a day directory does not, so one name is never both. A slug
cannot contain `.`, `/` or `\`, so a file inside a day directory cannot be read as a date or
escape the directory.

**The header is `# <date> · <author>` (T4)**, written once when the file is created, in place of
today's `# <date>`. Entries are unchanged: `## HH:MM · kind`, a blank line, the text, a blank
line. The author is on the file and not on each entry because one file has one author. Putting it
on each entry heading would change the heading format that `memoryEntries()` parses, for no gain.

```
# 2026-10-09 · dev-a

## 10:15 · dream

Chose the queue over the cron job.

```

Rejected:

- *A flat `<date>.<author>.md`.* It needs one directory read and no nesting. But the directory
  grows by authors times days, where a day directory holds at most one file per author. And a
  flat name puts the author inside a file name that an old reader's pattern almost matches, where
  a directory is plainly a different kind of entry.
- *A directory per author, `<author>/<date>.md`.* Every reader asks by day, newest first. This
  layout would make each of them visit every author's directory to answer the one question they
  all ask.

## What names an author

### The candidates

| Candidate | For | Against |
|---|---|---|
| git `user.email` | Unique per person in practice | An email address in a committed path is personal data in a repository strangers may read. Not legal in a file name without rewriting |
| The email's local part | Short | Still personal data. Often not readable (a provider's no-reply address is a number and a login). Two people can share one |
| A hash of the email | Says nothing by itself | Nobody can read who wrote the file, so recall cannot attribute it. Email addresses are guessable, so a short hash of one is weak cover |
| git `user.name` | Already set on any machine that commits. Readable | Two people can share a name. A name with no ASCII letters gives no slug |
| An explicit setting | The person chooses what is published. Covers every edge case | Nothing works until it is set, if it is the only source |

### The choice

**The author is the slug of `CORTEX_AUTHOR` when that is set, and otherwise the slug of
`git config user.name` read in the repository (T5).** No email address is ever read, written or
hashed (T6).

- `user.name` is the default because it needs no setup and gives a name a teammate recognises.
- `CORTEX_AUTHOR` comes first because it is the developer's own choice, and it answers every case
  the default cannot. It is an environment variable, like `CORTEX_PROFILE`, and is set the same
  way.
- Only the slug is written, in the path and in the header. The raw name is not.

### The privacy angle

Memory is committed and the repository may be public. The name in the path is the name git
already records on the commit that adds the file, so for a developer who commits their own memory
the path discloses nothing the log does not. It is still more visible there: a path is in every
checkout and every archive of the tree, and it stays when history is squashed and authorship
collapses to whoever merged. So:

- only a name is used, never an address;
- a developer who does not want their name in a path sets `CORTEX_AUTHOR` to a handle;
- the Cortex repository itself is data-free, so anyone writing memory in it sets `CORTEX_AUTHOR`
  to a generic handle. It has no committed memory today.

### The slug, computed deterministically

In order, on the chosen string:

1. Unicode-normalise to NFKD and remove combining marks (`\p{M}`), so `é` becomes `e`.
2. Lower-case.
3. Replace every run of characters outside `a-z0-9` with one `-`.
4. Remove leading and trailing `-`.
5. Cut to 40 characters, then remove a trailing `-` again.
6. The result is unusable if it is empty, or is one of the Windows device names `con`, `prn`,
   `aux`, `nul`, `com0`–`com9`, `lpt0`–`lpt9`.

The rule was run on 2026-10-09:

| Input | Slug |
|---|---|
| `Dev A` | `dev-a` |
| `  Dev   A. ` | `dev-a` |
| `Zoë Müller-Ångström` | `zoe-muller-angstrom` |
| `a/b\c:d*e?f"g<h>i\|j` | `a-b-c-d-e-f-g-h-i-j` |
| a name written only in Cyrillic or in Chinese characters | unusable |
| `..` | unusable |
| `CON` | unusable |
| sixty `x` and then ` y` | forty `x` |

The slug is ASCII (T7) because a file name is shared by every operating system on the team. Every
character Windows forbids in a file name (`< > : " / \ | ? *`) falls outside `a-z0-9` and becomes
`-`, as the fourth row shows. Lower-casing removes names that differ only by case, which a
case-insensitive file system would fold into one file. Keeping non-ASCII letters would give more
people a slug from their git name, at the price of file names whose bytes can differ between
systems; that risk was not measured and is listed under "Not confirmed".

### The edge cases

| Case | What happens |
|---|---|
| No git identity, no git, or not a repository | No usable name. The entry is appended to the old day file `<date>.md`, exactly as today, and the writer reports it (T8) |
| A git name with no ASCII letters or digits | The same. The message names `CORTEX_AUTHOR` as the fix |
| `CORTEX_AUTHOR` set to something unusable | The write is refused with a named error, `invalid_author`, and nothing is written (T9). A setting someone made and got wrong must not be ignored silently; `CORTEX_PROFILE` is treated the same way |
| One person, two machines, the same name | The same slug, so the same file. Entries from both machines append to it. If both machines write on the same day on branches that later merge, that one file conflicts as in case 1 or 2. Accepted: it is one person, it is rare, and they resolve their own two entries |
| Two people with the same name | The same slug, so they share a file and can conflict with each other, as everyone does today. Nothing is lost. Either one sets `CORTEX_AUTHOR` and it ends |
| A person changes their git name | Later entries go to a new slug. The old files stay as they are |

T8 falls back and does not refuse because the old layout is a correct place for an entry, read by
every reader forever. A `/dream` at the end of a day should not fail over a setting. The cost is
that such a writer keeps today's conflict risk, so the writer says so every time: the CLI prints
one line on stderr, and the result carries `layout: "day"`, which the `remember` tool returns.

Rejected:

- *Refuse when there is no name.* It turns an upgrade into a failing `/dream` for anyone whose git
  name has no ASCII letters.
- *A shared `unknown.md` in the day directory.* It is the day file again under a new name, with
  the same conflict, and one more thing for readers to explain.
- *A suffix per machine.* A host name is data about the developer's machine in a committed path,
  and it doubles the files to fix a case one person can resolve alone.

## Architecture

```
core/author.js    authorSlug(name)            pure: the six steps above
                  resolveAuthor({ env, cwd, git })
                                              -> { slug, source: "CORTEX_AUTHOR" | "git" }
                                              -> { slug: null, why }        no usable name
                                              throws invalid_author         set and unusable

core/memory.js    append(root, text, { date, kind, author })
                    1. empty check            unchanged
                    2. assertWritable(body)   unchanged, still first
                    3. assertCortexRoot(root) unchanged
                    4. author: the option if given, else resolveAuthor()
                    5. path: memory/<day>/<slug>.md, or memory/<day>.md with no slug
                    6. appendFileSync         unchanged
                  -> { path, day, created, author, layout: "author" | "day" }

                  list(root)     one row per file: { day, author, path }; author is null for
                                 an old day file
                  recent(root, { days })      the newest N days, every file of each
```

- `resolveAuthor` runs `git config user.name` with `execFileSync` and an argument array, never a
  shell string, with the repository (the parent of `.cortex`) as its working directory. `git` is
  injectable so tests need no git and no machine identity (T15). `core/` has not started a process
  before. It does here because [ADR 0016](../adr/0016-a-guarantee-belongs-to-the-act-not-to-the-skill.md)
  puts a guarantee on the act: if each of the two callers resolved the author, one of them would
  forget, and its entries would land in the day file without anyone noticing.
- `append()` takes `author` as an option so a test pins it. A test that relies on the machine's
  git identity passes on a laptop and fails in CI.
- An `author` passed as an option goes through `authorSlug` like any other. The path is still
  built by `resolveInRoot`, so the root guard is unchanged.
- `core/` still imports nothing else in this repository.

## Readers

The plan names three readers. Reading the code found six, and all six learn both layouts in 4.1
(T16). The author always comes from the path (T10); the header is for a person reading the file.

| Reader | Where | Today | After 4.1 |
|---|---|---|---|
| `list`, `recent` | `core/memory.js` | One row per `<date>.md` | One row per file of either layout, with `author` |
| `recall_memory` tool, `cortex-memory.mjs recent` | `mcp/server.js`, `index/cortex-memory.mjs` | `recent()` | The same call. Rows gain `author`. The CLI prints each file, whose header names the author |
| Catch-me-up, repo half | `catchUpRepo()` in `mcp/lib/catchup.js` | `recent({ days: Infinity })`, filtered by `since` | The same. `memory` rows gain `author` |
| `recall` in repo mode | `mcp/lib/recall.js` | Searches every `.md` under `.cortex/`, through the Vault's recursive walk | No code change expected: a file in a day directory is found already, and its path in the result names the author. A test pins it |
| The viewer timeline | `readMemory()` and `buildOverview()` in `index/lib/overview.mjs`, drawn by `index/lib/view-html.mjs` | The newest 3 files, one entry per heading | The newest 3 days. Entries gain `author`. The page shows `memory · dream · dev-a` |
| `cortex-next` and the loop | `latestDigest()` and `filesIn()` in `index/lib/next.mjs`, `filesIn()` in `index/lib/loop.mjs` | Count `*.md` directly in `.cortex/memory/`, and match `<date>.md` for the newest | Ask `list()` in `core/memory.js`. Without this, a repo that only ever wrote the new layout is told its memory was never started |

The plan says the timeline is in `index/lib/view.mjs`. It is in `index/lib/overview.mjs`, and
`view-html.mjs` draws it.

### Ordering and attribution

- **Days** are newest first, as today.
- **Files within a day (T11):** the old day file first, then author files by slug, ascending.
  This order depends only on the names, so it is the same on every machine, whatever order the
  file system returns and whatever order the branches merged in. It keeps recall deterministic,
  which the roadmap lists as an invariant. The old file is first because on a day that has both,
  it is what was written before the team moved over.
- **Entries in the timeline:** within a day, by `HH:MM` descending, then by slug ascending, with
  entries that have no author before those that have one, then by position in the file. Memory
  still sits before commits on the same day.
- **Attribution:** `author` is the slug, or `null` for an entry from an old day file. A reader
  shows nothing for `null`. It never guesses an author from `git blame` or from the text.
- `HH:MM` is the writer's local clock, with no time zone. Sorting by it across authors gives a
  stable order for display. It does not claim which of two developers in different time zones
  wrote first.

Rejected: *ordering files by the time of the commit that added them.* It needs git for every
file, it differs between clones with different merge histories, and it is unavailable where the
viewer already runs without git.

### `days` means days (T12)

`recent(root, { days: 7 })` takes the first seven rows of `list()` today, which is seven days only
because a day is one file. It becomes the newest seven distinct days and every file of each.
`MEMORY_FILES = 3` in `overview.mjs` becomes three days for the same reason. `memory.days` on the
overview stays a count of distinct days, and the digest count in `cortex-next` stays a count of
files.

### No entry is lost when both layouts hold the same date

`list()` returns the old day file and every author file for that date as separate rows. No reader
merges, replaces or deduplicates rows, so there is no step at which one layout can hide the other.
Each reader's test (see "Verification") holds a date with both layouts and asserts that every
entry's text appears in that reader's output.

## Existing repos

**No migration (T13).** A repo with old day files keeps them, byte for byte, forever. They are
valid memory, every reader reads them, and they show with no author. A long-lived repo looks like
this: old day files up to the day the team's writers moved to 4.2, day directories after, and a
few dates with both, where some developers had updated and some had not.

Rejected: *splitting old files by author with `git blame`.* It rewrites committed memory, which
the append-only rule and the plan both forbid. Blame also names whoever last touched a line,
including the person who resolved a conflict, so the split would attribute entries wrongly.

**The writer starts with the release that ships 4.2, with no setting (T14).**

- Step 4.1 ships first, in its own release. From then on every updated install reads both
  layouts. Only after that does 4.2 start writing the new one.
- A setting that turns the layout on would leave the default as the layout that conflicts. A team
  where half the developers opted in still conflicts among the other half.
- A team does not need to update together. A developer on an older Cortex keeps writing the day
  file, and every updated reader reads it.
- **The one real cost:** a Cortex older than 4.1 ignores day directories. Its `list()` pattern
  matches only `<date>.md`, and `filesIn()` in `next.mjs` keeps only names ending in `.md`. A
  developer on such a version sees fewer entries, never wrong ones, until they update. The
  changelog entry for 4.2 says so.
- Rollback is reverting 4.2. Readers keep reading both layouts, so entries already written in day
  directories stay visible.

## The gate and the append-only rule

Both hold unchanged, and both are guaranteed in the same place as today.

- **The secret gate.** `append()` in `core/memory.js` calls `assertWritable(body)` from
  `core/scrub.js` before it computes a path or touches the disk. It is the only function that
  writes memory, and both callers go through it. Step 4.2 changes the path that is computed after
  that call and nothing before it. The `remember` tool is gated a second time in the dispatch of
  `mcp/server.js`: its row in `mcp/lib/tools.js` says `writes: PUBLISHED`, so
  `assertPublishable()` scrubs its `content`. A refused write must leave no day directory behind,
  so the directory is created after the gate, and a test asserts it.
- **The slug cannot carry a secret past the gate.** It is at most 40 characters of `a-z0-9-`.
- **Append-only.** `append()` writes with `appendFileSync` and nothing else. No function in
  `core/memory.js` opens a memory file for writing in any other way, and none is added. No step
  moves, renames or rewrites a file. ADR 0002's warning stands as written: a feature that mutates
  an existing entry brings back the lost update.
- **The consent gate.** `append()` still never creates `.cortex/`. It creates `memory/` and the
  day directory inside a `.cortex/` that exists, as it creates `memory/` today.
- **The root guard.** The path is still built by `resolveInRoot`, and `assertCortexRoot` still
  refuses a root that is not the `.cortex` directory.

## Verification

Tests are written first in every step, and each step runs the five suites the plan lists. 4.1,
4.2 and 4.3 each change what the plugin ships, so each is stamped with
`node tools/cortex-version.mjs --set`.

### 4.1 — readers learn both layouts

One fixture is shared by every test: `2026-08-14.md`; `2026-08-15.md` with two entries;
`2026-08-15/dev-a.md` and `2026-08-15/dev-b.md` with one entry each, written at the same minute;
a stray `README.md` in `memory/` and in the day directory; and a second fixture that holds only
`2026-08-16/dev-a.md`.

| Reader | Test file | Asserts |
|---|---|---|
| `list`, `recent` | `core/test/memory.test.js` | Four rows in the order of T11, with `author` `null`, `dev-a`, `dev-b`; `recent({ days: 1 })` returns the three files of the 15th; the strays are ignored |
| `recall_memory` | `mcp/test/mode.test.js`, over a spawned server | Every entry's text is in the result; rows carry `author` |
| `recall` | `mcp/test/` | A word that appears only in `2026-08-15/dev-b.md` is found, with that path |
| Catch-up | `mcp/test/catchup.test.js` | `since` filters by day; all three files of the 15th come back; nothing from the 14th when `since` is the 15th |
| Timeline | `index/test/overview.test.mjs`, `index/test/view.test.mjs` | All four entries of the 15th are in the timeline, in the order of T11; the page shows the author for two and none for the old file's two |
| `cortex-next`, loop | `index/test/next.test.mjs`, `index/test/loop.test.mjs` | On the second fixture the memory step is done and names `2026-08-16` |
| CLI | `index/test/cli.test.mjs` | `recent` prints all four entries of the 15th |

"Loses no entry" is asserted the same way in each: the text of every entry in the fixture is in
the output. The check that the tests can fail: remove the day-directory branch from `list()` and
every row above goes red. The writer does not change in this step, so no existing repo sees a
difference.

### 4.2 — the writer writes one file per author per day

- `core/test/author.test.js`: the slug table above, row by row; `CORTEX_AUTHOR` beats git; an
  unusable `CORTEX_AUTHOR` throws `invalid_author`; no name gives `slug: null`. Git is injected,
  so the test reads no machine identity.
- `core/test/memory.test.js`: with an author, the first write creates `<day>/<slug>.md` with the
  `# <day> · <slug>` header; a second write by the same author appends and the header is there
  once; a second author gets a second file; with no author the entry goes to `<day>.md` and the
  result says `layout: "day"`; a write carrying a secret throws `refused_write` and leaves neither
  a file nor a day directory.
- **The merge test the plan asks for**, in `tools/test/`, as a fragment run by `run.sh`: a real
  git repo in a temp dir, two branches, the real CLI with `CORTEX_AUTHOR=dev-a` on one and
  `CORTEX_AUTHOR=dev-b` on the other, then `git merge` exits 0 and both files exist. The same
  fragment runs both branches as `dev-a` and asserts that the merge then fails, so the test is
  shown to be able to go red. This is the reproduction above, made permanent.
- **The secret gate still refuses:** `index/test/cli.test.mjs` (exit 2 through the CLI) and
  `mcp/test/mode.test.js` (a refused `remember` over a spawned server) pass with an author set,
  and each asserts that no day directory was created.
- The 4.1 reader tests then read what the real writer wrote, in place of hand-written fixtures.

### 4.3 — templates, briefs and rituals describe the new layout

- The plan's check: `rg -n "one file per day" skills templates docs CONTEXT.md` returns only
  history: ADR 0002's original text, this spec, the roadmap spec and the plan.
- A second check, because the false claim is worded differently in each place:
  `rg -n "ordinary text|merges it as text" core skills templates CONTEXT.md` returns nothing.
- Files to change, found by grep on 2026-10-09: `skills/dream/SKILL.md`,
  `skills/catch-me-up/SKILL.md`, `skills/handoff/SKILL.md` (its table row), `CONTEXT.md`
  (Memory), `core/AGENTS.md` (the append-only bullet), the header comment of `core/memory.js`,
  the comments in `mcp/lib/catchup.js` and `index/lib/next.mjs`, the `remember` description in
  `mcp/lib/tools.js`, and `templates/target-AGENTS.md` if its one line needs it. The dream ritual
  also gains the `CORTEX_AUTHOR` line and what the day-file fallback means.
- ADR 0002 is amended with a dated section: the layout is one file per author per day, why (the
  reproduction), and that `merge=union` was weighed and not taken. Its original text stays.
- Neither `dream` nor `catch-me-up` is in `evals/skills.mjs`, so no baseline is re-measured. If a
  `description` changes, `node evals/run.mjs --check` covers the trigger prompts.

## Risks & edges

- **Mixed versions.** Covered under "Existing repos": an old reader misses new-layout entries,
  and an old writer keeps the day file. Neither loses data.
- **Many authors against the transport cap.** `recall_memory` returns whole files, and the
  transport caps a result at 40,000 characters and marks it `truncated`. Fifty authors on one day
  can pass that with `days: 1`. The cut is visible, not silent. An `author` argument would be the
  way to return less; it is left out of this part (T17) until a real team reaches the cap.
- **A fallback nobody notices.** A developer whose name gives no slug keeps writing day files and
  keeps the conflict. The writer says so on every such write.
- **A hand-made file in a day directory.** Any `<slug>.md` there is read as that author's file.
  That is the layout's rule, and readers treat memory as other people's text already.
- **Time zones.** The day is the writer's local day, as today. Two developers far apart can file
  the same hour under two dates. This part does not change it.

## Not confirmed

- **What GitHub's merge button does with the built-in `union` driver today.** The only statement
  found is the 2016 third-party report quoted above. No GitHub documentation sentence was found
  either way, and no hosted pull request was opened to test it, because this step may not push.
  The test that would settle it: a throwaway repository with the `.gitattributes` line, case 2 as
  two branches, and a pull request for the second. The decision here does not depend on the
  answer.
- **Other hosts** (GitLab, Bitbucket) were not checked.
- **Other git versions.** Every result is from git 2.47.1 on Windows with the `ort` strategy.
- **Windows device names with an extension.** On the Windows 11 machine used, Node wrote
  `con.md`, `nul.md` and `com1.md` as ordinary files. Step 6 of the slug rule excludes those names
  anyway, because older Windows versions are said to refuse them and this was not tested.
- **Non-ASCII file names across operating systems.** The reason given for an ASCII slug (that the
  same name can be stored as different bytes on different systems) was not reproduced. It is the
  cautious choice, not a measured one.
- **Whether git will make a commit on a machine with no `user.name`.** Not tested. The design
  does not rely on it.

## Out of scope

- Rewriting, moving, splitting or pruning any existing memory file.
- Stamping a `.gitattributes` line, or any other merge rule, into a target repo.
- An author on entries in old day files, from `git blame` or anything else.
- An `author` filter on `recall_memory`, `recent` or catch-up.
- Time zones in entry headings, or a change to what a "day" is.
- Removing the old layout from any reader. There is no contract step.
- The team-brain's notes (`capture`, one file per note). They are a different store with a
  different layout and are not touched.
- Any hook, and any change to how `.cortex/` is first created.
