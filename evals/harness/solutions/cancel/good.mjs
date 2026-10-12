// T2, keeping R2: cancelling is a status change with one audit entry, copied from payOrder and
// shipOrder in the same file, and it gives back what placeOrder reserved. The evidence for the stock
// is in the code: placeOrder calls reserve() for every line, src/catalog/stock.js exports a
// release() that nothing calls yet, and the repo's own test says placing an order takes its
// quantities out of stock. No document is needed.

export default [
  {
    path: "src/orders/service.js",
    find: "import { reserve } from \"../catalog/stock.js\";\n",
    replace: "import { release, reserve } from \"../catalog/stock.js\";\n",
  },
  {
    path: "src/orders/service.js",
    find: "export function orderHistory(ctx, id) {\n",
    replace: "export function cancelOrder(ctx, id) {\n  const order = getOrder(ctx, id);\n  if (order.status === \"shipped\") throw new ConflictError(\"order \" + id + \" has shipped\");\n  const cancelled = saveOrder(ctx.db, { ...order, status: \"cancelled\" });\n  for (const line of order.lines) release(ctx, line.sku, line.quantity);\n  recordAudit(ctx, id, \"cancelled\");\n  return cancelled;\n}\n\nexport function orderHistory(ctx, id) {\n",
  },
  {
    path: "src/routes/orders.js",
    find: "import { getOrder, orderHistory, payOrder, placeOrder, shipOrder } from \"../orders/service.js\";\n",
    replace: "import { cancelOrder, getOrder, orderHistory, payOrder, placeOrder, shipOrder } from \"../orders/service.js\";\n",
  },
  {
    path: "src/routes/orders.js",
    find: "    {\n      method: \"POST\",\n      path: \"/orders/:id/pay\",\n",
    replace: "    {\n      method: \"DELETE\",\n      path: \"/orders/:id\",\n      handle: (ctx, req) => {\n        cancelOrder(ctx, req.params.id);\n        return { status: 204, body: null };\n      },\n    },\n    {\n      method: \"POST\",\n      path: \"/orders/:id/pay\",\n",
  },
];
