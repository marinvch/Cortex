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
  { id: "go", label: "Go", kind: "language", manifest: "go.mod" },
  { id: "rust", label: "Rust", kind: "language", manifest: "Cargo.toml" },

  // --- delivery ------------------------------------------------------------------------------
  { id: "docker", label: "Docker", kind: "delivery", file: /^Dockerfile$|(^|\/)Dockerfile$/ },
  { id: "githubActions", label: "GitHub Actions", kind: "delivery", file: /^\.github\/workflows\/.+\.ya?ml$/ },
];

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
  // requirements.txt / pyproject.toml / Gemfile: the name at a token boundary, case-insensitive,
  // before any version specifier.
  const esc = dep.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  return new RegExp("(^|[\\s\"'\\[,])" + esc + "($|[\\s\"'\\],=<>~!;:])", "im").test(manifestText);
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
      /(^|\/)(package\.json|go\.mod|Cargo\.toml|Gemfile|composer\.json|requirements\.txt|pyproject\.toml)$/.test(p),
    ).sort(),
  };
}

/** Human labels for a set of signal ids, for reports. */
export function labelsFor(ids) {
  const byId = new Map(SIGNALS.map((s) => [s.id, s.label]));
  return ids.map((i) => byId.get(i) || i);
}

export { SIGNALS as STACK_SIGNALS };
