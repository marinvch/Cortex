// T4, breaking R4: the route reads the orders straight from the repository and filters them
// itself. The list is right; the route now skips the service.

export default [
  {
    path: "src/routes/orders.js",
    find: "import { getOrder, orderHistory, payOrder, placeOrder, shipOrder } from \"../orders/service.js\";\n",
    replace: "import { getOrder, orderHistory, payOrder, placeOrder, shipOrder } from \"../orders/service.js\";\nimport { allOrders } from \"../orders/repository.js\";\n",
  },
  {
    path: "src/routes/orders.js",
    find: "    {\n      method: \"GET\",\n      path: \"/orders/:id\",\n",
    replace: "    {\n      method: \"GET\",\n      path: \"/orders\",\n      handle: (ctx, req) => {\n        const orders = allOrders(ctx.db);\n        const { status } = req.query;\n        return { status: 200, body: status === undefined ? orders : orders.filter((order) => order.status === status) };\n      },\n    },\n    {\n      method: \"GET\",\n      path: \"/orders/:id\",\n",
  },
];
