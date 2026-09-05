// What this repo is built out of — runtime, frameworks, data layer, test runner, tooling.
//
// The index already knew the repo's SHAPE (files, languages, layers, imports) and nothing about its
// STACK. That gap is why `/cortex-scaffold` shipped the same two skills into every repo: a Next.js
// app with Prisma and no tests got exactly what a Rust CLI got, because nothing downstream could
// tell them apart.
//
// Deterministic, per index/AGENTS.md: manifests and file paths only. No network, no LLM, no clock.
// A dependency is a fact written in a file; inferring one from code would be a guess, and a guess
// here becomes a skill telling someone to run a command their repo does not have.

/** Every signal we look for, and the evidence that proves it. Adding a stack means adding a row. */
const SIGNALS = [
  // --- JS/TS runtime + frameworks ------------------------------------------------------------
  { id: "next", label: "Next.js", kind: "framework", dep: "next", manifest: "package.json" },
  { id: "react", label: "React", kind: "framework", dep: "react", manifest: "package.json" },
  { id: "vue", label: "Vue", kind: "framework", dep: "vue", manifest: "package.json" },
  { id: "svelte", label: "Svelte", kind: "framework", dep: "svelte", manifest: "package.json" },
  { id: "remix", label: "Remix", kind: "framework", dep: "@remix-run/react", manifest: "package.json" },
  { id: "nest", label: "NestJS", kind: "framework", dep: "@nestjs/core", manifest: "package.json" },
  { id: "express", label: "Express", kind: "framework", dep: "express", manifest: "package.json" },
  // React Native and Expo are separate rows on purpose. A bare React Native app is not an Expo app —
  // different build, different router, different commands — and collapsing them would put an `npx expo`
  // instruction in front of someone who has no expo CLI. Both matter because without them a mobile app
  // reports as plain `react`, and the skills chosen from that describe a website.
  { id: "reactNative", label: "React Native", kind: "framework", dep: "react-native", manifest: "package.json" },
  { id: "expo", label: "Expo", kind: "framework", dep: ["expo", "expo-router"], manifest: "package.json" },
  // TypeScript is asserted by tsconfig.json OR the dependency, not both. Plenty of repos compile TS
  // through a framework without naming the compiler themselves, and a repo full of .ts files told it
  // has no TypeScript gets no type-check skill for no reason a reader could see.
  { id: "typescript", label: "TypeScript", kind: "language", dep: "typescript", manifest: "package.json", file: /(^|\/)tsconfig(\.[a-z]+)?\.json$/, fileMode: "alone" },

  // --- data layer ----------------------------------------------------------------------------
  // Prisma is asserted by its schema file, not only by the dependency: the schema is where the
  // models live, and a repo can carry the client without the schema (a consumer of someone else's).
  { id: "prisma", label: "Prisma", kind: "data", dep: ["prisma", "@prisma/client"], manifest: "package.json", file: /(^|\/)schema\.prisma$/ },
  { id: "drizzle", label: "Drizzle", kind: "data", dep: "drizzle-orm", manifest: "package.json" },
  { id: "mongoose", label: "Mongoose", kind: "data", dep: "mongoose", manifest: "package.json" },
  { id: "supabase", label: "Supabase", kind: "service", dep: "@supabase/supabase-js", manifest: "package.json" },

  // --- services that carry their own invariants ------------------------------------------------
  // Stripe earns a row because webhook signature verification needs the RAW body — the single most
  // common way an agent breaks a billing integration while the code still looks correct.
  { id: "stripe", label: "Stripe", kind: "service", dep: "stripe", manifest: "package.json" },
  { id: "nextauth", label: "NextAuth", kind: "service", dep: "next-auth", manifest: "package.json" },

  // --- test runners ----------------------------------------------------------------------------
  { id: "vitest", label: "Vitest", kind: "test", dep: "vitest", manifest: "package.json" },
  { id: "jest", label: "Jest", kind: "test", dep: "jest", manifest: "package.json" },
  { id: "playwright", label: "Playwright", kind: "test", dep: "@playwright/test", manifest: "package.json" },
  { id: "cypress", label: "Cypress", kind: "test", dep: "cypress", manifest: "package.json" },

  // --- other ecosystems --------------------------------------------------------------------------
  { id: "django", label: "Django", kind: "framework", dep: "django", manifest: /^(requirements\.txt|pyproject\.toml)$/ },
  { id: "fastapi", label: "FastAPI", kind: "framework", dep: "fastapi", manifest: /^(requirements\.txt|pyproject\.toml)$/ },
  { id: "flask", label: "Flask", kind: "framework", dep: "flask", manifest: /^(requirements\.txt|pyproject\.toml)$/ },
  { id: "pytest", label: "pytest", kind: "test", dep: "pytest", manifest: /^(requirements\.txt|pyproject\.toml)$/ },
  { id: "rails", label: "Rails", kind: "framework", dep: "rails", manifest: "Gemfile" },
  { id: "laravel", label: "Laravel", kind: "framework", dep: "laravel/framework", manifest: "composer.json" },
  // Spring Boot, from the one string both build tools share. Maven writes
  // `<groupId>org.springframework.boot</groupId>`; Gradle writes `id 'org.springframework.boot'`
  // (Groovy) or `id("org.springframework.boot")` (Kotlin DSL). Keyed on the group rather than on a
  // starter artifact, because which starter a project uses varies — web, webmvc, webflux, batch —
  // and the group does not.
  { id: "spring", label: "Spring Boot", kind: "framework", dep: "org.springframework.boot", manifest: /(^|\/)(pom\.xml|build\.gradle(\.kts)?)$/ },
  // The Web SDK is what makes a .csproj an ASP.NET Core app, and it is exact. Keying on a bare
  // `AspNetCore` would fire on `Azure.Extensions.AspNetCore.Configuration.Secrets`, which is a
  // config package and not a web framework — one real repo carries exactly that line.
  { id: "aspnetcore", label: "ASP.NET Core", kind: "framework", dep: ["Microsoft.NET.Sdk.Web", "Microsoft.AspNetCore.App"], manifest: /(^|\/)[^/]+\.csproj$/ },
  { id: "phoenix", label: "Phoenix", kind: "framework", dep: "phoenix", manifest: /(^|\/)mix\.exs$/ },
  { id: "go", label: "Go", kind: "language", manifest: "go.mod" },
  // Ruby, PHP and Java had framework rows (rails, laravel) but no LANGUAGE row, so a Sinatra app and
  // a 264-file Maven project both reported no language at all. Asserted from the manifest, and for
  // Java from either build tool — a Gradle project has no pom.xml and is no less Java for it.
  { id: "python", label: "Python", kind: "language", manifest: /^(requirements\.txt|pyproject\.toml|setup\.py|setup\.cfg)$/ },
  { id: "ruby", label: "Ruby", kind: "language", manifest: "Gemfile" },
  { id: "php", label: "PHP", kind: "language", manifest: "composer.json" },
  { id: "java", label: "Java", kind: "language", manifest: /(^|\/)(pom\.xml|build\.gradle(\.kts)?)$/ },
  { id: "rust", label: "Rust", kind: "language", manifest: "Cargo.toml" },
  // The same fix in the other direction. `langs.mjs` indexes 17 languages; this table could name 7,
  // so a repo could be read correctly and described as nothing. Worse than nothing, twice, on real
  // repos: a 247-file ASP.NET Core solution reported `typescript` + `react`, because the only
  // manifest it could see was the small React client bundled inside it.
  //
  // Each of these is a manifest that means ONE language and nothing else — a `.csproj` is a C#
  // project, `mix.exs` is Mix, `Package.swift` is SwiftPM, `build.sbt` is sbt. That is the same
  // standard the rows above hold: declared, not inferred.
  { id: "csharp", label: "C#", kind: "language", manifest: /(^|\/)[^/]+\.(csproj|sln|slnx)$/ },
  { id: "elixir", label: "Elixir", kind: "language", manifest: /(^|\/)mix\.exs$/ },
  { id: "swift", label: "Swift", kind: "language", manifest: /(^|\/)Package\.swift$/ },
  { id: "scala", label: "Scala", kind: "language", manifest: /(^|\/)build\.sbt$/ },

  // --- delivery ------------------------------------------------------------------------------
  { id: "docker", label: "Docker", kind: "delivery", file: /^Dockerfile$|(^|\/)Dockerfile$/ },
  { id: "githubActions", label: "GitHub Actions", kind: "delivery", file: /^\.github\/workflows\/.+\.ya?ml$/ },
];

