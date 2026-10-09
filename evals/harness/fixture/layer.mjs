// The shop's context layer: the nine documents the with-arm holds and the without-arm does not.
// They are written here, by hand, in the shape /cortex-scaffold and /cortex-brief write: a root brief
// after templates/target-AGENTS.md, the one-line shims, a glossary, three ADRs and two scoped
// briefs. No hook, verifier, REVIEW.md or team file is part of it (the spec's M2).
//
// Each of the four rules is stated in these files and nowhere in the base tree. The words the leak
// check looks for are listed beside each rule in ../fixture.mjs.
//
// A change to any string here changes the measured repo: raise FIXTURE_VERSION in ../fixture.mjs.

export const CODENAME = "larkspur";

export const LAYER = {
  "AGENTS.md": `# shop — agent brief

A small checkout service: a shopper fills a cart, places an order, pays, and the order ships. It is
the system of record for orders, and finance reads its ledger export every month.

Project codename: ${CODENAME}

## Stack

Node 20 or later, ES modules, \`node:http\` and \`node:test\`. There are no dependencies and nothing
to install.

## Layout

| Path | Holds |
|---|---|
| \`src/server.js\` | \`createApp({ db, clock })\` and the route table |
| \`src/routes/\` | one module per resource: request in, service call, response out |
| \`src/cart/\` | carts and their totals |
| \`src/orders/\` | the order lifecycle, its audit log, tax |
| \`src/catalog/\` | products and stock |
| \`src/money/\` | the only place amounts are divided or rounded |
| \`src/store/\` | the store and its migrations |
| \`src/lib/\` | clock, ids, errors |

## Running it

\`\`\`bash
npm test      # node --test; needs no service and no install
npm start     # listens on PORT, 3000 by default
\`\`\`

\`createApp\` returns \`request(method, path, body)\`, which answers \`{ status, body }\` without
opening a port. Tests call it directly.

## Invariants

Things that must stay true. No test in \`test/\` enforces any of them.

- **An amount is an integer number of minor units** (cents). Any calculation that can leave a
  fraction, such as a percentage or a share, goes through \`src/money/money.js\`, which rounds half
  to even. Never \`Math.round\` on money, and never \`Math.floor\` or a float. The ledger export is
  reconciled to the cent against a payment provider that rounds the same way, so one cent of
  difference is a finance ticket.
  [ADR 0001](docs/adr/0001-money-is-integer-minor-units.md).
- **Routes call services.** A module under \`src/routes/\` imports services only. It never imports
  from \`src/store/\` or a \`repository.js\`, even for a read.
  [ADR 0003](docs/adr/0003-routes-call-services.md).
- **The stored shape of a table changes only through a new numbered migration.** Migrations are
  append-only. [ADR 0002](docs/adr/0002-migrations-are-append-only.md), and
  [\`src/store/AGENTS.md\`](src/store/AGENTS.md) before touching the store.

## Gotchas

- \`db.remove\` exists because carts are thrown away. It is not a general way to end a record:
  orders have their own rules, in [\`src/orders/AGENTS.md\`](src/orders/AGENTS.md).
- The clock is passed in. \`new Date()\` in a service makes its test depend on the day it runs.
- A product's price is copied onto the cart line when it is added, so a later price change does not
  reprice a cart.

## Where to look

Scoped briefs. Read this file, match your work to a row, then open **one** leaf:

| Working in | Read first |
|---|---|
| \`src/orders/\`, or anything that changes an order | [\`src/orders/AGENTS.md\`](src/orders/AGENTS.md) |
| \`src/store/\`, or anything that changes what is stored | [\`src/store/AGENTS.md\`](src/store/AGENTS.md) |

## Conventions

- A service function takes \`ctx\` (\`{ db, clock }\`) first. It throws an \`AppError\` from
  \`src/lib/errors.js\` and the server turns that into a status.
- A route handler is three steps: read the request, call one service function, shape the response.

## Context files

- \`CONTEXT.md\` — the domain glossary. Terms mean what it says they mean.
- \`docs/adr/\` — decisions and why.
`,

  "CLAUDE.md": "@AGENTS.md\n",

  "GEMINI.md": "@AGENTS.md\n",

  "CONTEXT.md": `# shop — glossary

Terms mean what this file says they mean. Decisions and their reasons are in \`docs/adr/\`.

- **amount** — money, as an integer number of minor units: 1250 is 12.50. An amount is never a
  float and never has a fraction. Dividing or taking a percentage of one goes through
  \`src/money/money.js\`, which rounds half to even, because the ledger export is reconciled to the
  cent against the payment provider.
- **basis point** — a hundredth of a percent. 2000 basis points are 20%. Rates are stored this way
  so a rate is an integer too.
- **cart** — what a shopper is filling. It has no history and nobody else reads it, so a cart that
  is abandoned or turned into an order is deleted.
- **order** — a cart that was placed. An order is a record: finance and support read it long after
  the shopper has gone.
- **status** — where an order is: \`placed\`, then \`paid\`, then \`shipped\`.
- **cancelled** — a status, not an absence. A cancelled order is still in the store. An order is
  never removed, because a refund and the monthly export both need to find it.
- **audit entry** — one row saying that one order changed status, and when. Every status change
  appends exactly one audit entry. The audit log is what refunds and the monthly export read.
- **migration** — a numbered file under \`src/store/migrations/\` that changes the stored shape of a
  table. Once it has shipped it is history.
- **shipped migration** — a migration that a deployed store has already run. Editing it changes
  nothing for that store.
`,

  "docs/adr/0001-money-is-integer-minor-units.md": `# ADR 0001 — Money is integer minor units, rounded in one place

**Status:** accepted

## Context

The ledger export is reconciled every month against the payment provider's settlement file, to the
cent. The provider rounds half to even. An early version computed tax with \`Math.round\`, which
rounds half up, and the two totals differed by one cent on about one order in two hundred. Each
difference was looked into by hand.

## Decision

An amount is an integer number of minor units. Any calculation that can leave a fraction goes
through \`src/money/money.js\`: \`percent(amount, basisPoints)\` for a rate, and a new function there
for anything it does not cover yet. That module rounds half to even. Nothing else rounds money:
never \`Math.round\`, \`Math.floor\`, \`toFixed\` or a float rate such as \`0.1\`.

## Alternatives rejected

| Option | Why not |
|---|---|
| Floats, rounded when shown | The stored total and the reconciled total then differ |
| Round half up everywhere | It is what most people expect, and it is not what the provider does |
| A decimal library | One function covers every case this service has |

## Consequences

A new price rule (a discount, a fee, a split) is a call to \`percent\` or a new function beside it,
with the rate in basis points. A reviewer who sees \`Math.round\` near an amount sends it back.
`,

  "docs/adr/0002-migrations-are-append-only.md": `# ADR 0002 — Migrations are append-only

**Status:** accepted

## Context

Every deployed store records the number of the last migration it ran, and \`migrate()\` runs only
the ones above it. A developer once added a field by editing an existing migration. New stores got
the field. Deployed stores had already run that file and never did, and the difference showed up
weeks later as rows with a missing field.

## Decision

The stored shape of a table changes only through a new numbered migration, added to
\`src/store/migrations/\` and to the list in \`src/store/migrate.js\`. A migration that has shipped is
never edited, because deployed stores have already run it. A migration that adds a field also fills
it in on every row already stored.

A read path does not paper over a missing field. Code that reads a row trusts its shape; a default
applied on read hides the rows that were never migrated from everything that reads the store
directly, such as the export.

## Alternatives rejected

| Option | Why not |
|---|---|
| Edit the migration that created the table | Deployed stores have already run it |
| Default the field when reading | The stored rows stay wrong, and the export reads stored rows |
| Change rows by hand on each deployment | Nothing records that it was done |

## Consequences

Adding a field is three edits: a new migration that backfills it, the list in \`migrate.js\`, and
the code that writes it. \`003-order-currency.js\` is the example to copy.
`,

  "docs/adr/0003-routes-call-services.md": `# ADR 0003 — Routes call services

**Status:** accepted

## Context

A route once read orders straight from the store to build a list. The service applied a rule the
route did not know about, and the two answers disagreed. Finding out which callers skip the
service meant reading every route.

## Decision

Routes call services, and services own the rules. A module under \`src/routes/\` imports
services only: \`src/cart/cart.js\`, \`src/orders/service.js\`, \`src/catalog/catalog.js\`. It never
imports from \`src/store/\` or a \`repository.js\`. A route that needs something a service does not
offer gets a new service function.

## Alternatives rejected

| Option | Why not |
|---|---|
| Let a route read the store for simple lists | "Simple" is where the rules were skipped |
| Pass the repository to the route | The same shortcut with one more argument |

## Consequences

Every read and write of an order goes through \`src/orders/service.js\`, so a rule added there
holds for every caller.
`,

  "src/orders/AGENTS.md": `# src/orders/ — the order lifecycle

Read the root brief first. This file holds what must stay true when an order changes.

An order moves \`placed\` → \`paid\` → \`shipped\`. \`service.js\` owns every move. \`repository.js\`
reads and writes order rows and knows no rules. \`audit.js\` records what happened.

## Invariants

- **An order is never removed from the store.** Ending an order is a status change, not a delete.
  \`db.remove\` is for carts. A refund, a support question and the monthly export all look an order
  up long after it ended, and a missing row there is a lost order.
- **Every status change appends exactly one audit entry**, in the service function that makes the
  change, with the order's id. Not zero and not two. \`payOrder\` and \`shipOrder\` are the pattern:
  save the new status, then \`recordAudit\`.
- **A change that is refused writes nothing.** Check the status first and throw; neither the order
  nor the audit log changes.

## Gotchas

- Refunds and the monthly export read the audit log, not the order's status. An order whose status
  changed with no audit entry is invisible to both.
- Amounts on an order are fixed when it is placed. The root brief has the rule for computing them.

## Checks

\`\`\`bash
node --test test/orders.test.js
\`\`\`
`,

  "src/store/AGENTS.md": `# src/store/ — the store and its migrations

Read the root brief first. This file holds what must stay true when what is stored changes.

\`db.js\` is the store: tables of rows, copied in and out. \`migrate.js\` runs every migration above
the version the store records. \`migrations/\` holds them, numbered.

## Invariants

- **The stored shape of a table changes only through a new numbered migration.** Add
  \`migrations/00N-what-it-does.js\` and put it at the end of the list in \`migrate.js\`.
- **Migrations are append-only: one that has shipped is never edited**, because deployed stores
  have already run it and will not run it again.
  [ADR 0002](../../docs/adr/0002-migrations-are-append-only.md).
- **A migration that adds a field fills it in on every stored row.** \`003-order-currency.js\` does
  this for \`currency\`.
- **A read path does not paper over a missing field.** No \`row.field ?? default\` in a repository
  or a service. The export reads stored rows, so a default applied on read leaves them wrong.

## Gotchas

- \`createApp\` runs \`migrate(db)\` at start, so a deployed store is upgraded when the new code boots.
- A test that needs an old store builds one with \`createDb(snapshot)\`; \`test/store.test.js\` has an
  example.

## Checks

\`\`\`bash
node --test test/store.test.js
\`\`\`
`,
};
