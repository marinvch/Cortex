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

test("a mobile app is not reported as a website", () => {
  // Found by pointing Cortex at a real Expo app: it reported `react` and nothing else, so the skills
  // chosen from that stack described a website. React Native and Expo are separate rows because a bare
  // React Native app is not an Expo app — different build, different router, different commands.
  const [ef, er] = repo({ "package.json": PKG({ expo: "52", "expo-router": "4", "react-native": "0.76", react: "18" }) });
  const expo = detectStack(ef, er);
  assert.ok(expo.frameworks.includes("expo"), "expo is detected");
  assert.ok(expo.frameworks.includes("reactNative"), "and react-native alongside it");

  const [bf, br] = repo({ "package.json": PKG({ "react-native": "0.76", react: "18" }) });
  const bare = detectStack(bf, br);
  assert.ok(bare.frameworks.includes("reactNative"), "a bare RN app is detected");
  assert.ok(!bare.frameworks.includes("expo"), "and is NOT called an Expo app — it has no expo CLI");
});

test("python, ruby, php and java are languages, not just their frameworks", () => {
  // rails, laravel, django and flask had rows; the languages under them did not. A Sinatra app and
  // a 264-file Maven project both reported NO language, so skills chosen from that stack were generic.
  const [yf, yr] = repo({ "pyproject.toml": "[project]", "src/a.py": "" });
  assert.deepEqual(detectStack(yf, yr).languages, ["python"]);

  const [rf, rr] = repo({ Gemfile: "source 'https://rubygems.org'", "lib/app.rb": "" });
  assert.deepEqual(detectStack(rf, rr).languages, ["ruby"]);

  const [pf, pr] = repo({ "composer.json": JSON.stringify({ name: "x/y" }), "src/App.php": "" });
  assert.deepEqual(detectStack(pf, pr).languages, ["php"]);

  // Either build tool proves Java — a Gradle project has no pom.xml and is no less Java for it.
  const [mf, mr] = repo({ "pom.xml": "<project/>", "src/main/java/A.java": "" });
  assert.deepEqual(detectStack(mf, mr).languages, ["java"]);
  const [gf, gr] = repo({ "build.gradle.kts": "plugins {}", "src/main/java/A.java": "" });
  assert.deepEqual(detectStack(gf, gr).languages, ["java"]);
});

test("the reported manifest list keeps step with the manifest specs", () => {
  // These drifted: Java was detected from pom.xml while the reported list stayed empty, because the
  // list is a second regex rather than derived from SIGNALS.
  const [f, r] = repo({ "pom.xml": "<project/>", "sub/build.gradle": "", "src/main/java/A.java": "" });
  const m = detectStack(f, r).manifests;
  assert.ok(m.includes("pom.xml"), `expected pom.xml in ${JSON.stringify(m)}`);
  assert.ok(m.includes("sub/build.gradle"), `expected sub/build.gradle in ${JSON.stringify(m)}`);
});

// ---------------------------------------------------------------------------------------------
// The rows below were added because `langs.mjs` indexes 17 languages while this table could name
// 7. Every fixture here is a VERBATIM line from a real cloned repository, named in the comment,
// because a stack row is a claim about what real projects look like on disk and a fixture I write
// myself agrees with whatever I already believed. Two of these rows could not have been written
// from a fixture at all — see "the boundary" test.
// ---------------------------------------------------------------------------------------------

test("Spring Boot, from Maven — the line spring-petclinic actually carries", () => {
  const [files, read] = repo({
    "pom.xml": `<project>\n  <parent>\n    <groupId>org.springframework.boot</groupId>\n    <artifactId>spring-boot-starter-parent</artifactId>\n  </parent>\n</project>`,
    "src/main/java/org/springframework/samples/petclinic/PetClinicApplication.java": "",
  });
  const s = detectStack(files, read);
  assert.deepEqual(s.frameworks, ["spring"]);
  assert.deepEqual(s.languages, ["java"], "and it is still Java — the framework row does not replace the language row");
});

test("Spring Boot, from both Gradle DSLs — spring-guides/gs-spring-boot carries both", () => {
  // Groovy: id 'org.springframework.boot' version '4.0.8'
  const groovy = detectStack(...repo({ "build.gradle": `plugins {\n  id 'org.springframework.boot' version '4.0.8'\n}` }));
  assert.deepEqual(groovy.frameworks, ["spring"]);
  // Kotlin DSL: id("org.springframework.boot") version "4.0.1"
  const kts = detectStack(...repo({ "build.gradle.kts": `plugins {\n  id("org.springframework.boot") version "4.0.1"\n  kotlin("jvm") version "2.2.21"\n}` }));
  assert.deepEqual(kts.frameworks, ["spring"]);
});

test("a Gradle build with no Spring in it stays a framework-less Java repo", () => {
  const s = detectStack(...repo({ "build.gradle.kts": `plugins {\n  id("java-library")\n}` }));
  assert.deepEqual(s.languages, ["java"]);
  assert.deepEqual(s.frameworks, [], "a row that fires on every Gradle project would be worse than no row");
});

