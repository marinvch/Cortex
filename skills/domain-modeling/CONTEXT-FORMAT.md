# CONTEXT.md entries

The layout matches Cortex's `templates/CONTEXT.md`, which `/cortex-scaffold` seeds a repo's
`CONTEXT.md` from. Keep the two consistent; when they differ, the template is right and this page is
stale.

## One entry

```md
## Booking

A patient's reserved Slot with one clinician, from confirmation until the visit ends or is
cancelled. Modelled by `src/scheduling/booking.ts`.

_Avoid_: "appointment" (the calendar invite sent to the patient, a separate record), "reservation"
(used by the room system for something else).
```

- **The heading is the canonical term.** One term per `##` heading.
- **The definition says what the thing is in this system**, in one or two sentences. Not what it
  does, and not what the word means in ordinary English. Name the type, table or module it maps to
  when there is one.
- **`_Avoid_` lists the competing words** and why each is wrong here. This is the line that stops a
  rejected word from coming back in review, so do not leave it out when a rival word exists.
- **Domain terms only.** Before adding one, ask whether a developer on an unrelated project would
  use the word the same way. If they would (cache, retry, handler), it does not belong.
- **Group related terms** under a short section heading once there are enough to form clusters.
  A short glossary stays flat.

If a definition needs more than a short paragraph, it is probably a decision. Write the ADR and link
it from the entry.

## One context or several

Most repos have one context and one `CONTEXT.md` at the root.

A repo with several bounded contexts has a `CONTEXT-MAP.md` at the root that lists them and says how
they talk to each other, and a `CONTEXT.md` beside each one's code:

```md
# Context map

| Context | Glossary | Owns |
|---|---|---|
| Scheduling | [src/scheduling/CONTEXT.md](src/scheduling/CONTEXT.md) | slots, bookings, cancellations |
| Billing | [src/billing/CONTEXT.md](src/billing/CONTEXT.md) | charges, refunds, invoices |
| Records | [src/records/CONTEXT.md](src/records/CONTEXT.md) | patient history and notes |

## How they connect

- Scheduling publishes `BookingCompleted`; Billing reads it and raises a charge.
- Records looks up patients by `PatientId` and never stores a copy of Scheduling's data.
```

To decide which layout a repo has:

- `CONTEXT-MAP.md` present: read it, and work in the context the discussion belongs to. Ask if that
  is unclear.
- Only a root `CONTEXT.md`: one context.
- Neither: create a root `CONTEXT.md` when the first term is settled, not before.