// --- Considered and declined ------------------------------------------------------------------
//
// A row that is NOT here is a decision, and a decision nobody wrote down gets re-litigated. Same
// reason this repo keeps ADRs. Each of the following was looked at against a real cloned repository
// and left out; the reason is the part that should stop it being re-proposed.
//
// The standard every row above meets: a manifest string that is DECLARED, that means one thing, and
// that was seen in a real project. A row that never fires is worse than an absent one, because it
// makes the table look complete.
//
// - **C and C++.** No manifest identifies either. `CMakeLists.txt` and `meson.build` say "this is a
//   C-family build" and cannot separate the two; `Makefile` appears in repos of every ecosystem.
//   They could only ever both fire or both be wrong. `langs.mjs` already counts the files by
//   extension, which is the honest answer available.
//
// - **Kotlin.** There is no Kotlin-specific manifest — it shares Gradle and Maven with Java.
//   `build.gradle.kts` is the Gradle *Kotlin DSL* and proves nothing about the source: a Java
//   project may use it, and `playframework` (Scala) does. The fallback of keying on the Kotlin
//   plugin id misses `square/okhttp` — 573 `.kt` files — which declares it through a Gradle version
//   catalog as `alias(libs.plugins.kotlin.jvm)`, with no literal id anywhere in the build file.
//
// - **Go, Rust and Scala frameworks.** Genuinely fragmented, with no dominant one to key on. For Go
//   the most common "framework" is the standard library's `net/http`; gin, echo, fiber and chi split
//   the rest. axum/actix/rocket and Play/Akka/http4s are the same shape. Picking one would report a
//   stack most repos in that language do not have.
//
// - **Swift frameworks.** SwiftUI and UIKit are imported in code and never declared in
//   `Package.swift`. Detecting them means inferring a stack from source, which is exactly what the
//   header of this file rules out — a guess here becomes a skill telling someone to run a command
//   their repo does not have.
//
// - **Data-layer rows: EF Core, JPA, Ecto.** Deliberately deferred rather than rejected. The
//   evidence exists and is worth starting from — `Include="Microsoft.EntityFrameworkCore"` in a
//   `.csproj`, `spring-boot-starter-data-jpa` in a `pom.xml`, `{:ecto_sql` in `mix.exs` — but each
//   was seen in exactly ONE repository, and EF Core has a failure mode a single sample cannot
//   settle: a project that declares only `Microsoft.EntityFrameworkCore.SqlServer` and gets the base
//   package transitively would silently miss. Partial-and-silent is the worst state a detector can
//   be in, because a repo with a data layer and no `add-migration` proposal looks exactly like a
//   repo without one. Validate against a second and third repo per ecosystem before adding these.
//
// Widening a matcher to make a row fit is the move to be most careful about. The leading-boundary
// change below was made because no dependency in an XML or Elixir manifest could match at ALL, and
// it was checked against five previously-indexed repositories that all produced a byte-identical
// stack. Compare `citationDrift` in review.mjs, where a loosening that looked harmless took this
// repo from 7 real findings to 157. Measure against real repos before and after, or do not widen.

