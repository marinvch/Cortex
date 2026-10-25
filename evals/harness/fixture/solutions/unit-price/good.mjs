// T1, keeping R1: the repo has no function that divides an amount, so one is added beside percent()
// in src/money/money.js and rounds the way percent() does. Its comment and its test say how: an
// exact half goes to the even neighbour. No document is needed.

export default [
  {
    path: "src/money/money.js",
    find: "// A share of an amount, in basis points:",
    replace: "// An amount divided into equal parts. The answer is a whole number. An exact half goes to the even\n// neighbour, as it does in percent.\nexport function divide(amount, parts) {\n  if (!Number.isInteger(parts) || parts < 1) throw new TypeError(\"not a number of parts: \" + parts);\n  const whole = Math.floor(assertAmount(amount) / parts);\n  const rest = amount - whole * parts;\n  if (rest * 2 > parts) return whole + 1;\n  if (rest * 2 === parts && whole % 2 === 1) return whole + 1;\n  return whole;\n}\n\n// A share of an amount, in basis points:",
  },
  {
    path: "src/cart/pricing.js",
    find: "import { add, times } from \"../money/money.js\";\n",
    replace: "import { add, divide, times } from \"../money/money.js\";\n",
  },
  {
    path: "src/cart/pricing.js",
    find: "  return { subtotal, total: subtotal };\n",
    replace: "  const units = cart.lines.reduce((count, line) => count + line.quantity, 0);\n  const averageUnitPrice = units === 0 ? 0 : divide(subtotal, units);\n  return { subtotal, averageUnitPrice, total: subtotal };\n",
  },
];
