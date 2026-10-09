// The five tasks of the outcome harness. This is the only list of them: the runner, the scorer, the
// table and the tests all read it.
//
// A prompt is sent as written, to both arms, followed by CLOSING. No prompt names a document or
// states a rule. `rule` is the rule in the context layer the task depends on (fixture.mjs RULES);
// the control depends on none, so the layer should not help it.
//
// A change to a prompt changes what is measured: raise FIXTURE_VERSION in fixture.mjs with it.

export const CLOSING = "Make the change in this repository, and run its tests before you finish.";

export const TASKS = [
  {
    id: "discount",
    label: "T1",
    rule: "R1",
    control: false,
    prompt: "Orders of 100.00 or more should get 10% off. Add it to the cart totals: `GET /carts/:id` should return a `discount` field next to `subtotal`, and `total` should be the subtotal minus the discount. Below 100.00 the discount is 0.",
  },
  {
    id: "cancel",
    label: "T2",
    rule: "R2",
    control: false,
    prompt: "Add order cancellation. `DELETE /orders/:id` cancels an order that has not shipped and answers 204. For a shipped order it answers 409, and for an unknown id 404.",
  },
  {
    id: "note",
    label: "T3",
    rule: "R3",
    control: false,
    prompt: "Orders need a free-text `note`. `POST /orders` should accept an optional `note` and `GET /orders/:id` should return it; an order placed without one has an empty string. Orders that already exist must read back with an empty note too.",
  },
  {
    id: "by-status",
    label: "T4",
    rule: "R4",
    control: false,
    prompt: "Add `GET /orders?status=<status>`: it returns the orders in that status, oldest first. With no `status` it returns all orders.",
  },
  {
    id: "search-empty",
    label: "T5",
    rule: null,
    control: true,
    prompt: "`GET /catalog` with no `q`, or an empty one, answers 500. It should answer 200 with every product, sorted by name. `GET /catalog?q=mug` should keep working.",
  },
];

export const taskById = (id) => TASKS.find((t) => t.id === id);

// The bytes a session reads on stdin. The same for both arms.
export const promptFor = (task) => `${task.prompt}\n\n${CLOSING}\n`;

// The probe that runs before any session: the root brief carries one line naming a codename, so a
// with-arm session can answer and a without-arm session cannot. It is not a task and is not scored.
export const PROBE_PROMPT = "What is this project's codename? Answer with the codename alone. If nothing you have been given states one, answer NONE. Do not search for it.\n";