/**
 * A dependency name appearing as a KEY in the manifest, not anywhere in its text. `"next"` occurs
 * inside `"next-auth"` and inside a hundred description strings; matching loosely reports a stack
 * the repo does not have, and the skills chosen from it would be wrong in a way nobody can see.
 */
function declaresDependency(manifestText, manifestPath, dep) {
  if (!dep) return true; // presence of the manifest is the whole signal (go.mod, Cargo.toml)
  // A stack can be declared under more than one package name — `prisma` is the CLI, `@prisma/client`
  // the runtime, and a repo may carry either or both. Any alias counts.
  if (Array.isArray(dep)) return dep.some((d) => declaresDependency(manifestText, manifestPath, d));
  if (manifestPath.endsWith(".json")) {
    // `"dep":` — a key, so a substring of another package name cannot match.
    return new RegExp('"' + dep.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&") + '"\\s*:').test(manifestText);
  }
  // requirements.txt / pyproject.toml / Gemfile / pom.xml / build.gradle / mix.exs: the name at a
  // token boundary, case-insensitive, before any version specifier.
  //
  // The LEADING side is "not an identifier character" rather than a list of the punctuation someone
  // thought of. The list was written against flat text manifests and silently could not match the
  // structured ones: Maven writes `<groupId>org.springframework.boot</groupId>` and Mix writes
  // `{:phoenix, "~> 1.8"}`, so the character before the name is `>` or `:` — neither was a boundary,
  // and no dependency in an XML or Elixir manifest could ever be found. Nothing failed; the rows
  // just never fired, which is why the table looked like it had no Java frameworks rather than like
  // it could not read one.
  //
  // The TRAILING side is left exactly as it was. It already admits `<`, `:` and the version
  // operators, which is everything the structured manifests need, and widening a side that is not
  // the problem only buys false positives. `-` and `.` are identifier characters on purpose:
  // `spring-boot-starter` must not match `spring-boot-starter-web`, and `Microsoft.AspNetCore` must
  // not match `Microsoft.AspNetCore.Diagnostics`.
  const esc = dep.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  return new RegExp("(^|[^A-Za-z0-9_.-])" + esc + "($|[\\s\"'\\],=<>~!;:])", "im").test(manifestText);
}

function matchesManifest(spec, path) {
  if (!spec) return false;
  return spec instanceof RegExp ? spec.test(path) : path === spec || path.endsWith("/" + spec);
}

/**
 * detectStack(files, readText) → { languages, frameworks, data, services, test, delivery, manifests }
 *
 * `files` is the index's file list; `readText(path)` returns that file's contents or null. Reading
 * is injected so the caller owns filesystem access and this stays a pure function of its inputs —
 * which is what lets the tests drive it from literals.
 */
export function detectStack(files, readText) {
  const paths = files.map((f) => f.path);
  const pathSet = new Set(paths);

  // Read each manifest at most once, however many signals point at it.
  const manifestCache = new Map();
  const textOf = (p) => {
    if (!manifestCache.has(p)) manifestCache.set(p, readText(p) ?? "");
    return manifestCache.get(p);
  };

  const found = new Map();
  for (const sig of SIGNALS) {
    let hit = false;

    if (sig.manifest) {
      const candidates = sig.manifest instanceof RegExp
        ? paths.filter((p) => sig.manifest.test(p))
        : paths.filter((p) => matchesManifest(sig.manifest, p));
      for (const m of candidates) {
        if (declaresDependency(textOf(m), m, sig.dep)) { hit = true; break; }
      }
    }

    // A file signal either CONFIRMS a manifest hit or stands ALONE, and which one is a property of
    // the stack rather than of the data. Prisma confirms: the dependency alone does not mean this
    // repo owns the schema, and an /add-migration skill pointing at a schema that lives in another
    // repo is worse than no skill. TypeScript stands alone: a tsconfig.json is proof by itself.
    if (sig.file) {
      const fileHit = paths.some((p) => sig.file.test(p));
      if (!sig.manifest || sig.fileMode === "alone") hit = hit || fileHit;
      else hit = sig.dep ? hit && fileHit : fileHit;
    }

    if (hit) found.set(sig.id, sig);
  }

  const by = (kind) => [...found.values()].filter((s) => s.kind === kind).map((s) => s.id).sort();

  return {
    languages: by("language"),
    frameworks: by("framework"),
    data: by("data"),
    services: by("service"),
    test: by("test"),
    delivery: by("delivery"),
    // The manifests actually present, so a downstream reader can say "no manifest found" honestly
    // rather than reporting an empty stack as though it had looked and found nothing.
    //
    // Nested ones count. The signal scan already matches `core/package.json` — listing only root
    // manifests here would report "none" for a monorepo whose stack was in fact read, which is the
    // one answer worse than an empty stack: it looks like the detector never ran.
    manifests: paths.filter((p) =>
      // Kept in step with the manifest specs above. A Maven project listing no manifests at all is
      // how this drifted: Java was detected from pom.xml while the reported list stayed empty. The
      // same omission is what made `cortex-skills` tell a Phoenix app it had "no dependency manifest
      // found, so the stack is unknown" while `mix.exs` sat in the index.
      /(^|\/)([^/]+\.(csproj|sln|slnx)|package\.json|go\.mod|Cargo\.toml|Gemfile|composer\.json|requirements\.txt|pyproject\.toml|pom\.xml|build\.gradle(\.kts)?|build\.sbt|mix\.exs|Package\.swift)$/.test(
        p,
      ),
    ).sort(),
  };
}

/** Human labels for a set of signal ids, for reports. */
export function labelsFor(ids) {
  const byId = new Map(SIGNALS.map((s) => [s.id, s.label]));
  return ids.map((i) => byId.get(i) || i);
}

export { SIGNALS as STACK_SIGNALS };
