// T5, the control. It has no rule, so it has no naive patch: this is the one fix, and the stubbed
// dry run uses it to finish the task in both arms.

export default [
  {
    path: "src/catalog/catalog.js",
    find: "  const needle = normalise(query);\n  return ctx.db.all(\"products\").filter((product) => normalise(product.name).includes(needle)).map(view);\n",
    replace: "  const needle = query && query.trim() ? normalise(query) : \"\";\n  return ctx.db.all(\"products\")\n    .filter((product) => normalise(product.name).includes(needle))\n    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))\n    .map(view);\n",
  },
];
