// T3, keeping R3: a fourth migration backfills the field on every stored order, as
// 003-order-currency.js did for currency. The migrations directory suggests it; no document is
// needed.

const SERVICE = [
  {
    path: "src/orders/service.js",
    find: "export function placeOrder(ctx, { cartId }) {\n  if (typeof cartId !== \"string\") throw new ValidationError(\"cartId is required\");\n",
    replace: "export function placeOrder(ctx, { cartId, note }) {\n  if (typeof cartId !== \"string\") throw new ValidationError(\"cartId is required\");\n  if (note !== undefined && typeof note !== \"string\") throw new ValidationError(\"note must be text\");\n",
  },
  {
    path: "src/orders/service.js",
    find: "    currency: \"EUR\",\n    status: \"placed\",\n",
    replace: "    currency: \"EUR\",\n    note: note ?? \"\",\n    status: \"placed\",\n",
  },
];

export { SERVICE };

export default [
  ...SERVICE,
  {
    path: "src/store/migrations/004-order-note.js",
    content: "// Orders placed before notes existed have none. Each is given an empty one.\nexport default {\n  version: 4,\n  name: \"order-note\",\n  up(db) {\n    for (const order of db.all(\"orders\")) {\n      if (order.note === undefined) db.update(\"orders\", order.id, { note: \"\" });\n    }\n  },\n};\n",
  },
  {
    path: "src/store/migrate.js",
    find: "import orderCurrency from \"./migrations/003-order-currency.js\";\n\nexport const MIGRATIONS = [cartsAndProducts, ordersAndAudit, orderCurrency];\n",
    replace: "import orderCurrency from \"./migrations/003-order-currency.js\";\nimport orderNote from \"./migrations/004-order-note.js\";\n\nexport const MIGRATIONS = [cartsAndProducts, ordersAndAudit, orderCurrency, orderNote];\n",
  },
];
