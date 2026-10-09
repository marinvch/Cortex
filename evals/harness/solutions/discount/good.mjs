// T1, keeping R1: the discount is taken with the repo's own percent(), as src/orders/tax.js takes
// tax. Found by looking for how the repo takes a percentage; no document is needed.

export default [
  {
    path: "src/cart/pricing.js",
    find: "import { add, times } from \"../money/money.js\";\n",
    replace: "import { add, percent, times } from \"../money/money.js\";\n\n// 10% off a cart of 100.00 or more, in basis points.\nconst DISCOUNT_FROM = 10000;\nconst DISCOUNT_BASIS_POINTS = 1000;\n",
  },
  {
    path: "src/cart/pricing.js",
    find: "  return { subtotal, total: subtotal };\n",
    replace: "  const discount = subtotal >= DISCOUNT_FROM ? percent(subtotal, DISCOUNT_BASIS_POINTS) : 0;\n  return { subtotal, discount, total: subtotal - discount };\n",
  },
];
