import { test } from "node:test";
import assert from "node:assert/strict";
import { detectStack, labelsFor } from "../lib/stack.mjs";

/** Build the (files, readText) pair detectStack takes, from a literal map of path → contents. */
function repo(map) {
  const files = Object.keys(map).map((path) => ({ path }));
  return [files, (p) => (p in map ? map[p] : null)];
}

const PKG = (deps) => JSON.stringify({ name: "x", dependencies: deps });

test("detects a Next.js app with Prisma, Stripe and TypeScript", () => {
  const [files, read] = repo({
    "package.json": PKG({ next: "15", react: "19", prisma: "6", stripe: "17", typescript: "5" }),
    "prisma/schema.prisma": "generator client {}",
    "src/app/page.tsx": "",
  });
  const s = detectStack(files, read);
  assert.deepEqual(s.frameworks, ["next", "react"]);
  assert.deepEqual(s.data, ["prisma"]);
  assert.deepEqual(s.services, ["stripe"]);
  assert.deepEqual(s.languages, ["typescript"]);
});

test("a dependency name is matched as a KEY, never as a substring", () => {
  // "next-auth" contains "next". Matching loosely would report Next.js in a repo that has none, and
  // every skill chosen from that would be wrong in a way no reader can see.
  const [files, read] = repo({ "package.json": PKG({ "next-auth": "4" }) });
  const s = detectStack(files, read);
  assert.deepEqual(s.frameworks, [], "next-auth must not imply Next.js");
  assert.deepEqual(s.services, ["nextauth"]);
});

test("a dependency named only in prose does not count", () => {
  const [files, read] = repo({
    "package.json": JSON.stringify({ name: "x", description: "a react and express toolkit", dependencies: {} }),
  });
  const s = detectStack(files, read);
  assert.deepEqual(s.frameworks, [], "a description is not a dependency");
});

test("Prisma needs the schema, not just the client", () => {
  // A repo can depend on the client while someone else owns the schema. Claiming Prisma there
  // produces an /add-migration skill pointing at a schema that does not exist.
  const [noSchema] = [repo({ "package.json": PKG({ prisma: "6" }) })];
  assert.deepEqual(detectStack(...noSchema).data, [], "client without schema is not this repo's data layer");

  const withSchema = repo({ "package.json": PKG({ prisma: "6" }), "prisma/schema.prisma": "" });
  assert.deepEqual(detectStack(...withSchema).data, ["prisma"]);
});

test("a manifest with no dependency block yields an empty stack, not a crash", () => {
  const [files, read] = repo({ "package.json": "{}" });
  const s = detectStack(files, read);
  assert.deepEqual(s.frameworks, []);
  assert.deepEqual(s.manifests, ["package.json"]);
});

test("an unreadable manifest is survivable", () => {
  const files = [{ path: "package.json" }];
  const s = detectStack(files, () => null);
  assert.deepEqual(s.frameworks, []);
  assert.deepEqual(s.manifests, ["package.json"]);
});

test("nested manifests are read and reported", () => {
  // A monorepo's stack is real even with no root manifest. Reporting "none" here would look like
  // the detector never ran, which is worse than an empty stack.
  const [files, read] = repo({ "packages/api/package.json": PKG({ express: "4" }) });
  const s = detectStack(files, read);
  assert.deepEqual(s.frameworks, ["express"]);
  assert.deepEqual(s.manifests, ["packages/api/package.json"]);
});

test("python, go and rust are detected from their own manifests", () => {
  const py = repo({ "requirements.txt": "fastapi==0.110\npytest==8.0\n" });
  const pys = detectStack(...py);
  assert.deepEqual(pys.frameworks, ["fastapi"]);
  assert.deepEqual(pys.test, ["pytest"]);

  // go.mod and Cargo.toml are signals by presence — there is no dependency to name.
  assert.deepEqual(detectStack(...repo({ "go.mod": "module x" })).languages, ["go"]);
  assert.deepEqual(detectStack(...repo({ "Cargo.toml": "[package]" })).languages, ["rust"]);
});

test("a python package named as a substring of another does not match", () => {
  const [files, read] = repo({ "requirements.txt": "flask-admin==1.6\n" });
  assert.deepEqual(detectStack(files, read).frameworks, [], "flask-admin is not flask");
});

test("delivery is detected from paths alone", () => {
  const s = detectStack(...repo({ "Dockerfile": "FROM node", ".github/workflows/ci.yml": "on: push" }));
  assert.deepEqual(s.delivery, ["docker", "githubActions"]);
});

test("an empty repo detects nothing and says so honestly", () => {
  const s = detectStack([], () => null);
  assert.deepEqual(s.manifests, []);
  assert.deepEqual(s.frameworks, []);
});

test("output is stable — the same input gives byte-identical output", () => {
  // index/AGENTS.md: the index is deterministic, and build.test.mjs asserts two runs agree. Stack
  // is part of the index now, so it carries the same obligation.
  const args = repo({ "package.json": PKG({ react: "19", next: "15", vitest: "2" }) });
  assert.equal(JSON.stringify(detectStack(...args)), JSON.stringify(detectStack(...args)));
});

test("labelsFor maps ids to human names and passes unknowns through", () => {
  assert.deepEqual(labelsFor(["next", "prisma"]), ["Next.js", "Prisma"]);
  assert.deepEqual(labelsFor(["mystery"]), ["mystery"]);
});

test("a dependency declared under an alias still counts", () => {
  // `@prisma/client` is the runtime and `prisma` the CLI; a repo may carry either. Recognising only
  // one name reported no data layer for a repo that plainly has one — found by the end-to-end
  // fixture, which declared the client and not the CLI, exactly as real Next.js repos do.
  const [files, read] = repo({
    "package.json": PKG({ "@prisma/client": "6" }),
    "prisma/schema.prisma": "generator client {}",
  });
  assert.deepEqual(detectStack(files, read).data, ["prisma"]);
});

test("tsconfig.json alone proves TypeScript", () => {
  // Frameworks compile TS without the repo naming the compiler. Requiring the dependency left
  // TS repos with no type-check skill and no visible reason.
  const [files, read] = repo({ "package.json": PKG({ next: "15" }), "tsconfig.json": "{}" });
  assert.deepEqual(detectStack(files, read).languages, ["typescript"]);
});

test("a confirming file signal still requires its dependency", () => {
  // The OR added for TypeScript must not leak into Prisma: a stray schema.prisma with no dependency
  // is not this repo's data layer.
  const [files, read] = repo({ "package.json": PKG({}), "prisma/schema.prisma": "" });
  assert.deepEqual(detectStack(files, read).data, []);
});
