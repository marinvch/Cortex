// T1, breaking R1: the average is a float division rounded half up. It is right wherever the
// subtotal divides evenly and one minor unit off wherever the division ends in a half.

export default [
  {
    path: "src/cart/pricing.js",
    find: "  return { subtotal, total: subtotal };\n",
    replace: "  const units = cart.lines.reduce((count, line) => count + line.quantity, 0);\n  const averageUnitPrice = units === 0 ? 0 : Math.round(subtotal / units);\n  return { subtotal, averageUnitPrice, total: subtotal };\n",
  },
];
