# ADR 0012 — one clock per language

**Status:** accepted · 2026-08-19 · Cortex 2.9.1

## Context

`core/date.js` exists so that everything writing a dated artifact — memory files, findings reports,
digests — stamps the day the same way. It reads **local** time: a note is filed under the day the
person filing it is living in.

`mcp/server.js` carried its own, eleven lines below an import of `core/memory.js`:

```js
const today = () => new Date().toISOString().slice(0, 10);
```

That reads **UTC**. `capture` filed through it, so the two halves of one product disagreed about
what day it was for the first hours of every day east of Greenwich and the last hours west of it.

Demonstrated end-to-end through the MCP protocol, against a real server, at 03:59 UTC on
19 August 2026 with `TZ=Pacific/Midway` (UTC-11, so it is still the 18th there):

```
before   filed as 2026-08-19.md   — a day the user has not reached yet
after    filed as 2026-08-18.md   — the day they are living in
```

The same instant in the user's own UTC+3 zone produces the mirror error: a thought captured at 01:00
on the 19th landed in `daily/2026-08-18.md`, yesterday's note.

`server.js:27` was the only UTC clock in the repository. `core/memory.js`, `index/cortex-findings.mjs`
and every shell tool already stamped local. It was the outlier, not the standard — which is why the
fix is a deletion rather than a decision about which convention wins.

## The shell half had the same shape

Four scripts stamped a date, in three format strings (`%Y-%m-%d`, `%F`, `%Y%m%d-%H%M%S`) for two
meanings. Two of them invented a value when `date` failed:

- `|| echo 2026-07-01` wrote a hardcoded past day into project frontmatter. `created: 2026-07-01` is
  not a missing value a reader can spot; it is a plausible wrong one.
- `|| echo 0` set `NOW_EPOCH=0`, making `age_days` negative, so every dormant repo was silently
  classified as active — the exact inverse of the check it fed.

There is no system Cortex runs on without `date`. Both fallbacks defended against nothing and
mis-stamped when they fired.

## Decision

**The wall clock is read in exactly one place per language.** `core/date.js` for the Node half,
`cortex_today` / `cortex_timestamp` / `cortex_epoch` in `tools/_cortex-lib.sh` for the shell half.
Both stamp local time. Neither invents a value on failure.

Two tests pin it, because a rule a test enforces is cheaper than a rule everyone has to remember —
the same reasoning as [ADR 0007](0007-the-vault-is-the-only-door.md) and
[ADR 0010](0010-the-shell-half-gets-the-guard-too.md):

- `mcp/test/one-clock.test.js` scans `mcp/` for `new Date()`, `Date.now()` and `toISOString`, with a
  reasoned allowlist. It has one entry: `lib/noteid.js`, which uses an epoch as a collision-resistant
  id component and never as a calendar day.
- `tools/test/date-parity.test.sh` compares format strings, normalising `%F` against `%Y-%m-%d`, and
  fails if any script reintroduces a literal date fallback.

`core/date.js` itself is unchanged. It was already correct, and it was the one `core/` module with no
test — which is how an outlier came to sit beside it unnoticed. It now has one.

## Two scripts keep their own copy, by design

`tools/cortex-init.sh` does not source `_cortex-lib.sh`: it is a zero-dependency installer, stated in
that lib's own header. `tools/server/cortex-cron.sh` is installed into a crontab beside only
`server-setup.sh`, so there is no lib on disk to source.

Hoisting the helper into a lib neither can load would break both. They keep their copy and take the
**slugify treatment** — the parity test above, mirroring `mcp/test/slug-parity.test.js`. This is the
established answer in this repo for a rule that must hold across a boundary a single implementation
cannot cross.

## Consequences

- `capture` files under the local day. Anyone whose offset is not zero stops losing captures into an
  adjacent day at the edges.
- A second clock in `mcp/` fails the suite instead of shipping. Verified by reintroducing the deleted
  line and watching the guard name it.
- A `date` that cannot be read is now a named failure rather than a plausible wrong number in
  someone's frontmatter.
- The allowlist in `one-clock.test.js` is the place a future non-clock use of `Date` must argue for
  itself, in writing.
