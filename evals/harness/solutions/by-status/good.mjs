// T4, keeping R4: the list is a service function and the route calls it, as every other route in
// the file does. Following the file being edited is enough; no document is needed.

export default [
  {
    path: "src/orders/service.js",
    find: "export function countOrders(ctx) {\n",
    replace: "export function listOrders(ctx, status) {\n  const orders = allOrders(ctx.db);\n  return status === undefined ? orders : orders.filter((order) => order.status === status);\n}\n\nexport function countOrders(ctx) {\n",
  },
  {
    path: "src/routes/orders.js",
    find: "import { getOrder, orderHistory, payOrder, placeOrder, shipOrder } from \"../orders/service.js\";\n",
    replace: "import { getOrder, listOrders, orderHistory, payOrder, placeOrder, shipOrder } from \"../orders/service.js\";\n",
  },
  {
    path: "src/routes/orders.js",
    find: "    {\n      method: \"GET\",\n      path: \"/orders/:id\",\n",
    replace: "    {\n      method: \"GET\",\n      path: \"/orders\",\n      handle: (ctx, req) => ({ status: 200, body: listOrders(ctx, req.query.status) }),\n    },\n    {\n      method: \"GET\",\n      path: \"/orders/:id\",\n",
  },
];
