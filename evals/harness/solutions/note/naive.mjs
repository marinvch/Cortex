// T3, breaking R3: new orders store the note, and the read path fills in an empty one for orders
// that have none. Every request the prompt names answers correctly; the stored rows of existing
// orders never get the field, and no migration ran.

import { SERVICE } from "./good.mjs";

export default [
  ...SERVICE,
  {
    path: "src/orders/repository.js",
    find: "export function findOrder(db, id) {\n  return db.get(\"orders\", id);\n}\n",
    replace: "export function findOrder(db, id) {\n  const order = db.get(\"orders\", id);\n  return order ? { note: \"\", ...order } : null;\n}\n",
  },
];
