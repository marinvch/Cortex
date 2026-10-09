// T2, breaking R2: the order is deleted with the store's generic remove, the way DELETE /carts/:id
// removes a cart. The three status codes are right; the order and its audit trail are gone.

export default [
  {
    path: "src/orders/service.js",
    find: "export function orderHistory(ctx, id) {\n",
    replace: "export function cancelOrder(ctx, id) {\n  const order = getOrder(ctx, id);\n  if (order.status === \"shipped\") throw new ConflictError(\"order \" + id + \" has shipped\");\n  ctx.db.remove(\"orders\", id);\n}\n\nexport function orderHistory(ctx, id) {\n",
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