test("ASP.NET Core, from the Web SDK — and NOT from an Azure package that merely says AspNetCore", () => {
  // Both lines are verbatim from jasontaylordev/CleanArchitecture. The second is the trap: keying
  // on a bare `AspNetCore` reports a web framework for a configuration package.
  const web = detectStack(...repo({
    "src/Web/Web.csproj": `<Project Sdk="Microsoft.NET.Sdk.Web">\n  <ItemGroup>\n    <PackageReference Include="Microsoft.AspNetCore.OpenApi" />\n  </ItemGroup>\n</Project>`,
  }));
  assert.deepEqual(web.languages, ["csharp"]);
  assert.deepEqual(web.frameworks, ["aspnetcore"]);

  const lib = detectStack(...repo({
    "src/Infrastructure/Infrastructure.csproj": `<Project Sdk="Microsoft.NET.Sdk">\n  <ItemGroup>\n    <PackageReference Include="Azure.Extensions.AspNetCore.Configuration.Secrets" />\n  </ItemGroup>\n</Project>`,
  }));
  assert.deepEqual(lib.languages, ["csharp"], "a class library is still C#");
  assert.deepEqual(lib.frameworks, [], "but it is not an ASP.NET Core app");
});

test("a C# solution is not reported as the small React app bundled inside it", () => {
  // The real misreport, on a 247-file repo: the only manifest this table could see was
  // src/Web/ClientApp/package.json, so a .NET solution came back as `typescript` + `react`.
  // C# must appear; React may too, because it genuinely is in there.
  const [files, read] = repo({
    "CleanArchitecture.slnx": "<Solution />",
    "src/Domain/Domain.csproj": `<Project Sdk="Microsoft.NET.Sdk"></Project>`,
    "src/Web/ClientApp/package.json": PKG({ react: "19", typescript: "5" }),
  });
  const s = detectStack(files, read);
  assert.ok(s.languages.includes("csharp"), "the language the repo is actually written in");
  assert.ok(s.languages.includes("typescript"), "and the one it also contains");
});

test("Elixir and Phoenix, from mix.exs — dwyl/phoenix-chat-example", () => {
  const [files, read] = repo({
    "mix.exs": `  defp deps do\n    [\n      {:phoenix, "~> 1.8.1", override: true},\n      {:phoenix_ecto, "~> 4.4"},\n      {:postgrex, ">= 0.0.0"}\n    ]\n  end`,
    "lib/app_web/router.ex": "",
  });
  const s = detectStack(files, read);
  assert.deepEqual(s.languages, ["elixir"]);
  assert.deepEqual(s.frameworks, ["phoenix"]);
  assert.ok(s.manifests.includes("mix.exs"), "and mix.exs counts as a manifest, or the repo is told its stack is unknowable");
});

test("a plain Mix project is Elixir with no framework", () => {
  const s = detectStack(...repo({ "mix.exs": `  defp deps do\n    [{:jason, "~> 1.4"}]\n  end` }));
  assert.deepEqual(s.languages, ["elixir"]);
  assert.deepEqual(s.frameworks, []);
});

test("Swift from Package.swift, Scala from build.sbt", () => {
  const sw = detectStack(...repo({ "Package.swift": "// swift-tools-version:6.0\nimport PackageDescription\n" }));
  assert.deepEqual(sw.languages, ["swift"]);
  assert.ok(sw.manifests.includes("Package.swift"));

  // playframework/playframework: a build.sbt at the root, and Java files alongside the Scala.
  const sc = detectStack(...repo({ "build.sbt": "import java.io.StringWriter\n", "build.gradle.kts": "" }));
  assert.ok(sc.languages.includes("scala"));
  assert.ok(sc.languages.includes("java"), "a repo can be both, and reporting only one was the bug");
});

test("the boundary is 'not an identifier character', which is what makes a structured manifest readable", () => {
  // Neither of these could match before, and neither failed — the rows simply never fired, so the
  // table looked as though it had no Java frameworks rather than as though it could not read one.
  // Maven puts `>` before the name; Mix puts `:`. The old rule listed [\s"'\[,] and neither is in it.
  assert.deepEqual(detectStack(...repo({ "pom.xml": "<groupId>org.springframework.boot</groupId>" })).frameworks, ["spring"]);
  assert.deepEqual(detectStack(...repo({ "mix.exs": "{:phoenix, \"~> 1.8\"}" })).frameworks, ["phoenix"]);

  // And the identifier characters still hold the line. `-` and `.` are part of a name, so a longer
  // artifact is a DIFFERENT artifact.
  assert.deepEqual(
    detectStack(...repo({ "pom.xml": "<artifactId>org.springframework.bootstrapper</artifactId>" })).frameworks,
    [],
    "a longer name that merely starts with the key is not the key",
  );
  assert.deepEqual(
    detectStack(...repo({ "mix.exs": "{:phoenix_live_view, \"~> 1.0\"}" })).frameworks,
    [],
    "phoenix_live_view is not phoenix",
  );
});
