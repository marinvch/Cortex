const fs = require("node:fs");
const p = "tools/test/install-on-a-project.test.sh";
let s = fs.readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const a = `printf 'generator client { provider = "prisma-client-js" }\n' > prisma/schema.prisma`;
if (!s.includes(a)) throw new Error("MISS");
// A real Next.js repo carries a tsconfig and declares the Prisma runtime, not the CLI. The fixture
// has to look like one, or it stops testing what it claims to.
const b = a + `\nprintf '{ "compilerOptions": { "strict": true } }\n' > tsconfig.json`;
fs.writeFileSync(p, s.replace(a, b));
console.log("ok");
