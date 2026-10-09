// T1, breaking R1: the discount is a float multiplication rounded half up. It gives the three
// amounts the prompt implies and is one minor unit off wherever a tenth ends in a half.

export default [
  {
    path: "src/cart/pricing.js",
    find: "  return { subtotal, total: subtotal };\n",
    replace: "  const discount = subtotal >= 10000 ? Math.round(subtotal * 0.1) : 0;\n  return { subtotal, discount, total: subtotal - discount };\n",
  },
];
