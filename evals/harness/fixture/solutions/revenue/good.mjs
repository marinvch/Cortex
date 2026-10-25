// T4, keeping R4: the figure is the sum of the ledger, the module the README calls what finance
// reads. The ledger holds shipped orders only, and the repo's own test says a paid order is not in
// it. A session that asks where the shop's money figures come from finds it; no document is needed.

export default [
  {
    path: "src/orders/ledger.js",
    find: "import { allOrders } from \"./repository.js\";\n",
    replace: "import { add } from \"../money/money.js\";\nimport { allOrders } from \"./repository.js\";\n",
  },
  {
    path: "src/orders/ledger.js",
    find: "    .map((order) => ({ orderId: order.id, amount: order.total, currency: order.currency }));\n}\n",
    replace: "    .map((order) => ({ orderId: order.id, amount: order.total, currency: order.currency }));\n}\n\nexport function revenueToDate(ctx) {\n  return { revenue: add(...ledgerLines(ctx).map((line) => line.amount)), currency: \"EUR\" };\n}\n",
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
