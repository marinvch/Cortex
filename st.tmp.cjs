const fs = require("node:fs");
const p = "index/lib/stack.mjs";
let s = fs.readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const sub = (a, b) => { if (!s.includes(a)) throw new Error("MISS: " + a.slice(0, 60)); s = s.replace(a, b); };

sub(`  { id: "typescript", label: "TypeScript", kind: "language", dep: "typescript", manifest: "package.json" },`,
`  // TypeScript is asserted by tsconfig.json OR the dependency, not both: plenty of repos compile TS
  // through a framework without naming the compiler themselves, and a repo full of .ts files that is
  // told it has no TypeScript would get no type-check skill for no reason a reader could see.
  { id: "typescript", label: "TypeScript", kind: "language", dep: "typescript", manifest: "package.json", file: /(^|\/)tsconfig(\.[a-z]+)?\.json$/, fileMode: "alone" },`);

sub(`  { id: "prisma", label: "Prisma", kind: "data", dep: "prisma", manifest: "package.json", file: /(^|\/)schema\.prisma$/ },`,
`  { id: "prisma", label: "Prisma", kind: "data", dep: ["prisma", "@prisma/client"], manifest: "package.json", file: /(^|\/)schema\.prisma$/ },`);

sub(`function declaresDependency(manifestText, manifestPath, dep) {
  if (!dep) return true; // presence of the manifest is the whole signal (go.mod, Cargo.toml)`,
`function declaresDependency(manifestText, manifestPath, dep) {
  if (!dep) return true; // presence of the manifest is the whole signal (go.mod, Cargo.toml)
  // A stack can be declared under more than one package name — \`prisma\` is the CLI and
  // \`@prisma/client\` is the runtime, and a repo may carry either or both. Any alias counts.
  if (Array.isArray(dep)) return dep.some((d) => declaresDependency(manifestText, manifestPath, d));`);

sub(`    // A file signal stands alone when there is no manifest clause, and CONFIRMS one when there is.
    // Prisma is the confirming case: the dependency alone does not mean this repo owns the schema.
    if (sig.file) {
      const fileHit = paths.some((p) => sig.file.test(p));
      hit = sig.manifest ? (hit && fileHit) || (!sig.dep && fileHit) : fileHit;
    }`,
`    // A file signal either CONFIRMS a manifest hit or stands ALONE, and which one is a property of
    // the stack rather than of the data. Prisma confirms: the dependency alone does not mean this
    // repo owns the schema, and an /add-migration skill pointing at a schema that lives in another
    // repo is worse than no skill. TypeScript stands alone: tsconfig.json is proof on its own.
    if (sig.file) {
      const fileHit = paths.some((p) => sig.file.test(p));
      if (!sig.manifest || sig.fileMode === "alone") hit = hit || fileHit;
      else hit = sig.dep ? hit && fileHit : fileHit;
    }`);
fs.writeFileSync(p, s);
console.log("ok");
