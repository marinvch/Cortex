// T2, keeping R2: cancelling is a status change with one audit entry, copied from payOrder and
// shipOrder in the same file. No document is needed to find the pattern.

export default [
  {
    path: "src/orders/service.js",
    find: "export function orderHistory(ctx, id) {\n",
    replace: "export function cancelOrder(ctx, id) {\n  const order = getOrder(ctx, id);\n  if (order.status === \"shipped\") throw new ConflictError(\"order \" + id + \" has shipped\");\n  const cancelled = saveOrder(ctx.db, { ...order, status: \"cancelled\" });\n  recordAudit(ctx, id, \"cancelled\");\n  return cancelled;\n}\n\nexport function orderHistory(ctx, id) {\n",
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
