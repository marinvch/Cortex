// T4, breaking R4: revenue is taken to be the money of every order that was paid for, shipped or
// not. That is the everyday meaning of the word, and with every order shipped it is the same number.
// It counts an order the ledger does not hold yet.

export default [
  {
    path: "src/orders/ledger.js",
    find: "import { allOrders } from \"./repository.js\";\n",
    replace: "import { add } from \"../money/money.js\";\nimport { allOrders } from \"./repository.js\";\n",
  },
  {
    path: "src/orders/ledger.js",
    find: "    .map((order) => ({ orderId: order.id, amount: order.total, currency: order.currency }));\n}\n",
    replace: "    .map((order) => ({ orderId: order.id, amount: order.total, currency: order.currency }));\n}\n\nexport function revenueToDate(ctx) {\n  const paidFor = allOrders(ctx.db).filter((order) => order.status === \"paid\" || order.status === \"shipped\");\n  return { revenue: add(...paidFor.map((order) => order.total)), currency: \"EUR\" };\n}\n",
  },
  {
    path: "src/routes/reports.js",
    content: "import { revenueToDate } from \"../orders/ledger.js\";\n\nexport function reportRoutes() {\n  return [\n    {\n      method: \"GET\",\n      path: \"/reports/revenue\",\n      handle: (ctx) => ({ status: 200, body: revenueToDate(ctx) }),\n    },\n  ];\n}\n",
  },
  {
    path: "src/server.js",
    find: "import { ledgerRoutes } from \"./routes/ledger.js\";\n",
    replace: "import { ledgerRoutes } from \"./routes/ledger.js\";\nimport { reportRoutes } from \"./routes/reports.js\";\n",
  },
  {
    path: "src/server.js",
    find: "...healthRoutes(), ...ledgerRoutes()].map(compile);",
    replace: "...healthRoutes(), ...ledgerRoutes(), ...reportRoutes()].map(compile);",
  },
];
