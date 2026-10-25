# ADRs in a target repo

## Where and how they are numbered

- Directory: `docs/adr/`, or `adr/` when `docs/` is the source of a published site. Create it when
  the first ADR is written.
- File name: four-digit number, then a slug, `0007-refunds-are-separate-records.md`. Take the
  highest number already in the directory and add one.
- The title and slug state the decision, not the topic: "Refunds are separate records", not
  "Refund storage". A reader who sees the ADR cited mid-sentence should get the verdict from the
  title alone.

## Layout

Start from the repo's own `TEMPLATE.md` in the ADR directory, which `/write-context-docs` copies from
Cortex's `templates/adr.md`; with no such file, use `templates/adr.md` directly. Its sections are
date and status, then **Context**, **Decision**, **Alternatives rejected** and **Consequences**. A small decision can fill
each section with a sentence or two. Length is not the goal.

The section that must not be thin is **Alternatives rejected**. Without the reason an option lost,
the next person with the same idea reopens the question. **Consequences** includes the cost being
accepted, not only the benefits.

Status is `proposed`, `accepted`, or `superseded by NNNN`. When a later ADR replaces an earlier one,
update the earlier one's status and link forward; do not delete it.

## Kinds of decision that usually qualify

All three tests in [SKILL.md](SKILL.md) still apply; these are where qualifying decisions tend to
come from.

- **The overall shape.** One deployable or several; how state is stored and read back.
- **How two contexts communicate.** Events, a shared database, direct calls.
- **A dependency that is expensive to replace.** The database, the queue, the identity provider, the
  hosting platform. Not every library.
- **Ownership and scope.** Which context owns a piece of data, and what others may do with it. What
  a context will not do is as worth recording as what it will.
- **A deliberate departure from the usual approach.** Hand-written SQL where an ORM would be
  expected, a cache deliberately left out. Without the record, someone will "fix" it.
- **A constraint the code cannot show.** A regulation, a contract with a partner, a latency budget.
- **An option turned down for a reason that is not obvious.** If it will be proposed again, record
  why it lost.
