# Erasing personal data from committed memory

Cortex's repo memory (`.cortex/memory/`) and a team-brain are **committed** and **append-only**
([ADR 0002](adr/0002-committed-repo-memory.md)). Nothing in Cortex rewrites or deletes an entry, so
when personal data has to go — a request under GDPR Art. 17, or a note that should never have been
written — it is removed from git history, by hand, with the steps below.
[ADR 0027](adr/0027-personal-data-in-committed-memory-is-warned-about-and-erasable.md) says why it
is a procedure and not a feature.

Deleting the file in a new commit is **not** erasure. The old content stays in history, in every
clone, in every fork and in every CI cache.

## Before you start

- Agree a window with everyone who has a clone. Step 4 replaces every clone; work pushed from an
  old clone afterwards brings the data back.
- Install [`git filter-repo`](https://github.com/newren/git-filter-repo). `git filter-branch` works
  too but is slow and easy to get wrong.
- Work in a **fresh mirror clone**, never in your working copy:

  ```bash
  git clone --mirror <remote-url> repo-erase.git
  cd repo-erase.git
  ```

## 1. Find every occurrence

```bash
# Which commits touched the text (a literal string; -G takes a regex)
git log --all -S '<the value>' --oneline -- .cortex/memory/
# Which paths hold it at any point in history
git grep -l '<the value>' $(git rev-list --all) -- .cortex/memory/ | cut -d: -f2 | sort -u
```

For a team-brain, drop the `-- .cortex/memory/` limit: notes live under `inbox/`, `projects/` and
`asks/` there.

The author slug is personal data too. `memory/<day>/<author>.md` puts it in every path that person
wrote, so a request to erase a person usually covers those files as well (step 2a).

## 2. Rewrite history

**2a. Remove whole files** — one person's memory files, or a note that is personal throughout:

```bash
git filter-repo --invert-paths --path .cortex/memory/2026-10-09/jane-roe.md
# every file by one author, on every day:
git filter-repo --invert-paths --path-glob '.cortex/memory/*/jane-roe.md'
```

**2b. Replace a value everywhere it appears**, keeping the rest of each entry:

```bash
printf '%s\n' 'jane.roe@mailhost.dev==>[removed]' > ../replacements.txt
git filter-repo --replace-text ../replacements.txt
```

Each line of the replacements file is `literal==>replacement`, or `regex:<pattern>==>replacement`.
Keep that file outside the repository and delete it when you are done: it holds the value you are
erasing.

## 3. Push the rewritten history

```bash
git push --force --mirror <remote-url>
```

`--mirror` rewrites every branch and tag. On GitHub, open pull requests keep references to old
commits (`refs/pull/*`), which you cannot overwrite: close them, and ask GitHub Support to remove
cached views and run garbage collection on the repository. Other hosts have the same step under a
different name.

## 4. Replace every clone

Every developer, every CI runner with a cache, every backup and every fork still holds the old
history. Each one must be **deleted and cloned again** — `git pull` on an old clone merges the old
history back in. Forks are separate repositories: their owners have to do steps 2–3 themselves.

## 5. Rotate anything that was a secret

If what you erased was a credential as well as personal data, erasure does not make it safe again:
anyone who cloned before step 3 has it. Revoke and rotate it.

## Keeping a real name out of paths from the start

`append()` names the author file from `CORTEX_AUTHOR`, else git `user.name`. Set `CORTEX_AUTHOR` to
a pseudonym — a handle, a role — and that is what appears in `memory/<day>/<author>.md`; no email
address is ever read or written. Only the slug is stored, and erasing a person later is then a
question about their pseudonym's files.

## Stopping it at the gate

The publish gate warns on email addresses, phone numbers, IBANs and card numbers by default.
`CORTEX_PII=refuse` turns the warning into a refusal, so nothing reaches history in the first place;
`CORTEX_PII=off` stops the scan. The scan is a floor — names and street addresses have no shape it
can hold to.
