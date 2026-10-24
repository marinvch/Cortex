# 0027. Personal data in committed memory is warned about, and has an erasure procedure

**Date:** 2026-10-24
**Status:** accepted

## Context

`.cortex/memory/` is committed and append-only ([ADR 0002](0002-committed-repo-memory.md)), and a
team-brain is a git repository other people pull. The gate refused credentials and nothing else, so
a note carrying a colleague's email address, a customer's phone number or a bank account went into
history like any other text.

Two properties make that expensive, and both are deliberate:

- **Append-only.** No entry is ever rewritten, because a writer that mutates entries brings back the
  lost update ADR 0002 exists to prevent. So Cortex has no "delete this entry" operation, and will
  not grow one.
- **Committed.** Every clone, fork, CI cache and backup of the repository holds every entry ever
  written. Deleting a file in a new commit leaves the old content in history.

Under the GDPR (Art. 17, the right to erasure) a person can ask for their personal data to be
erased without undue delay. Erasure from a git repository means rewriting history, force-pushing,
and having **every** clone replaced, because a clone that is not re-cloned still holds the data.
The author slug in `memory/<day>/<author>.md` is personal data as well: it is derived from
`CORTEX_AUTHOR` or git `user.name`, and it names a person in every path they wrote.

## Decision

**The publish gate scans for personal data, and by default warns rather than refuses.**

- `core/scrub.js` `scanPersonal` finds email addresses, phone numbers (international with a `+`, a
  bracketed area code, the North American `555-123-4567` shape), IBANs that pass the mod-97 check,
  and card numbers that pass Luhn and start with a card network's digit. It reports the kind and
  the line, never the value — not even redacted, because most of an email address is still one.
- **`CORTEX_PII` picks the mode: `warn` (the default), `refuse` or `off`.** An unknown value throws,
  for the reason ADR 0015 gives about a profile. In `warn` the write goes through and the result
  carries a `warnings` sentence — the MCP tool result, and stderr for the CLIs — so the model tells
  the person. In `refuse` it is a `PersonalDataError`, a `RefusedWriteError` with code
  `personal_data`, and nothing is written.
- It rides the same gate as the credential scan and the employer denylist (`core/gate.js`), so
  `remember`, `capture`, `ask`, `answer` and the memory CLI all see it.
- **Addresses that name nobody are not personal data**: the reserved `example.*`, `.test`,
  `.invalid`, `.localhost` and `.local` domains, GitHub's noreply domain, a `git@host:` remote, and
  `icon@2x.png`. Versions, dates, IP addresses, UUIDs and millisecond timestamps are tested as
  non-findings.
- **Erasure is a documented procedure, not a feature.** [`docs/erasure.md`](../erasure.md) gives the
  exact steps: find the entries, rewrite history with `git filter-repo` (`--path … --invert-paths`
  for whole files, `--replace-text` for a value), force-push every branch and tag, have every clone
  re-cloned, and rotate anything that was a secret. It names the author slug and
  `CORTEX_AUTHOR=<pseudonym>` as the way to keep a real name out of paths from the start.

## Alternatives rejected

| Option | Why not |
|---|---|
| Refuse personal data by default | Legitimate notes name a shared inbox or a role address — "ask ops@ before the cut-over", a team's support address. A gate that refuses those daily is a gate people switch off, and then it catches nothing |
| No scan, document the risk only | The warning is what reaches the person at the moment of writing, when removing the address costs one retype instead of a history rewrite |
| A `forget` operation that deletes or rewrites an entry | Breaks append-only, the property that makes two writers safe, and still leaves the data in history and every clone — the part erasure is actually about |
| Redact the value in place and write the rest | The gate never sanitises (ADR 0002): a rewritten note is a worse failure than a refused one, and a redactor that misses a shape writes it to history anyway |
| Hash the author slug | A path nobody can read loses who wrote what, which is the reason the layout exists. A pseudonym the person chooses keeps both |

## Consequences

- A team that wants the strict reading sets `CORTEX_PII=refuse` in its environment; the default
  favours notes that mention a role address over a gate that fires on them.
- **The scan is a floor.** A name, a home address or a national ID number passes: they have no shape
  a scanner can hold to without false positives on ordinary prose. The warning is not a clearance.
- Phone detection is conservative on purpose. A number written without a `+`, brackets or the
  North American separators — `020 7946 0958` — passes. A detector that also caught it would also
  catch tables of figures.
- Erasure stays expensive, because the store is committed. That cost is the price ADR 0002 accepted
  for sharing context through git, and this record makes it a procedure someone can follow rather
  than a surprise.
