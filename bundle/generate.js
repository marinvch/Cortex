#!/usr/bin/env node

// src/generate.ts
import fs15 from "node:fs";
import path17 from "node:path";

// src/analyze.ts
import fs4 from "node:fs";
import path4 from "node:path";

// src/detectors/language.ts
import fs from "node:fs";
import path from "node:path";
var EXTENSION_MAP = {
  ts: "TypeScript",
  tsx: "TypeScript",
  mts: "TypeScript",
  cts: "TypeScript",
  js: "JavaScript",
  jsx: "JavaScript",
  mjs: "JavaScript",
  cjs: "JavaScript",
  py: "Python",
  pyi: "Python",
  go: "Go",
  rs: "Rust",
  java: "Java",
  kt: "Kotlin",
  kts: "Kotlin",
  cs: "C#",
  vb: "Visual Basic",
  cpp: "C++",
  cc: "C++",
  cxx: "C++",
  hpp: "C++",
  h: "C/C++",
  c: "C",
  rb: "Ruby",
  php: "PHP",
  swift: "Swift",
  scala: "Scala",
  ex: "Elixir",
  exs: "Elixir",
  clj: "Clojure",
  cljs: "Clojure",
  hs: "Haskell",
  ml: "OCaml",
  mli: "OCaml",
  dart: "Dart",
  lua: "Lua",
  r: "R",
  jl: "Julia",
  sh: "Shell",
  bash: "Shell",
  zsh: "Shell",
  ps1: "PowerShell",
  sql: "SQL",
  css: "CSS",
  scss: "SCSS",
  sass: "SASS",
  less: "LESS",
  html: "HTML",
  htm: "HTML",
  vue: "Vue",
  svelte: "Svelte",
  astro: "Astro",
  tf: "Terraform",
  tfvars: "Terraform",
  yaml: "YAML",
  yml: "YAML",
  json: "JSON",
  jsonc: "JSON",
  toml: "TOML",
  md: "Markdown",
  mdx: "Markdown"
};
var IGNORE_DIRS = /* @__PURE__ */ new Set([
  "node_modules",
  ".git",
  ".next",
  ".nuxt",
  "dist",
  "build",
  "out",
  "__pycache__",
  ".venv",
  "venv",
  "env",
  ".env",
  "target",
  "vendor",
  ".gradle",
  ".mvn",
  "coverage",
  ".nyc_output",
  ".cache",
  ".parcel-cache",
  "bin",
  "obj",
  ".vs",
  "packages",
  ".github"
  // GitHub config/Actions/AI OS artifacts — not project source code
]);
function walkDir(dir, depth = 0, maxDepth = 6) {
  if (depth > maxDepth) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    if (IGNORE_DIRS.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkDir(fullPath, depth + 1, maxDepth));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}
function detectLanguages(rootDir) {
  const files = walkDir(rootDir);
  const counts = {};
  for (const file of files) {
    const ext = path.extname(file).slice(1).toLowerCase();
    if (!ext) continue;
    const lang = EXTENSION_MAP[ext];
    if (!lang) continue;
    if (!counts[lang]) counts[lang] = { count: 0, extensions: /* @__PURE__ */ new Set() };
    counts[lang].count++;
    counts[lang].extensions.add(ext);
  }
  const total = Object.values(counts).reduce((sum, v) => sum + v.count, 0) || 1;
  return Object.entries(counts).map(([name, { count, extensions }]) => ({
    name,
    fileCount: count,
    percentage: Math.round(count / total * 100),
    extensions: [...extensions]
  })).sort((a, b) => b.fileCount - a.fileCount);
}

// src/detectors/framework.ts
import fs2 from "node:fs";
import path2 from "node:path";
function readJson(filePath) {
  try {
    return JSON.parse(fs2.readFileSync(filePath, "utf-8"));
  } catch {
    return null;
  }
}
function readFile(filePath) {
  try {
    return fs2.readFileSync(filePath, "utf-8");
  } catch {
    return "";
  }
}
function allDeps(pkg) {
  return { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies };
}
function detectFromPackageJson(rootDir) {
  const pkgPath = path2.join(rootDir, "package.json");
  const pkg = readJson(pkgPath);
  if (!pkg) return [];
  const deps = allDeps(pkg);
  const frameworks = [];
  if (deps["next"]) {
    frameworks.push({ name: "Next.js", category: "fullstack", version: deps["next"], template: "nextjs" });
  } else if (deps["@remix-run/react"] || deps["@remix-run/node"]) {
    const version = deps["@remix-run/react"] ?? deps["@remix-run/node"];
    frameworks.push({ name: "Remix", category: "fullstack", version, template: "remix" });
  } else if (deps["@nuxt/core"] || deps["nuxt"]) {
    frameworks.push({ name: "Nuxt.js", category: "fullstack", version: deps["nuxt"], template: "nuxt" });
  } else if (deps["react"]) {
    if (deps["vite"] || deps["@vitejs/plugin-react"]) {
      frameworks.push({ name: "React (Vite)", category: "frontend", version: deps["react"], template: "react" });
    } else {
      frameworks.push({ name: "React", category: "frontend", version: deps["react"], template: "react" });
    }
  } else if (deps["solid-js"]) {
    frameworks.push({ name: "SolidJS", category: "frontend", version: deps["solid-js"], template: "solid" });
  } else if (deps["vue"]) {
    frameworks.push({ name: "Vue.js", category: "frontend", version: deps["vue"], template: "vue" });
  } else if (deps["svelte"]) {
    frameworks.push({ name: "Svelte", category: "frontend", template: "svelte" });
  } else if (deps["@angular/core"]) {
    frameworks.push({ name: "Angular", category: "frontend", version: deps["@angular/core"], template: "angular" });
  } else if (deps["astro"]) {
    frameworks.push({ name: "Astro", category: "fullstack", version: deps["astro"], template: "astro" });
  } else if (deps["@remix-run/react"] || deps["@remix-run/node"]) {
    const version = deps["@remix-run/react"] ?? deps["@remix-run/node"];
    frameworks.push({ name: "Remix", category: "fullstack", version, template: "remix" });
  } else if (deps["solid-js"]) {
    frameworks.push({ name: "SolidJS", category: "frontend", version: deps["solid-js"], template: "solid" });
  }
  if (deps["@nestjs/core"]) {
    frameworks.push({ name: "NestJS", category: "backend", version: deps["@nestjs/core"], template: "nestjs" });
  } else if (deps["express"]) {
    frameworks.push({ name: "Express", category: "backend", version: deps["express"], template: "express" });
  } else if (deps["fastify"]) {
    frameworks.push({ name: "Fastify", category: "backend", version: deps["fastify"], template: "express" });
  } else if (deps["hono"]) {
    frameworks.push({ name: "Hono", category: "backend", version: deps["hono"], template: "express" });
  } else if (deps["koa"]) {
    frameworks.push({ name: "Koa", category: "backend", version: deps["koa"], template: "express" });
  }
  if (deps["@trpc/server"]) {
    frameworks.push({ name: "tRPC", category: "backend", template: "trpc" });
  }
  if (deps["prisma"] || deps["@prisma/client"]) {
    frameworks.push({ name: "Prisma", category: "backend", template: "prisma" });
  }
  if (deps["drizzle-orm"]) {
    frameworks.push({ name: "Drizzle ORM", category: "backend", template: "drizzle" });
  }
  if (deps["react-native"]) {
    frameworks.push({ name: "React Native", category: "mobile", version: deps["react-native"], template: "react-native" });
  } else if (deps["expo"]) {
    frameworks.push({ name: "Expo", category: "mobile", version: deps["expo"], template: "expo" });
  }
  return frameworks;
}
function detectFromPython(rootDir) {
  const files = ["requirements.txt", "pyproject.toml", "Pipfile", "setup.py", "setup.cfg"];
  const content = files.map((f) => readFile(path2.join(rootDir, f))).join("\n").toLowerCase();
  if (!content) return [];
  const frameworks = [];
  if (content.includes("django")) {
    frameworks.push({ name: "Django", category: "fullstack", template: "python-django" });
  } else if (content.includes("fastapi")) {
    frameworks.push({ name: "FastAPI", category: "backend", template: "python-fastapi" });
  } else if (content.includes("flask")) {
    frameworks.push({ name: "Flask", category: "backend", template: "python-fastapi" });
  } else if (content.includes("starlette")) {
    frameworks.push({ name: "Starlette", category: "backend", template: "python-fastapi" });
  }
  return frameworks;
}
function detectFromGo(rootDir) {
  const goMod = readFile(path2.join(rootDir, "go.mod"));
  if (!goMod) return [];
  const frameworks = [];
  if (goMod.includes("gin-gonic/gin")) {
    frameworks.push({ name: "Gin", category: "backend", template: "go" });
  } else if (goMod.includes("labstack/echo")) {
    frameworks.push({ name: "Echo", category: "backend", template: "go" });
  } else if (goMod.includes("gofiber/fiber")) {
    frameworks.push({ name: "Fiber", category: "backend", template: "go" });
  } else if (goMod.includes("go-chi/chi")) {
    frameworks.push({ name: "Chi", category: "backend", template: "go" });
  } else {
    frameworks.push({ name: "Go", category: "backend", template: "go" });
  }
  return frameworks;
}
function detectFromRust(rootDir) {
  const cargo = readFile(path2.join(rootDir, "Cargo.toml"));
  if (!cargo) return [];
  const frameworks = [];
  if (cargo.includes("actix-web")) {
    frameworks.push({ name: "Actix Web", category: "backend", template: "rust" });
  } else if (cargo.includes("axum")) {
    frameworks.push({ name: "Axum", category: "backend", template: "rust" });
  } else if (cargo.includes("rocket")) {
    frameworks.push({ name: "Rocket", category: "backend", template: "rust" });
  } else {
    frameworks.push({ name: "Rust", category: "backend", template: "rust" });
  }
  return frameworks;
}
function detectFromJava(rootDir) {
  const pomXml = readFile(path2.join(rootDir, "pom.xml"));
  const buildGradle = readFile(path2.join(rootDir, "build.gradle")) + readFile(path2.join(rootDir, "build.gradle.kts"));
  const content = pomXml + buildGradle;
  if (!content) return [];
  if (content.includes("spring-boot") || content.includes("spring-boot-starter")) {
    return [{ name: "Spring Boot", category: "backend", template: "java-spring" }];
  } else if (content.includes("quarkus")) {
    return [{ name: "Quarkus", category: "backend", template: "java-spring" }];
  } else if (content.includes("micronaut")) {
    return [{ name: "Micronaut", category: "backend", template: "java-spring" }];
  }
  if (content) return [{ name: "Java", category: "backend", template: "java-spring" }];
  return [];
}
function detectFromDotnet(rootDir) {
  const entries = fs2.readdirSync(rootDir);
  const csproj = entries.find((e) => e.endsWith(".csproj"));
  const sln = entries.find((e) => e.endsWith(".sln"));
  if (!csproj && !sln) return [];
  const csprojContent = csproj ? readFile(path2.join(rootDir, csproj)).toLowerCase() : "";
  if (csprojContent.includes("aspnetcore") || csprojContent.includes("web")) {
    return [{ name: "ASP.NET Core", category: "backend", template: "dotnet" }];
  }
  return [{ name: ".NET", category: "backend", template: "dotnet" }];
}
function detectFromRuby(rootDir) {
  const gemfile = readFile(path2.join(rootDir, "Gemfile")).toLowerCase();
  if (!gemfile) return [];
  if (gemfile.includes("rails")) {
    return [{ name: "Ruby on Rails", category: "fullstack", template: "ruby-rails" }];
  } else if (gemfile.includes("sinatra")) {
    return [{ name: "Sinatra", category: "backend", template: "ruby-rails" }];
  }
  return [{ name: "Ruby", category: "backend", template: "ruby-rails" }];
}
function detectFromBun(rootDir) {
  if (!fs2.existsSync(path2.join(rootDir, "bun.lockb"))) return [];
  return [{ name: "Bun", category: "backend", template: "bun" }];
}
function detectFromDeno(rootDir) {
  const hasDenoJson = fs2.existsSync(path2.join(rootDir, "deno.json")) || fs2.existsSync(path2.join(rootDir, "deno.jsonc"));
  if (!hasDenoJson) return [];
  return [{ name: "Deno", category: "backend", template: "deno" }];
}
function detectFromPhp(rootDir) {
  const composer = readJson(path2.join(rootDir, "composer.json"));
  if (!composer) return [];
  const reqs = { ...composer.require };
  if (reqs["laravel/framework"]) {
    return [{ name: "Laravel", category: "fullstack", template: "php-laravel" }];
  } else if (reqs["symfony/symfony"] || reqs["symfony/framework-bundle"]) {
    return [{ name: "Symfony", category: "backend", template: "php-laravel" }];
  } else if (reqs["slim/slim"]) {
    return [{ name: "Slim", category: "backend", template: "php-laravel" }];
  }
  return [{ name: "PHP", category: "backend", template: "php-laravel" }];
}
function detectBun(rootDir) {
  if (fs2.existsSync(path2.join(rootDir, "bun.lockb"))) {
    return [{ name: "Bun", category: "backend", template: "bun" }];
  }
  const pkg = readJson(path2.join(rootDir, "package.json"));
  if (pkg?.packageManager?.startsWith("bun")) {
    return [{ name: "Bun", category: "backend", template: "bun" }];
  }
  return [];
}
function detectDeno(rootDir) {
  const denoFiles = ["deno.json", "deno.jsonc", "deno.lock", "import_map.json"];
  if (denoFiles.some((f) => fs2.existsSync(path2.join(rootDir, f)))) {
    return [{ name: "Deno", category: "backend", template: "deno" }];
  }
  return [];
}
function detectFrameworks(rootDir) {
  const frameworks = [
    ...detectFromPackageJson(rootDir),
    ...detectFromBun(rootDir),
    ...detectFromDeno(rootDir),
    ...detectFromPython(rootDir),
    ...detectFromGo(rootDir),
    ...detectFromRust(rootDir),
    ...detectFromJava(rootDir),
    ...detectFromDotnet(rootDir),
    ...detectFromRuby(rootDir),
    ...detectFromPhp(rootDir),
    ...detectBun(rootDir),
    ...detectDeno(rootDir)
  ];
  const seen = /* @__PURE__ */ new Set();
  return frameworks.filter((f) => {
    if (seen.has(f.name)) return false;
    seen.add(f.name);
    return true;
  });
}

// src/detectors/patterns.ts
import fs3 from "node:fs";
import path3 from "node:path";
function exists(p) {
  return fs3.existsSync(p);
}
function readJson2(filePath) {
  try {
    return JSON.parse(fs3.readFileSync(filePath, "utf-8"));
  } catch {
    return null;
  }
}
function detectPackageManager(rootDir) {
  if (exists(path3.join(rootDir, "bun.lockb"))) return "bun";
  if (exists(path3.join(rootDir, "pnpm-lock.yaml"))) return "pnpm";
  if (exists(path3.join(rootDir, "yarn.lock"))) return "yarn";
  if (exists(path3.join(rootDir, "package-lock.json"))) return "npm";
  if (exists(path3.join(rootDir, "Cargo.lock")) || exists(path3.join(rootDir, "Cargo.toml"))) return "cargo";
  if (exists(path3.join(rootDir, "go.sum")) || exists(path3.join(rootDir, "go.mod"))) return "go";
  if (exists(path3.join(rootDir, "Pipfile.lock"))) return "pip";
  if (exists(path3.join(rootDir, "poetry.lock"))) return "poetry";
  if (exists(path3.join(rootDir, "pom.xml"))) return "maven";
  if (exists(path3.join(rootDir, "build.gradle")) || exists(path3.join(rootDir, "build.gradle.kts"))) return "gradle";
  if (exists(path3.join(rootDir, "composer.lock"))) return "composer";
  if (exists(path3.join(rootDir, "Gemfile.lock"))) return "bundler";
  return "unknown";
}
function detectTestFramework(rootDir) {
  const pkg = readJson2(
    path3.join(rootDir, "package.json")
  );
  if (pkg) {
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    if (deps["vitest"]) return "Vitest";
    if (deps["jest"]) return "Jest";
    if (deps["mocha"]) return "Mocha";
    if (deps["jasmine"]) return "Jasmine";
    if (deps["@playwright/test"]) return "Playwright";
    if (deps["cypress"]) return "Cypress";
  }
  if (exists(path3.join(rootDir, "pytest.ini")) || exists(path3.join(rootDir, "conftest.py"))) return "pytest";
  if (exists(path3.join(rootDir, "phpunit.xml")) || exists(path3.join(rootDir, "phpunit.xml.dist"))) return "PHPUnit";
  if (exists(path3.join(rootDir, "RSpec"))) return "RSpec";
  return void 0;
}
function detectLinter(rootDir) {
  if (exists(path3.join(rootDir, ".eslintrc.json")) || exists(path3.join(rootDir, ".eslintrc.js")) || exists(path3.join(rootDir, ".eslintrc.cjs")) || exists(path3.join(rootDir, "eslint.config.js")) || exists(path3.join(rootDir, "eslint.config.mjs"))) return "ESLint";
  if (exists(path3.join(rootDir, ".biome.json")) || exists(path3.join(rootDir, "biome.json"))) return "Biome";
  if (exists(path3.join(rootDir, ".oxlintrc.json"))) return "oxlint";
  if (exists(path3.join(rootDir, "pylintrc")) || exists(path3.join(rootDir, ".pylintrc"))) return "Pylint";
  if (exists(path3.join(rootDir, ".flake8")) || exists(path3.join(rootDir, "setup.cfg"))) return "Flake8";
  if (exists(path3.join(rootDir, "clippy.toml")) || exists(path3.join(rootDir, ".clippy.toml"))) return "Clippy";
  if (exists(path3.join(rootDir, ".golangci.yml")) || exists(path3.join(rootDir, ".golangci.yaml"))) return "golangci-lint";
  return void 0;
}
function detectFormatter(rootDir) {
  if (exists(path3.join(rootDir, ".prettierrc")) || exists(path3.join(rootDir, ".prettierrc.json")) || exists(path3.join(rootDir, ".prettierrc.js")) || exists(path3.join(rootDir, "prettier.config.js"))) return "Prettier";
  if (exists(path3.join(rootDir, ".biome.json")) || exists(path3.join(rootDir, "biome.json"))) return "Biome";
  if (exists(path3.join(rootDir, ".editorconfig"))) return "EditorConfig";
  if (exists(path3.join(rootDir, ".rustfmt.toml"))) return "rustfmt";
  if (exists(path3.join(rootDir, ".gofmt"))) return "gofmt";
  return void 0;
}
function detectBundler(rootDir) {
  const pkg = readJson2(path3.join(rootDir, "package.json"));
  if (pkg?.devDependencies) {
    const deps = pkg.devDependencies;
    if (deps["vite"]) return "Vite";
    if (deps["turbopack"] || deps["@next/swc-darwin-x64"]) return "Turbopack";
    if (deps["webpack"] || deps["webpack-cli"]) return "Webpack";
    if (deps["esbuild"]) return "esbuild";
    if (deps["rollup"]) return "Rollup";
    if (deps["parcel"]) return "Parcel";
    if (deps["@swc/core"]) return "SWC";
  }
  if (exists(path3.join(rootDir, "vite.config.ts")) || exists(path3.join(rootDir, "vite.config.js"))) return "Vite";
  if (exists(path3.join(rootDir, "webpack.config.js")) || exists(path3.join(rootDir, "webpack.config.ts"))) return "Webpack";
  return void 0;
}
function detectCiCd(rootDir) {
  if (exists(path3.join(rootDir, ".github", "workflows"))) return { hasCiCd: true, provider: "GitHub Actions" };
  if (exists(path3.join(rootDir, ".gitlab-ci.yml"))) return { hasCiCd: true, provider: "GitLab CI" };
  if (exists(path3.join(rootDir, ".circleci", "config.yml"))) return { hasCiCd: true, provider: "CircleCI" };
  if (exists(path3.join(rootDir, "Jenkinsfile"))) return { hasCiCd: true, provider: "Jenkins" };
  if (exists(path3.join(rootDir, ".travis.yml"))) return { hasCiCd: true, provider: "Travis CI" };
  if (exists(path3.join(rootDir, "azure-pipelines.yml"))) return { hasCiCd: true, provider: "Azure Pipelines" };
  if (exists(path3.join(rootDir, "bitbucket-pipelines.yml"))) return { hasCiCd: true, provider: "Bitbucket Pipelines" };
  return { hasCiCd: false };
}
function detectNamingConvention(rootDir) {
  const srcDir = exists(path3.join(rootDir, "src")) ? path3.join(rootDir, "src") : rootDir;
  try {
    const entries = fs3.readdirSync(srcDir);
    const tsxFiles = entries.filter((e) => e.endsWith(".tsx") || e.endsWith(".jsx"));
    const pyFiles = entries.filter((e) => e.endsWith(".py"));
    if (tsxFiles.some((f) => /^[A-Z]/.test(f))) return "PascalCase";
    if (pyFiles.some((f) => /_/.test(f))) return "snake_case";
    if (entries.some((f) => /-/.test(f) && !f.startsWith("."))) return "kebab-case";
    if (entries.some((f) => /[A-Z]/.test(f.replace(/\.[^.]+$/, "")))) return "camelCase";
  } catch {
  }
  return "mixed";
}
function detectPatterns(rootDir) {
  const { hasCiCd, provider: ciCdProvider } = detectCiCd(rootDir);
  const pkg = readJson2(path3.join(rootDir, "package.json"));
  const hasTypeScript = exists(path3.join(rootDir, "tsconfig.json")) || Object.keys(pkg?.devDependencies ?? {}).includes("typescript");
  const testDirs = ["__tests__", "tests", "test", "spec", "__spec__"];
  const testDirectory = testDirs.find((d) => exists(path3.join(rootDir, d)));
  return {
    namingConvention: detectNamingConvention(rootDir),
    testFramework: detectTestFramework(rootDir),
    linter: detectLinter(rootDir),
    formatter: detectFormatter(rootDir),
    bundler: detectBundler(rootDir),
    packageManager: detectPackageManager(rootDir),
    hasTypeScript,
    hasDockerfile: exists(path3.join(rootDir, "Dockerfile")) || exists(path3.join(rootDir, "docker-compose.yml")),
    hasCiCd,
    ciCdProvider,
    monorepo: exists(path3.join(rootDir, "pnpm-workspace.yaml")) || exists(path3.join(rootDir, "lerna.json")) || exists(path3.join(rootDir, "nx.json")) || exists(path3.join(rootDir, "turbo.json")),
    srcDirectory: exists(path3.join(rootDir, "src")),
    testDirectory
  };
}

// src/analyze.ts
function getProjectName(rootDir) {
  try {
    const pkg = JSON.parse(fs4.readFileSync(path4.join(rootDir, "package.json"), "utf-8"));
    if (pkg.name) return pkg.name.replace(/^@[^/]+\//, "");
  } catch {
  }
  try {
    const goMod = fs4.readFileSync(path4.join(rootDir, "go.mod"), "utf-8");
    const match = goMod.match(/^module\s+(\S+)/m);
    if (match) return match[1].split("/").pop() ?? path4.basename(rootDir);
  } catch {
  }
  try {
    const cargo = fs4.readFileSync(path4.join(rootDir, "Cargo.toml"), "utf-8");
    const match = cargo.match(/^name\s*=\s*"([^"]+)"/m);
    if (match) return match[1];
  } catch {
  }
  return path4.basename(rootDir);
}
function getKeyFiles(rootDir) {
  const candidates = [
    "README.md",
    "package.json",
    "go.mod",
    "Cargo.toml",
    "pyproject.toml",
    "requirements.txt",
    "pom.xml",
    "build.gradle",
    "composer.json",
    "Gemfile",
    "prisma/schema.prisma",
    "src/index.ts",
    "src/main.ts",
    "src/app.ts",
    "src/index.js",
    "src/main.js",
    "src/app.js",
    "main.go",
    "main.py",
    "main.rs",
    "app.py",
    "index.py",
    "docker-compose.yml",
    "Dockerfile"
  ];
  return candidates.map((c) => path4.join(rootDir, c)).filter((p) => fs4.existsSync(p)).map((p) => path4.relative(rootDir, p));
}
function getAllDependencies(rootDir) {
  const deps = /* @__PURE__ */ new Set();
  try {
    const pkg = JSON.parse(fs4.readFileSync(path4.join(rootDir, "package.json"), "utf-8"));
    for (const key of Object.keys({ ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies })) {
      deps.add(key.toLowerCase());
    }
  } catch {
  }
  try {
    const req = fs4.readFileSync(path4.join(rootDir, "requirements.txt"), "utf-8");
    req.split("\n").forEach((line) => {
      const pkg = line.split(/[>=<!;\s]/)[0]?.trim().toLowerCase();
      if (pkg) deps.add(pkg);
    });
  } catch {
  }
  try {
    const cargo = fs4.readFileSync(path4.join(rootDir, "Cargo.toml"), "utf-8");
    const depSection = cargo.match(/\[dependencies\]([\s\S]*?)(\[|\Z)/)?.[1] ?? "";
    depSection.split("\n").forEach((line) => {
      const m = line.match(/^(\w[\w-]*)\s*=/);
      if (m) deps.add(m[1].toLowerCase());
    });
  } catch {
  }
  return [...deps];
}
function hasManifest(dir) {
  const manifests = [
    "package.json",
    "pyproject.toml",
    "requirements.txt",
    "go.mod",
    "Cargo.toml",
    "pom.xml",
    "build.gradle",
    "build.gradle.kts"
  ];
  return manifests.some((manifest) => fs4.existsSync(path4.join(dir, manifest)));
}
function parsePnpmWorkspaceYaml(yaml) {
  const globs = [];
  let inPackages = false;
  for (const line of yaml.split("\n")) {
    const trimmed = line.trim();
    if (/^packages\s*:/.test(trimmed)) {
      inPackages = true;
      continue;
    }
    if (inPackages) {
      if (trimmed && !line.startsWith(" ") && !line.startsWith("	")) {
        break;
      }
      if (trimmed.startsWith("-")) {
        let pattern = trimmed.slice(1).trim();
        if (pattern.startsWith("'") && pattern.endsWith("'") || pattern.startsWith('"') && pattern.endsWith('"')) {
          pattern = pattern.slice(1, -1);
        }
        if (pattern) globs.push(pattern);
      }
    }
  }
  return globs;
}
function addWorkspaceChildren(absBase, packageRoots) {
  if (!fs4.existsSync(absBase) || !fs4.statSync(absBase).isDirectory()) return;
  for (const entry of fs4.readdirSync(absBase, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const candidate = path4.join(absBase, entry.name);
    if (hasManifest(candidate)) packageRoots.add(candidate);
  }
}
function discoverPackageRoots(rootDir) {
  const packageRoots = /* @__PURE__ */ new Set();
  if (hasManifest(rootDir)) {
    packageRoots.add(rootDir);
  }
  try {
    const pnpmWs = fs4.readFileSync(path4.join(rootDir, "pnpm-workspace.yaml"), "utf-8");
    for (const glob of parsePnpmWorkspaceYaml(pnpmWs)) {
      const normalized = glob.replace(/\\/g, "/").replace(/\/\*\*$/, "").replace(/\/\*$/, "");
      const absBase = path4.join(rootDir, normalized);
      if (hasManifest(absBase)) packageRoots.add(absBase);
      addWorkspaceChildren(absBase, packageRoots);
    }
  } catch {
  }
  try {
    const lerna = JSON.parse(fs4.readFileSync(path4.join(rootDir, "lerna.json"), "utf-8"));
    for (const glob of lerna.packages ?? []) {
      const normalized = glob.replace(/\\/g, "/").replace(/\/\*\*$/, "").replace(/\/\*$/, "");
      const absBase = path4.join(rootDir, normalized);
      if (hasManifest(absBase)) packageRoots.add(absBase);
      addWorkspaceChildren(absBase, packageRoots);
    }
  } catch {
  }
  if (fs4.existsSync(path4.join(rootDir, "nx.json"))) {
    for (const rel of ["apps", "libs"]) {
      addWorkspaceChildren(path4.join(rootDir, rel), packageRoots);
    }
  }
  if (fs4.existsSync(path4.join(rootDir, "turbo.json"))) {
    for (const rel of ["apps", "packages"]) {
      addWorkspaceChildren(path4.join(rootDir, rel), packageRoots);
    }
  }
  for (const rel of ["apps", "packages", "services"]) {
    addWorkspaceChildren(path4.join(rootDir, rel), packageRoots);
  }
  return [...packageRoots];
}
function mergeLanguages(profiles) {
  const acc = /* @__PURE__ */ new Map();
  for (const profile of profiles) {
    for (const lang of profile.languages) {
      const existing = acc.get(lang.name) ?? { fileCount: 0, extensions: /* @__PURE__ */ new Set() };
      existing.fileCount += lang.fileCount;
      for (const ext of lang.extensions) existing.extensions.add(ext);
      acc.set(lang.name, existing);
    }
  }
  const total = [...acc.values()].reduce((sum, val) => sum + val.fileCount, 0) || 1;
  return [...acc.entries()].map(([name, value]) => ({
    name,
    fileCount: value.fileCount,
    percentage: Math.round(value.fileCount / total * 100),
    extensions: [...value.extensions]
  })).sort((a, b) => b.fileCount - a.fileCount);
}
function mergeFrameworks(profiles) {
  const seen = /* @__PURE__ */ new Set();
  const frameworks = [];
  for (const profile of profiles) {
    for (const framework of profile.frameworks) {
      const key = framework.name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      frameworks.push(framework);
    }
  }
  return frameworks;
}
function mergeDependencies(profiles) {
  const deps = /* @__PURE__ */ new Set();
  for (const profile of profiles) {
    for (const dep of profile.allDependencies) deps.add(dep.toLowerCase());
  }
  return [...deps];
}
function detectBuildCommands(rootDir) {
  const commands = {};
  try {
    const pkg = JSON.parse(fs4.readFileSync(path4.join(rootDir, "package.json"), "utf-8"));
    const scripts = pkg.scripts ?? {};
    const buildAliases = ["build", "compile", "tsc"];
    const testAliases = ["test", "test:run", "jest", "vitest"];
    const devAliases = ["dev", "start:dev", "develop"];
    const lintAliases = ["lint", "lint:fix", "eslint"];
    const startAliases = ["start", "serve", "preview"];
    for (const k of buildAliases) {
      if (scripts[k]) {
        commands.build = `npm run ${k}`;
        break;
      }
    }
    for (const k of testAliases) {
      if (scripts[k]) {
        commands.test = `npm run ${k}`;
        break;
      }
    }
    for (const k of devAliases) {
      if (scripts[k]) {
        commands.dev = `npm run ${k}`;
        break;
      }
    }
    for (const k of lintAliases) {
      if (scripts[k]) {
        commands.lint = `npm run ${k}`;
        break;
      }
    }
    for (const k of startAliases) {
      if (scripts[k]) {
        commands.start = `npm run ${k}`;
        break;
      }
    }
  } catch {
  }
  if (!commands.test || !commands.build) {
    try {
      const toml = fs4.readFileSync(path4.join(rootDir, "pyproject.toml"), "utf-8");
      const scriptSection = toml.match(/\[tool\.poetry\.scripts\]([\s\S]*?)(\[|\s*$)/)?.[1] ?? "";
      const scriptEntries = [...scriptSection.matchAll(/^(\w[\w-]*)\s*=\s*"([^"]+)"/mg)];
      for (const [, name] of scriptEntries) {
        if (!commands.start && /^(start|serve|run)/.test(name)) commands.start = `poetry run ${name}`;
        if (!commands.test && /^(test|pytest)/.test(name)) commands.test = `poetry run ${name}`;
      }
      if (!commands.test) {
        if (toml.includes("pytest")) commands.test = "pytest";
        else if (toml.includes("unittest")) commands.test = "python -m unittest";
      }
      if (!commands.dev && (toml.includes("fastapi") || toml.includes("uvicorn"))) {
        commands.dev = "uvicorn main:app --reload";
      }
      if (!commands.dev && toml.includes("django")) {
        commands.dev = "python manage.py runserver";
      }
    } catch {
    }
  }
  if (!commands.test) {
    try {
      const req = fs4.readFileSync(path4.join(rootDir, "requirements.txt"), "utf-8");
      if (req.includes("pytest")) commands.test = "pytest";
      if (!commands.dev && req.includes("fastapi")) commands.dev = "uvicorn main:app --reload";
      if (!commands.dev && req.includes("django")) commands.dev = "python manage.py runserver";
    } catch {
    }
  }
  try {
    const makefile = fs4.readFileSync(path4.join(rootDir, "Makefile"), "utf-8");
    const targets = [...makefile.matchAll(/^([a-zA-Z][\w-]*):/mg)].map((m) => m[1]);
    if (!commands.build && targets.includes("build")) commands.build = "make build";
    if (!commands.test && targets.includes("test")) commands.test = "make test";
    if (!commands.dev && targets.includes("dev")) commands.dev = "make dev";
    if (!commands.dev && targets.includes("run")) commands.dev = "make run";
    if (!commands.lint && targets.includes("lint")) commands.lint = "make lint";
  } catch {
  }
  if (!commands.build && fs4.existsSync(path4.join(rootDir, "go.mod"))) {
    commands.build = "go build ./...";
    if (!commands.test) commands.test = "go test ./...";
  }
  if (!commands.build && fs4.existsSync(path4.join(rootDir, "Cargo.toml"))) {
    commands.build = "cargo build";
    if (!commands.test) commands.test = "cargo test";
  }
  if (!commands.build && fs4.existsSync(path4.join(rootDir, "pom.xml"))) {
    commands.build = "mvn compile";
    if (!commands.test) commands.test = "mvn test";
  }
  if (!commands.build && (fs4.existsSync(path4.join(rootDir, "build.gradle")) || fs4.existsSync(path4.join(rootDir, "build.gradle.kts")))) {
    commands.build = "./gradlew build";
    if (!commands.test) commands.test = "./gradlew test";
  }
  return commands;
}
function analyze(rootDir) {
  const absRoot = path4.resolve(rootDir);
  const packageRoots = discoverPackageRoots(absRoot);
  const packageProfiles = packageRoots.map((pkgRoot) => ({
    name: getProjectName(pkgRoot),
    path: path4.relative(absRoot, pkgRoot) || ".",
    languages: detectLanguages(pkgRoot),
    frameworks: detectFrameworks(pkgRoot),
    patterns: detectPatterns(pkgRoot),
    keyFiles: getKeyFiles(pkgRoot),
    allDependencies: getAllDependencies(pkgRoot)
  }));
  const languages = mergeLanguages(packageProfiles);
  const frameworks = mergeFrameworks(packageProfiles);
  const rootPatterns = detectPatterns(absRoot);
  const isMonorepo = packageProfiles.length > 1;
  return {
    projectName: getProjectName(absRoot),
    primaryLanguage: languages[0] ?? { name: "Unknown", percentage: 0, fileCount: 0, extensions: [] },
    languages,
    primaryFramework: frameworks[0],
    frameworks,
    patterns: {
      ...rootPatterns,
      monorepo: rootPatterns.monorepo || isMonorepo
    },
    keyFiles: getKeyFiles(absRoot),
    rootDir: absRoot,
    allDependencies: mergeDependencies(packageProfiles),
    packageProfiles,
    buildCommands: detectBuildCommands(absRoot)
  };
}

// src/generators/instructions.ts
import fs6 from "node:fs";
import path6 from "node:path";
import { fileURLToPath } from "node:url";

// src/generators/utils.ts
import fs5 from "node:fs";
import path5 from "node:path";
var _verbose = false;
function setVerboseMode(enabled) {
  _verbose = enabled;
}
function writeIfChanged(filePath, content) {
  fs5.mkdirSync(path5.dirname(filePath), { recursive: true });
  if (fs5.existsSync(filePath)) {
    const existing = fs5.readFileSync(filePath, "utf-8");
    if (existing === content) {
      if (_verbose) console.log(`  \u23ED\uFE0F  skip    ${filePath}  (unchanged)`);
      return "skipped";
    }
  }
  fs5.writeFileSync(filePath, content, "utf-8");
  if (_verbose) console.log(`  \u270F\uFE0F  write   ${filePath}`);
  return "written";
}
var PLACEHOLDER_RE = /\{\{[^}]+\}\}/g;
function applyFallbacks(content, fallbacks = {}) {
  return content.replace(PLACEHOLDER_RE, (match) => {
    return fallbacks[match] ?? "";
  });
}
var MANIFEST_FILENAME = "manifest.json";
function getManifestPath(outputDir) {
  return path5.join(outputDir, ".github", "ai-os", MANIFEST_FILENAME);
}
function readManifest(outputDir) {
  const manifestPath = getManifestPath(outputDir);
  try {
    return JSON.parse(fs5.readFileSync(manifestPath, "utf-8"));
  } catch {
    return null;
  }
}
function writeManifest(outputDir, version, files) {
  const manifest = {
    version,
    generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
    files: [...files].sort()
  };
  const manifestPath = getManifestPath(outputDir);
  const tmpPath = manifestPath + ".tmp";
  fs5.mkdirSync(path5.dirname(manifestPath), { recursive: true });
  fs5.writeFileSync(tmpPath, JSON.stringify(manifest, null, 2), "utf-8");
  fs5.renameSync(tmpPath, manifestPath);
}
function resolveTemplatesDir(runtimeDir) {
  const candidates = [
    path5.join(runtimeDir, "..", "templates"),
    path5.join(runtimeDir, "..", "src", "templates")
  ];
  for (const candidate of candidates) {
    if (fs5.existsSync(candidate) && fs5.statSync(candidate).isDirectory()) {
      return candidate;
    }
  }
  return candidates[0];
}

// src/generators/instructions.ts
var __dirname = path6.dirname(fileURLToPath(import.meta.url));
var TEMPLATES_DIR = resolveTemplatesDir(__dirname);
function readTemplate(name) {
  try {
    return fs6.readFileSync(path6.join(TEMPLATES_DIR, name), "utf-8");
  } catch {
    return "";
  }
}
function readFrameworkTemplate(templateKey) {
  return readTemplate(path6.join("frameworks", `${templateKey}.md`));
}
function buildStackSummary(stack) {
  const lines = [];
  for (const lang of stack.languages.slice(0, 5)) {
    lines.push(`- **${lang.name}** (${lang.percentage}% of codebase, ${lang.fileCount} files)`);
  }
  return lines.join("\n");
}
function buildKeyFilesList(stack) {
  return stack.keyFiles.map((f) => `- \`${f}\``).join("\n");
}
function buildBuildCommandsSection(stack) {
  const cmds = stack.buildCommands;
  if (!cmds || Object.keys(cmds).filter((k) => cmds[k]).length === 0) return "";
  const lines = [];
  const orderedCommands = [];
  const slots = ["build", "test", "dev", "lint", "start"];
  for (const slot of slots) {
    if (cmds[slot]) orderedCommands.push([slot.charAt(0).toUpperCase() + slot.slice(1), cmds[slot]]);
  }
  for (const [k, v] of Object.entries(cmds)) {
    if (!slots.includes(k) && v) {
      orderedCommands.push([k.charAt(0).toUpperCase() + k.slice(1), v]);
    }
  }
  for (const [label, cmd] of orderedCommands) {
    lines.push(`- **${label}:** \`${cmd}\``);
  }
  return lines.join("\n");
}
function buildPersonaDirective(stack) {
  const fw = stack.primaryFramework?.name;
  if (fw) return `Act as a Senior ${fw} developer with deep expertise in ${stack.primaryLanguage.name} and the full ${fw} ecosystem.`;
  return `Act as a Senior ${stack.primaryLanguage.name} developer.`;
}
function fillTemplate(template, stack, frameworkOverlay) {
  const frameworks = stack.frameworks.map((f) => f.name).join(", ") || stack.primaryLanguage.name;
  const linter = stack.patterns.linter ?? "none detected";
  const formatter = stack.patterns.formatter ?? "none detected";
  const testFramework = stack.patterns.testFramework ?? "none detected";
  const testDir = stack.patterns.testDirectory ?? "none detected";
  const buildCommandsSection = buildBuildCommandsSection(stack);
  return template.replace(/{{PROJECT_NAME}}/g, stack.projectName).replace(/{{PRIMARY_LANGUAGE}}/g, stack.primaryLanguage.name).replace(/{{FRAMEWORKS}}/g, frameworks).replace(/{{PACKAGE_MANAGER}}/g, stack.patterns.packageManager).replace(/{{HAS_TYPESCRIPT}}/g, stack.patterns.hasTypeScript ? "Yes" : "No").replace(/{{STACK_SUMMARY}}/g, buildStackSummary(stack)).replace(/{{NAMING_CONVENTION}}/g, stack.patterns.namingConvention).replace(/{{LINTER}}/g, linter).replace(/{{FORMATTER}}/g, formatter).replace(/{{TEST_FRAMEWORK}}/g, testFramework).replace(/{{TEST_DIRECTORY}}/g, testDir).replace(/{{KEY_FILES}}/g, buildKeyFilesList(stack)).replace(/{{BUILD_COMMANDS}}/g, buildCommandsSection).replace(/{{PERSONA_DIRECTIVE}}/g, buildPersonaDirective(stack)).replace(/{{FRAMEWORK_OVERLAY}}/g, frameworkOverlay);
}
function enforceSizeCap(content, maxBytes = 8192) {
  const encoded = Buffer.byteLength(content, "utf-8");
  if (encoded <= maxBytes) return content;
  const cutIdx = content.lastIndexOf("\n---\n", Math.floor(content.length * (maxBytes / encoded)));
  if (cutIdx > 0) {
    const truncated = content.slice(0, cutIdx) + "\n\n<!-- [AI OS] content trimmed to stay within 8 KB Copilot budget -->\n";
    if (Buffer.byteLength(truncated, "utf-8") <= maxBytes) return truncated;
  }
  const bytes = Buffer.from(content, "utf-8").slice(0, maxBytes - 100);
  return bytes.toString("utf-8") + "\n\n<!-- [AI OS] truncated to 8 KB Copilot budget -->\n";
}
function generatePathSpecificInstructions(stack, githubDir) {
  const files = [];
  const root = path6.dirname(githubDir);
  const instructionsDir = path6.join(githubDir, "instructions");
  const fw = stack.primaryFramework?.name ?? "";
  const primaryLang = stack.primaryLanguage.name;
  const frontendPaths = ["src/app", "src/pages", "components", "pages", "app", "src/components"];
  const hasFrontend = frontendPaths.some((p) => fs6.existsSync(path6.join(root, p)));
  if (hasFrontend) {
    const applyPaths = frontendPaths.filter((p2) => fs6.existsSync(path6.join(root, p2)));
    const applyTo = applyPaths.map((p2) => `${p2}/**`).join(", ");
    const content = [
      "---",
      `applyTo: "${applyTo}"`,
      "---",
      "",
      `# Frontend Rules \u2014 ${stack.projectName}`,
      "",
      `- Use ${fw || primaryLang} conventions for all UI components`,
      "- Prefer shared components in the detected components directory over new one-offs",
      stack.patterns.hasTypeScript ? "- All component props must be typed (no `any`)" : "",
      stack.patterns.namingConvention === "PascalCase" ? "- Component files: PascalCase (e.g. `MyButton.tsx`)" : `- Component files: ${stack.patterns.namingConvention}`,
      stack.patterns.testFramework ? `- Co-locate component tests (*.test.tsx / *.spec.tsx) using ${stack.patterns.testFramework}` : ""
    ].filter(Boolean).join("\n");
    const p = path6.join(instructionsDir, "frontend.instructions.md");
    writeIfChanged(p, content);
    files.push(p);
  }
  const backendPaths = ["src/api", "server", "routes", "src/routes", "api", "src/server"];
  const hasBackend = backendPaths.some((p) => fs6.existsSync(path6.join(root, p)));
  if (hasBackend) {
    const applyPaths = backendPaths.filter((p2) => fs6.existsSync(path6.join(root, p2)));
    const applyTo = applyPaths.map((p2) => `${p2}/**`).join(", ");
    const content = [
      "---",
      `applyTo: "${applyTo}"`,
      "---",
      "",
      `# Backend Rules \u2014 ${stack.projectName}`,
      "",
      "- Validate all external inputs at API boundaries",
      "- Never return raw error messages to clients \u2014 use structured error responses",
      "- Scope all database queries by the authenticated user/owner",
      stack.patterns.hasTypeScript ? "- Type all request/response payloads (no implicit `any`)" : "",
      "- Use async/await over callback chains"
    ].filter(Boolean).join("\n");
    const p = path6.join(instructionsDir, "backend.instructions.md");
    writeIfChanged(p, content);
    files.push(p);
  }
  const testExts = ["test.ts", "test.tsx", "spec.ts", "spec.tsx", "test.js", "spec.js"];
  const hasTestFiles = testExts.some((ext) => {
    try {
      const out = fs6.readdirSync(root).some((f) => f.endsWith(`.${ext}`));
      return out;
    } catch {
      return false;
    }
  });
  const hasTestDir = stack.patterns.testDirectory ? fs6.existsSync(path6.join(root, stack.patterns.testDirectory)) : false;
  if (hasTestDir || stack.patterns.testFramework) {
    const applyTo = "**/*.test.ts, **/*.test.tsx, **/*.spec.ts, **/*.spec.tsx, **/*.test.js, **/*.spec.js";
    const content = [
      "---",
      `applyTo: "${applyTo}"`,
      "---",
      "",
      `# Test Rules \u2014 ${stack.projectName}`,
      "",
      stack.patterns.testFramework ? `- Use ${stack.patterns.testFramework} as the test framework` : "- Use the existing test framework consistently",
      stack.patterns.testDirectory ? `- Tests live in \`${stack.patterns.testDirectory}/\` or co-located (\`*.test.ts\`)` : "",
      "- One assertion concept per test (avoid multiple unrelated assertions)",
      '- Test descriptions must be descriptive: `it("returns 401 when token is missing")`',
      "- Mock external services and databases in unit tests",
      "- Do not import from `dist/` or `build/` in tests"
    ].filter(Boolean).join("\n");
    const p = path6.join(instructionsDir, "tests.instructions.md");
    writeIfChanged(p, content);
    files.push(p);
  }
  const schemaPaths = ["prisma", "migrations", "db/migrations", "src/db"];
  const hasSchema = schemaPaths.some((p) => fs6.existsSync(path6.join(root, p)));
  if (hasSchema || stack.allDependencies.includes("prisma") || stack.allDependencies.includes("@prisma/client")) {
    const applyPaths = schemaPaths.filter((p2) => fs6.existsSync(path6.join(root, p2)));
    const applyTo = applyPaths.length > 0 ? applyPaths.map((p2) => `${p2}/**`).join(", ") : "prisma/**, migrations/**";
    const content = [
      "---",
      `applyTo: "${applyTo}"`,
      "---",
      "",
      `# Schema & Migration Rules \u2014 ${stack.projectName}`,
      "",
      "- Call `get_prisma_schema` before any model changes",
      "- Never delete columns in a single migration \u2014 deprecate then remove in the next release",
      "- Add database indexes for all foreign keys and frequently queried fields",
      "- Schema changes require a migration file \u2014 do not edit the schema without running migrate"
    ].join("\n");
    const p = path6.join(instructionsDir, "schema.instructions.md");
    writeIfChanged(p, content);
    files.push(p);
  }
  return files;
}
function buildPersistentRulesSection(persistentRules, stack) {
  const detectedRules = [];
  const root = stack.rootDir;
  if (fs6.existsSync(path6.join(root, "src", "components", "ui"))) {
    detectedRules.push("ALWAYS use shared components from `src/components/ui` before creating new UI components");
  } else if (fs6.existsSync(path6.join(root, "components", "ui"))) {
    detectedRules.push("ALWAYS use shared components from `components/ui` before creating new UI components");
  } else if (fs6.existsSync(path6.join(root, "src", "components"))) {
    detectedRules.push("ALWAYS check `src/components` for existing components before creating new ones");
  } else if (fs6.existsSync(path6.join(root, "components"))) {
    detectedRules.push("ALWAYS check `components/` for existing components before creating new ones");
  }
  const utilsPaths = ["src/lib", "src/utils", "lib", "utils"];
  for (const up of utilsPaths) {
    if (fs6.existsSync(path6.join(root, up))) {
      detectedRules.push(`NEVER create utility functions outside \`${up}/\` \u2014 add them there instead`);
      break;
    }
  }
  const apiPaths = ["src/api", "src/routes", "api", "routes", "server/routes"];
  for (const ap of apiPaths) {
    if (fs6.existsSync(path6.join(root, ap))) {
      detectedRules.push(`ALWAYS add new API routes inside \`${ap}/\` following the existing file structure`);
      break;
    }
  }
  const typePaths = ["src/types", "src/interfaces", "types", "interfaces"];
  for (const tp of typePaths) {
    if (fs6.existsSync(path6.join(root, tp))) {
      detectedRules.push(`ALWAYS define shared types and interfaces in \`${tp}/\` \u2014 do not redeclare them inline`);
      break;
    }
  }
  if (stack.patterns.testDirectory) {
    detectedRules.push(`ALWAYS place new test files in \`${stack.patterns.testDirectory}/\` or co-located with their source file`);
  }
  if (stack.patterns.hasTypeScript) {
    detectedRules.push("NEVER use `any` as a type \u2014 use proper TypeScript types or `unknown`");
  }
  const allRules = [...persistentRules, ...detectedRules];
  if (allRules.length === 0) return "";
  return [
    "",
    "## Persistent Rules",
    "",
    "> These rules survive context window resets. They are enforced on every request.",
    "",
    ...allRules.map((r) => `- ${r}`)
  ].join("\n");
}
function generateInstructions(stack, outputDir, options) {
  const base = readTemplate("base-instructions.md");
  if (!base) throw new Error("Base instructions template not found");
  const config = options?.config;
  const templateKeys = /* @__PURE__ */ new Set();
  for (const fw of stack.frameworks) {
    templateKeys.add(fw.template);
  }
  const overlays = [...templateKeys].map((k) => readFrameworkTemplate(k)).filter(Boolean).join("\n\n---\n\n");
  let content = fillTemplate(base, stack, overlays || `## ${stack.primaryLanguage.name} Project

No specific framework template found. Follow the general rules above.`);
  const persistentRules = config?.persistentRules ?? [];
  const persistentSection = buildPersistentRulesSection(persistentRules, stack);
  if (persistentSection) {
    content = content + persistentSection;
  }
  content = enforceSizeCap(content);
  const githubDir = path6.join(outputDir, ".github");
  const outputPath = path6.join(githubDir, "copilot-instructions.md");
  writeIfChanged(outputPath, content);
  const instructionsDir = path6.join(githubDir, "instructions");
  const autoActivationContent = [
    "---",
    'applyTo: "**"',
    "---",
    "",
    `# AI OS \u2014 Active (${stack.projectName})`,
    "",
    "This repository uses **AI OS** for context-enriched Copilot assistance.",
    "The following MCP tools are available \u2014 use them proactively:",
    "",
    "| Tool | When to call |",
    "|---|---|",
    "| `get_session_context` | **At session start** \u2014 reloads MUST-ALWAYS rules and key context |",
    "| `get_project_structure` | Before exploring unfamiliar directories |",
    "| `get_stack_info` | Before suggesting any library or tooling changes |",
    "| `get_conventions` | Before writing new code in this repo |",
    "| `get_file_summary` | To understand a file without reading it fully |",
    "| `get_impact_of_change` | **Before editing any file** \u2014 shows blast radius |",
    "| `get_dependency_chain` | To trace how a module connects to the rest of the code |",
    "| `search_codebase` | To find symbols, patterns, or usage examples |",
    "| `get_env_vars` | Before referencing environment variables |",
    "| `check_for_updates` | To see if AI OS artifacts are out of date |",
    "| `get_memory_guidelines` | At task start to load memory safety protocol |",
    "| `get_repo_memory` | Before coding to recover durable repo decisions and constraints |",
    "| `remember_repo_fact` | After substantial tasks to persist verified learnings |",
    "| `get_recommendations` | To see stack-appropriate tools, extensions, and skills |",
    "| `suggest_improvements` | To surface architectural and tooling gaps |",
    "",
    "## Session Restart Protocol",
    "",
    "**When starting a new conversation or after a context window reset:**",
    "1. Call `get_session_context` \u2192 reloads MUST-ALWAYS rules, build commands, key files",
    "2. Call `get_repo_memory` \u2192 reloads durable architectural decisions",
    "3. Call `get_conventions` \u2192 reloads coding rules",
    "",
    "## Memory Protocol",
    "",
    "1. MUST start each non-trivial task by checking relevant repository memory.",
    "2. Prioritize memory-backed constraints over assumptions.",
    "3. MUST persist only verified durable facts and decisions at the end of the task.",
    "4. Do not store speculative, duplicate, or transient status notes in repo memory.",
    "",
    "## Strict Behavior Guardrails",
    "",
    "1. MUST ask clarifying questions first when a request is ambiguous, underspecified, or outside described scope.",
    "2. MUST NOT improvise requirements, API contracts, or migration scope beyond explicit instructions.",
    "3. MUST avoid silent fallback for core runtime failures; return explicit diagnostics instead.",
    "",
    "### Allowed Actions",
    "",
    "- Read relevant context and repository memory before implementation.",
    "- Apply minimal in-scope edits and validate with non-destructive checks.",
    "",
    "### Forbidden Actions",
    "",
    "- Destructive operations without explicit approval.",
    "- Broad refactors or architecture changes without confirmation.",
    "- Writing speculative or transient notes into repo memory.",
    "",
    "### Escalation Flow (When Ambiguous)",
    "",
    "1. State what is unclear and what assumptions would change behavior.",
    "2. Ask focused clarifying question(s) with bounded options.",
    "3. Continue after clarification; if unavailable, take safest minimal action and document limits.",
    "",
    "## Update AI OS",
    "",
    "If `check_for_updates` returns an available update, run:",
    "```bash",
    "npx -y github:marinvch/ai-os --refresh-existing",
    "```",
    "This refreshes all context docs, agent files, skills, and MCP tools in-place."
  ].join("\n");
  const autoActivationPath = path6.join(instructionsDir, "ai-os.instructions.md");
  writeIfChanged(autoActivationPath, autoActivationContent);
  const outputFiles = [outputPath, autoActivationPath];
  if (config?.pathSpecificInstructions !== false) {
    const pathSpecificFiles = generatePathSpecificInstructions(stack, githubDir);
    outputFiles.push(...pathSpecificFiles);
  }
  return outputFiles;
}

// src/generators/mcp.ts
import path7 from "node:path";

// src/mcp-tools.ts
var always = () => true;
var MCP_TOOL_DEFINITIONS = [
  {
    name: "search_codebase",
    description: "Search for patterns, symbols, or text across the project codebase. Respects .gitignore. Returns matching file paths and snippets.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "The pattern or text to search for" },
        filePattern: { type: "string", description: 'Optional glob pattern to limit search (e.g. "*.ts", "src/**/*.py")' },
        caseSensitive: { type: "boolean", description: "Whether search is case-sensitive (default: false)" }
      },
      required: ["query"]
    },
    condition: always
  },
  {
    name: "get_project_structure",
    description: "Returns an annotated file tree of the project (respects .gitignore, skips node_modules/build/dist). Useful for understanding project layout before making changes.",
    inputSchema: {
      type: "object",
      properties: {
        depth: { type: "number", description: "Max directory depth to show (default: 4)" },
        path: { type: "string", description: "Subdirectory to start from (default: project root)" }
      }
    },
    condition: always
  },
  {
    name: "get_conventions",
    description: "Returns the detected coding conventions for this project: naming rules, file structure, testing patterns, forbidden practices.",
    inputSchema: { type: "object", properties: {} },
    condition: always
  },
  {
    name: "get_stack_info",
    description: "Returns the complete tech stack inventory: languages, frameworks, key dependencies, build tools, and test setup.",
    inputSchema: { type: "object", properties: {} },
    condition: always
  },
  {
    name: "get_file_summary",
    description: "Returns a structured summary of a specific file: key exports, types, functions, and brief description. Token-efficient alternative to reading the full file.",
    inputSchema: {
      type: "object",
      properties: {
        filePath: { type: "string", description: "Path to the file relative to project root" }
      },
      required: ["filePath"]
    },
    condition: always
  },
  {
    name: "get_prisma_schema",
    description: "Returns the full Prisma schema file contents. Use before making any database model changes.",
    inputSchema: { type: "object", properties: {} },
    condition: (stack) => stack.allDependencies.includes("prisma") || stack.allDependencies.includes("@prisma/client")
  },
  {
    name: "get_trpc_procedures",
    description: "Returns a summary of all tRPC procedures (name, input type, public/private). Avoids reading the entire router file.",
    inputSchema: { type: "object", properties: {} },
    condition: (stack) => {
      const frameworks = stack.frameworks.map((f) => f.name.toLowerCase());
      return stack.allDependencies.includes("@trpc/server") || frameworks.includes("trpc");
    }
  },
  {
    name: "get_api_routes",
    description: "Returns a list of API routes with HTTP methods using stack-aware discovery for Node, Java/Spring, Python, Go, and Rust patterns.",
    inputSchema: {
      type: "object",
      properties: {
        filter: { type: "string", description: 'Optional substring to filter routes (e.g. "auth", "webhook")' }
      }
    },
    condition: (stack) => {
      const frameworks = stack.frameworks.map((f) => f.name.toLowerCase());
      return frameworks.some(
        (f) => f.includes("next") || f.includes("express") || f.includes("fastapi") || f.includes("django") || f.includes("flask") || f.includes("spring") || f.includes("quarkus") || f.includes("micronaut") || f.includes("gin") || f.includes("echo") || f.includes("fiber") || f.includes("chi") || f.includes("actix") || f.includes("axum") || f.includes("rocket")
      );
    }
  },
  {
    name: "get_env_vars",
    description: "Returns all required environment variable names (from .env.example or code). Shows which are set vs. missing. Never returns values.",
    inputSchema: { type: "object", properties: {} },
    condition: always
  },
  {
    name: "get_package_info",
    description: "Returns installed package versions and direct dependencies. Useful before suggesting library usage to avoid API mismatch.",
    inputSchema: {
      type: "object",
      properties: {
        packageName: { type: "string", description: 'Optional: specific package to look up (e.g. "@trpc/server")' }
      }
    },
    condition: always
  },
  {
    name: "get_impact_of_change",
    description: "Shows what files are affected when a given file changes. Returns direct importers and all transitively affected files.",
    inputSchema: {
      type: "object",
      properties: {
        filePath: { type: "string", description: 'File path relative to project root (e.g. "src/types.ts")' }
      },
      required: ["filePath"]
    },
    condition: always
  },
  {
    name: "get_dependency_chain",
    description: "Shows the full dependency chain for a file: what it imports and what imports it, with export names.",
    inputSchema: {
      type: "object",
      properties: {
        filePath: { type: "string", description: 'File path relative to project root (e.g. "src/utils/auth.ts")' }
      },
      required: ["filePath"]
    },
    condition: always
  },
  {
    name: "check_for_updates",
    description: "Checks if the AI OS artifacts installed in this repo are out of date. Returns update instructions when a newer version of AI OS is available.",
    inputSchema: { type: "object", properties: {} },
    condition: always
  },
  {
    name: "get_memory_guidelines",
    description: "Returns repository memory rules and memory usage protocol from .github/ai-os/context/memory.md.",
    inputSchema: { type: "object", properties: {} },
    condition: always
  },
  {
    name: "get_repo_memory",
    description: "Retrieves persisted repository memory entries from .github/ai-os/memory/memory.jsonl, optionally filtered by query/category.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Optional full-text query against title/content/tags" },
        category: { type: "string", description: "Optional category filter (e.g. architecture, conventions, pitfalls)" },
        limit: { type: "number", description: "Max entries to return (default: 10, max: 50)" }
      }
    },
    condition: always
  },
  {
    name: "remember_repo_fact",
    description: "Stores a durable repository memory entry in .github/ai-os/memory/memory.jsonl using dedupe/upsert rules (marks superseded conflicts and avoids duplicate facts).",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short memory title" },
        content: { type: "string", description: "Durable fact/decision/constraint" },
        category: { type: "string", description: "Category (e.g. conventions, architecture, build, testing, security)" },
        tags: { type: "string", description: "Optional comma-separated tags" }
      },
      required: ["title", "content"]
    },
    condition: always
  },
  // ── Tool #19: Session Continuity ─────────────────────────────────────────
  {
    name: "get_session_context",
    description: "Returns the compact session context card with MUST-ALWAYS rules, build/test commands, and key file locations. CALL THIS at the start of every new conversation to reload critical context after a session reset.",
    inputSchema: { type: "object", properties: {} },
    condition: always
  },
  // ── Tool #20: Recommendation Engine ──────────────────────────────────────
  {
    name: "get_recommendations",
    description: "Returns stack-appropriate recommendations: MCP servers, VS Code extensions, agent skills, and GitHub Copilot Extensions. Useful for setting up a new developer environment.",
    inputSchema: { type: "object", properties: {} },
    condition: always
  },
  // ── Tool #21: Improvement Suggestions ────────────────────────────────────
  {
    name: "suggest_improvements",
    description: "Analyzes project structure and memory entries to return architectural and tooling optimization suggestions (e.g. missing env var documentation, undocumented key paths, skills gaps).",
    inputSchema: { type: "object", properties: {} },
    condition: always
  }
];
function getMcpToolsForStack(stack) {
  return MCP_TOOL_DEFINITIONS.filter((tool) => tool.condition ? tool.condition(stack) : true).map(({ condition: _condition, ...tool }) => tool);
}

// src/generators/mcp.ts
function generateMcpJson(stack, outputDir, _options) {
  const allTools = getMcpToolsForStack(stack);
  const committedConfig = { version: 1 };
  const mcpJsonPath = path7.join(outputDir, ".github", "copilot", "mcp.json");
  writeIfChanged(mcpJsonPath, JSON.stringify(committedConfig, null, 2));
  const toolsJsonPath = path7.join(outputDir, ".github", "ai-os", "tools.json");
  writeIfChanged(toolsJsonPath, JSON.stringify(allTools, null, 2));
  return [mcpJsonPath, toolsJsonPath];
}

// src/generators/context-docs.ts
import fs9 from "node:fs";
import path10 from "node:path";

// src/detectors/graph.ts
import fs7 from "node:fs";
import path8 from "node:path";
var IGNORE_DIRS2 = /* @__PURE__ */ new Set([
  "node_modules",
  ".git",
  ".next",
  ".nuxt",
  "dist",
  "build",
  "out",
  "__pycache__",
  ".venv",
  "venv",
  "target",
  "vendor",
  "coverage",
  ".gradle",
  "bin",
  "obj",
  ".vs",
  "packages",
  ".cache",
  ".ai-os"
]);
var SOURCE_EXTENSIONS = /* @__PURE__ */ new Set([
  "ts",
  "tsx",
  "js",
  "jsx",
  "mjs",
  "cjs",
  "py",
  "go",
  "rs",
  "java",
  "cs",
  "rb",
  "php"
]);
function collectSourceFiles(dir, rootDir) {
  const files = [];
  try {
    const entries = fs7.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      if (IGNORE_DIRS2.has(entry.name)) continue;
      const full = path8.join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...collectSourceFiles(full, rootDir));
      } else if (entry.isFile()) {
        const ext = entry.name.split(".").pop()?.toLowerCase() ?? "";
        if (SOURCE_EXTENSIONS.has(ext)) {
          files.push(path8.relative(rootDir, full).replace(/\\/g, "/"));
        }
      }
    }
  } catch {
  }
  return files;
}
function parseImports(content, filePath) {
  const imports = [];
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  if (["ts", "tsx", "js", "jsx", "mjs", "cjs"].includes(ext)) {
    const importRe = /(?:import\s+(?:[\w\s{},*]+\s+from\s+|)|export\s+[\w\s{},*]+\s+from\s+|require\s*\()['"]([^'"]+)['"]/g;
    let m;
    while ((m = importRe.exec(content)) !== null) {
      const spec = m[1];
      if (!spec) continue;
      if (spec.startsWith(".")) {
        const dir = path8.dirname(filePath);
        const resolved = path8.posix.join(dir, spec);
        imports.push(resolved);
      }
    }
  }
  if (ext === "py") {
    const pyRelRe = /^from\s+(\.[\w.]*)\s+import/gm;
    let m;
    while ((m = pyRelRe.exec(content)) !== null) {
      imports.push(m[1]);
    }
  }
  if (ext === "java") {
    const javaImportRe = /^import\s+(?:static\s+)?([\w.]+)\s*;/gm;
    let m;
    while ((m = javaImportRe.exec(content)) !== null) {
      const fqn = m[1];
      if (!fqn) continue;
      const relPath = fqn.replace(/\./g, "/") + ".java";
      imports.push(relPath);
    }
  }
  return [...new Set(imports)];
}
function parseExports(content, ext) {
  const exports = [];
  if (["ts", "tsx", "js", "jsx", "mjs", "cjs"].includes(ext)) {
    const namedRe = /export\s+(?:default\s+)?(?:async\s+)?(?:function|class|const|let|var|type|interface|enum)\s+(\w+)/g;
    let m;
    while ((m = namedRe.exec(content)) !== null) {
      exports.push(m[1]);
    }
    const groupedRe = /export\s*\{([^}]+)\}/g;
    while ((m = groupedRe.exec(content)) !== null) {
      const names = m[1].split(",").map((s) => s.trim().split(/\s+as\s+/).pop()?.trim() ?? "").filter(Boolean);
      exports.push(...names);
    }
  }
  return [...new Set(exports)];
}
function resolveImportPath(importSpec, allFiles) {
  if (allFiles.includes(importSpec)) return importSpec;
  const exts = ["ts", "tsx", "js", "jsx", "mjs"];
  for (const ext of exts) {
    const candidate = `${importSpec}.${ext}`;
    if (allFiles.includes(candidate)) return candidate;
  }
  for (const ext of exts) {
    const candidate = `${importSpec}/index.${ext}`;
    if (allFiles.includes(candidate)) return candidate;
  }
  if (importSpec.endsWith(".js")) {
    const base = importSpec.slice(0, -3);
    for (const ext of ["ts", "tsx"]) {
      const candidate = `${base}.${ext}`;
      if (allFiles.includes(candidate)) return candidate;
    }
  }
  if (importSpec.endsWith(".java")) {
    const javaSourceRoots = ["src/main/java/", "src/"];
    for (const root of javaSourceRoots) {
      const candidate = root + importSpec;
      if (allFiles.includes(candidate)) return candidate;
    }
  }
  return void 0;
}
function buildDependencyGraph(rootDir) {
  const allFiles = collectSourceFiles(rootDir, rootDir);
  const nodes = {};
  for (const file of allFiles) {
    nodes[file] = { path: file, imports: [], importedBy: [], exports: [] };
  }
  for (const file of allFiles) {
    try {
      const content = fs7.readFileSync(path8.join(rootDir, file), "utf-8");
      const ext = file.split(".").pop()?.toLowerCase() ?? "";
      nodes[file].exports = parseExports(content, ext);
      const rawImports = parseImports(content, file);
      for (const raw of rawImports) {
        const resolved = resolveImportPath(raw, allFiles);
        if (!resolved || resolved === file) continue;
        if (!nodes[file].imports.includes(resolved)) {
          nodes[file].imports.push(resolved);
        }
        if (!nodes[resolved]) {
          nodes[resolved] = { path: resolved, imports: [], importedBy: [], exports: [] };
        }
        if (!nodes[resolved].importedBy.includes(file)) {
          nodes[resolved].importedBy.push(file);
        }
      }
    } catch {
    }
  }
  return {
    nodes,
    generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
    fileCount: allFiles.length
  };
}

// src/updater.ts
import fs8 from "node:fs";
import path9 from "node:path";
import { fileURLToPath as fileURLToPath2 } from "node:url";
var __dirname2 = path9.dirname(fileURLToPath2(import.meta.url));
function getToolVersion() {
  try {
    const pkg = JSON.parse(
      fs8.readFileSync(path9.join(__dirname2, "..", "package.json"), "utf-8")
    );
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}
function readInstalledConfig(targetDir) {
  const newConfigPath = path9.join(targetDir, ".github", "ai-os", "config.json");
  const legacyConfigPath = path9.join(targetDir, ".ai-os", "config.json");
  const configPath = fs8.existsSync(newConfigPath) ? newConfigPath : legacyConfigPath;
  try {
    return JSON.parse(fs8.readFileSync(configPath, "utf-8"));
  } catch {
    return null;
  }
}
function isNewer(candidate, installed) {
  const parse = (v) => v.replace(/^v/, "").split(".").map(Number);
  const [cMaj = 0, cMin = 0, cPat = 0] = parse(candidate);
  const [iMaj = 0, iMin = 0, iPat = 0] = parse(installed);
  if (cMaj !== iMaj) return cMaj > iMaj;
  if (cMin !== iMin) return cMin > iMin;
  return cPat > iPat;
}
function checkUpdateStatus(targetDir) {
  const toolVersion = getToolVersion();
  const config = readInstalledConfig(targetDir);
  if (!config) {
    return { toolVersion, installedVersion: null, updateAvailable: false, isFirstInstall: true };
  }
  const installedVersion = config.version;
  return {
    toolVersion,
    installedVersion,
    updateAvailable: isNewer(toolVersion, installedVersion),
    isFirstInstall: false
  };
}
function printUpdateBanner(status) {
  if (!status.updateAvailable) return;
  const updateCmd = `npx -y github:marinvch/ai-os#v${status.toolVersion} --refresh-existing`;
  console.log("");
  console.log("  \u250C\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2510");
  console.log(`  \u2502  \u{1F514} AI OS Update Available                          \u2502`);
  console.log(`  \u2502     Installed: v${status.installedVersion?.padEnd(10) ?? "unknown   "}  \u2192  Latest: v${status.toolVersion.padEnd(10)}\u2502`);
  console.log(`  \u2502                                                     \u2502`);
  console.log(`  \u2502  Re-run AI OS with --refresh-existing (or --update) \u2502`);
  console.log(`  \u2502  to refresh context, tools, agents, and MCP files.  \u2502`);
  console.log("  \u2514\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2518");
  console.log(`  ${updateCmd}`);
  console.log("");
}
function pruneLegacyArtifacts(targetDir, options) {
  const fullCleanup = options?.fullCleanup === true;
  const legacyContextDir = path9.join(targetDir, ".ai-os", "context");
  const legacyConfig = path9.join(targetDir, ".ai-os", "config.json");
  const legacyTools = path9.join(targetDir, ".ai-os", "tools.json");
  const legacyMemoryDir = path9.join(targetDir, ".ai-os", "memory");
  const legacyAiOsDir = path9.join(targetDir, ".ai-os");
  if (fullCleanup) {
    let removed2 = 0;
    try {
      for (const file of [legacyConfig, legacyTools]) {
        if (fs8.existsSync(file)) {
          fs8.rmSync(file);
          removed2 += 1;
        }
      }
      for (const dir of [legacyContextDir, legacyMemoryDir]) {
        if (fs8.existsSync(dir)) {
          fs8.rmSync(dir, { recursive: true, force: true });
          removed2 += 1;
        }
      }
      if (fs8.existsSync(legacyAiOsDir) && fs8.readdirSync(legacyAiOsDir).length === 0) {
        fs8.rmdirSync(legacyAiOsDir);
      }
    } catch {
    }
    if (removed2 > 0) {
      console.log(`  \u{1F9F9} Clean-update removed ${removed2} legacy .ai-os artifact(s) (config/tools/context/memory)`);
    }
    return;
  }
  if (!fs8.existsSync(legacyContextDir)) return;
  const MANAGED_EXTENSIONS = /* @__PURE__ */ new Set([".md", ".json"]);
  let removed = 0;
  try {
    const entries = fs8.readdirSync(legacyContextDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const ext = path9.extname(entry.name).toLowerCase();
      if (!MANAGED_EXTENSIONS.has(ext)) continue;
      try {
        fs8.rmSync(path9.join(legacyContextDir, entry.name));
        removed += 1;
      } catch {
      }
    }
    const remaining = fs8.readdirSync(legacyContextDir);
    if (remaining.length === 0) {
      fs8.rmdirSync(legacyContextDir);
      if (fs8.existsSync(legacyMemoryDir) && fs8.readdirSync(legacyMemoryDir).length === 0) {
        fs8.rmdirSync(legacyMemoryDir);
      }
      if (fs8.existsSync(legacyAiOsDir) && fs8.readdirSync(legacyAiOsDir).length === 0) {
        fs8.rmdirSync(legacyAiOsDir);
      }
    }
  } catch {
  }
  if (removed > 0) {
    console.log(`  \u{1F9F9} Pruned ${removed} legacy .ai-os/context/ artifact(s) (pre-v0.3.0 migration)`);
  }
}

// src/generators/context-docs.ts
var DEFAULT_AI_OS_CONFIG = {
  agentsMd: false,
  pathSpecificInstructions: true,
  recommendations: true,
  sessionContextCard: true,
  updateCheckEnabled: true,
  agentFlowMode: "create",
  persistentRules: [],
  exclude: ["node_modules", "dist", ".next", ".nuxt", "build", "out"]
};
function readAiOsConfig(outputDir) {
  const configPath = path10.join(outputDir, ".github", "ai-os", "config.json");
  try {
    return JSON.parse(fs9.readFileSync(configPath, "utf-8"));
  } catch {
    return null;
  }
}
function formatNodeLabel(value) {
  return value.replace(/"/g, '\\"').replace(/\n/g, " ").trim();
}
function joinOrNone(values, max = 4) {
  if (values.length === 0) return "none";
  const shown = values.slice(0, max);
  const suffix = values.length > max ? ` +${values.length - max} more` : "";
  return `${shown.join(", ")}${suffix}`;
}
function exists2(root, relativePath) {
  return fs9.existsSync(path10.join(root, relativePath));
}
function countMarkdownFiles(dir) {
  if (!fs9.existsSync(dir)) return 0;
  const entries = fs9.readdirSync(dir, { withFileTypes: true });
  let total = 0;
  for (const entry of entries) {
    const fullPath = path10.join(dir, entry.name);
    if (entry.isDirectory()) {
      total += countMarkdownFiles(fullPath);
      continue;
    }
    if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
      total += 1;
    }
  }
  return total;
}
function detectExistingAiContext(rootDir) {
  const artifacts = [];
  const categories = ["instructions", "skills", "prompts", "agents", "docs", "other"];
  const counts = Object.fromEntries(categories.map((c) => [c, 0]));
  const add = (relativePath, category) => {
    artifacts.push({ path: relativePath, category });
    counts[category] += 1;
  };
  if (exists2(rootDir, ".github/copilot-instructions.md")) add(".github/copilot-instructions.md", "instructions");
  if (exists2(rootDir, ".github/instructions")) add(".github/instructions/", "instructions");
  if (exists2(rootDir, ".github/copilot/prompts.json")) add(".github/copilot/prompts.json", "prompts");
  const skillsDir = path10.join(rootDir, ".github", "copilot", "skills");
  const skillsCount = countMarkdownFiles(skillsDir);
  if (skillsCount > 0) add(`.github/copilot/skills/ (${skillsCount} files)`, "skills");
  const agentsDir = path10.join(rootDir, ".github", "agents");
  const agentsCount = countMarkdownFiles(agentsDir);
  if (agentsCount > 0) add(`.github/agents/ (${agentsCount} files)`, "agents");
  if (exists2(rootDir, ".github/ai-os/context/stack.md")) add(".github/ai-os/context/stack.md", "docs");
  if (exists2(rootDir, ".github/ai-os/context/architecture.md")) add(".github/ai-os/context/architecture.md", "docs");
  if (exists2(rootDir, ".github/ai-os/context/conventions.md")) add(".github/ai-os/context/conventions.md", "docs");
  if (!exists2(rootDir, ".github/ai-os/context/stack.md") && exists2(rootDir, ".ai-os/context/stack.md")) add(".ai-os/context/stack.md (legacy)", "docs");
  if (!exists2(rootDir, ".github/ai-os/context/architecture.md") && exists2(rootDir, ".ai-os/context/architecture.md")) add(".ai-os/context/architecture.md (legacy)", "docs");
  if (!exists2(rootDir, ".github/ai-os/context/conventions.md") && exists2(rootDir, ".ai-os/context/conventions.md")) add(".ai-os/context/conventions.md (legacy)", "docs");
  if (exists2(rootDir, "docs/ai/session_memory.md")) add("docs/ai/session_memory.md", "docs");
  if (exists2(rootDir, "AGENTS.md")) add("AGENTS.md", "other");
  if (exists2(rootDir, "CLAUDE.md")) add("CLAUDE.md", "other");
  if (exists2(rootDir, ".cursor/rules")) add(".cursor/rules/", "other");
  if (exists2(rootDir, ".windsurfrules")) add(".windsurfrules", "other");
  return { artifacts, counts };
}
function generateExistingAiContextDoc(stack, summary) {
  const totalArtifacts = summary.artifacts.length;
  const lines = [
    `# Existing AI Context \u2014 ${stack.projectName}`,
    "",
    "> Auto-generated by AI OS. This report detects existing AI guidance and suggests a Git Bash-first optimization path.",
    "",
    "## Detection Summary",
    "",
    `- Total detected AI artifacts: **${totalArtifacts}**`,
    `- Copilot instructions: **${summary.counts.instructions}**`,
    `- Copilot skills: **${summary.counts.skills}**`,
    `- Prompt registries: **${summary.counts.prompts}**`,
    `- Agent files: **${summary.counts.agents}**`,
    `- AI docs/context files: **${summary.counts.docs}**`,
    `- Other assistant configs: **${summary.counts.other}**`,
    "",
    "## Detected Artifacts",
    ""
  ];
  if (summary.artifacts.length === 0) {
    lines.push("- No existing AI context artifacts were detected.");
  } else {
    for (const artifact of summary.artifacts) {
      lines.push(`- [${artifact.category}] \`${artifact.path}\``);
    }
  }
  lines.push("", "## Optimization Plan (Git Bash-First)", "");
  lines.push("1. Refresh generated artifacts in-place (safe for existing repos):");
  lines.push("```bash");
  lines.push('npm run generate -- --cwd "$PWD" --refresh-existing');
  lines.push("```");
  lines.push("2. Re-run installer in refresh mode when onboarding or syncing:");
  lines.push("```bash");
  lines.push('bash install.sh --cwd "$PWD" --refresh-existing');
  lines.push("```");
  lines.push("3. Keep Copilot as the single active target for generated instructions, prompts, and skills.");
  lines.push("4. Treat `.github/ai-os/context/*.md` files as source-of-truth and update them after architectural changes.");
  lines.push("", "## Notes", "");
  lines.push("- This workflow is shell-driven (Git Bash + Node.js) and does not require Python runtime scripts.");
  lines.push("- Existing files are preserved in safe mode and updated intentionally in refresh mode.");
  const chartTotal = Math.max(1, totalArtifacts);
  lines.push("", "## Visual Artifact Breakdown", "");
  lines.push("```mermaid");
  lines.push("pie showData");
  lines.push("  title Existing AI Context Artifacts");
  lines.push(`  "instructions" : ${summary.counts.instructions}`);
  lines.push(`  "skills" : ${summary.counts.skills}`);
  lines.push(`  "prompts" : ${summary.counts.prompts}`);
  lines.push(`  "agents" : ${summary.counts.agents}`);
  lines.push(`  "docs" : ${summary.counts.docs}`);
  lines.push(`  "other" : ${summary.counts.other}`);
  if (chartTotal === 0) {
    lines.push('  "none" : 1');
  }
  lines.push("```");
  lines.push("");
  lines.push("_Open this file in VS Code Markdown Preview to view the diagram._");
  return lines.join("\n");
}
function generateStackDoc(stack) {
  const lines = [
    `# Tech Stack \u2014 ${stack.projectName}`,
    "",
    "## Languages",
    ""
  ];
  for (const lang of stack.languages) {
    lines.push(`- **${lang.name}** \u2014 ${lang.fileCount} files (${lang.percentage}%) | extensions: ${lang.extensions.map((e) => `.${e}`).join(", ")}`);
  }
  lines.push("", "## Frameworks & Libraries", "");
  if (stack.frameworks.length === 0) {
    lines.push(`- ${stack.primaryLanguage.name} (no framework detected)`);
  } else {
    for (const fw of stack.frameworks) {
      const version = fw.version ? ` v${fw.version}` : "";
      lines.push(`- **${fw.name}**${version} (${fw.category})`);
    }
  }
  lines.push("", "## Build & Tooling", "");
  lines.push(`- **Package Manager:** ${stack.patterns.packageManager}`);
  if (stack.patterns.bundler) lines.push(`- **Bundler:** ${stack.patterns.bundler}`);
  if (stack.patterns.linter) lines.push(`- **Linter:** ${stack.patterns.linter}`);
  if (stack.patterns.formatter) lines.push(`- **Formatter:** ${stack.patterns.formatter}`);
  if (stack.patterns.testFramework) lines.push(`- **Test Framework:** ${stack.patterns.testFramework}`);
  if (stack.patterns.ciCdProvider) lines.push(`- **CI/CD:** ${stack.patterns.ciCdProvider}`);
  lines.push(`- **TypeScript:** ${stack.patterns.hasTypeScript ? "Yes" : "No"}`);
  lines.push(`- **Docker:** ${stack.patterns.hasDockerfile ? "Yes" : "No"}`);
  lines.push(`- **Monorepo:** ${stack.patterns.monorepo ? "Yes" : "No"}`);
  lines.push("", "## Key Files", "");
  for (const f of stack.keyFiles) {
    lines.push(`- \`${f}\``);
  }
  if (stack.packageProfiles && stack.packageProfiles.length > 1) {
    lines.push("", "## Package Profiles (Per-Package Detection)", "");
    for (const profile of stack.packageProfiles) {
      const profileFrameworks = profile.frameworks.length > 0 ? profile.frameworks.map((fw) => fw.name).join(", ") : "none detected";
      const profileLangs = profile.languages.slice(0, 3).map((lang) => `${lang.name} ${lang.percentage}%`).join(", ") || "none detected";
      lines.push(`- **${profile.name}** at \`${profile.path}\``);
      lines.push(`  - Languages: ${profileLangs}`);
      lines.push(`  - Frameworks: ${profileFrameworks}`);
      lines.push(`  - Package manager: ${profile.patterns.packageManager}`);
      lines.push(`  - Build/Test: ${profile.patterns.bundler ?? "n/a"} / ${profile.patterns.testFramework ?? "n/a"}`);
    }
  }
  const parityTargets = ["JavaScript", "TypeScript", "Python", "Java", "Go", "Rust"];
  const detectedParity = stack.languages.map((lang) => lang.name).filter((name) => parityTargets.includes(name));
  if (detectedParity.length > 0) {
    lines.push("", "## MCP Parity Signals", "");
    lines.push(`- Detected language families for parity checks: ${detectedParity.join(", ")}`);
    lines.push("- Route discovery, package/build introspection, and env-convention scanning are enabled per detected stack.");
  }
  lines.push("", "## Visual Stack Map", "");
  lines.push("```mermaid");
  lines.push("flowchart LR");
  lines.push(`  Project["${formatNodeLabel(`Project: ${stack.projectName}`)}"]`);
  lines.push(`  Lang["${formatNodeLabel(`Languages: ${joinOrNone(stack.languages.map((lang) => lang.name))}`)}"]`);
  lines.push(`  Fw["${formatNodeLabel(`Frameworks: ${joinOrNone(stack.frameworks.map((fw) => fw.name))}`)}"]`);
  lines.push(`  Tooling["${formatNodeLabel(`Tooling: ${stack.patterns.packageManager}${stack.patterns.testFramework ? `, ${stack.patterns.testFramework}` : ""}`)}"]`);
  lines.push(`  Files["${formatNodeLabel(`Key files: ${Math.min(stack.keyFiles.length, 6)} shown in table`)}"]`);
  lines.push("  Project --> Lang");
  lines.push("  Project --> Fw");
  lines.push("  Project --> Tooling");
  lines.push("  Project --> Files");
  lines.push("```");
  lines.push("");
  lines.push("_Open this file in VS Code Markdown Preview to view the diagram._");
  return lines.join("\n");
}
function generateArchitectureDoc(stack) {
  const lines = [
    `# Architecture \u2014 ${stack.projectName}`,
    "",
    "> Auto-generated by AI OS. Update this file as the architecture evolves.",
    "",
    "## Project Type",
    ""
  ];
  const fw = stack.primaryFramework;
  if (fw) {
    lines.push(`**${fw.name}** (${fw.category}) project.`);
  } else {
    lines.push(`**${stack.primaryLanguage.name}** project.`);
  }
  lines.push("", "## Directory Structure", "");
  lines.push("```");
  try {
    const entries = fs9.readdirSync(stack.rootDir).filter((e) => !e.startsWith(".") && e !== "node_modules");
    for (const entry of entries.slice(0, 20)) {
      const stat = fs9.statSync(path10.join(stack.rootDir, entry));
      lines.push(stat.isDirectory() ? `${entry}/` : entry);
    }
  } catch {
    lines.push("(could not read directory)");
  }
  lines.push("```");
  lines.push("", "## Data Flow", "");
  if (fw?.name === "Next.js") {
    lines.push("```");
    lines.push("Browser \u2192 Next.js App Router \u2192 Server Components \u2192 DB/API");
    lines.push("       \u2198 Client Components \u2192 tRPC/fetch \u2192 API Routes \u2192 DB");
    lines.push("```");
  } else if (fw?.category === "backend") {
    lines.push("```");
    lines.push("Client \u2192 HTTP/REST \u2192 Controller \u2192 Service \u2192 Database");
    lines.push("```");
  } else if (fw?.category === "fullstack") {
    lines.push("```");
    lines.push("Browser \u2192 Routes/Pages \u2192 Server Logic \u2192 Database/API");
    lines.push("```");
  } else {
    lines.push("_Update this section with your actual data flow._");
  }
  lines.push("", "## Integration Points", "");
  lines.push("_List external services, APIs, and third-party integrations here._");
  lines.push("", "## Visual Architecture Overview", "");
  lines.push("```mermaid");
  lines.push("flowchart TD");
  lines.push(`  Repo["${formatNodeLabel(`Repository: ${stack.projectName}`)}"] --> Detect["Detect stack & patterns"]`);
  lines.push(`  Detect --> Lang["${formatNodeLabel(`Languages: ${joinOrNone(stack.languages.map((lang) => lang.name))}`)}"]`);
  lines.push(`  Detect --> Fw["${formatNodeLabel(`Frameworks: ${joinOrNone(stack.frameworks.map((fw2) => fw2.name))}`)}"]`);
  lines.push('  Detect --> Ctx["Scan existing AI context"]');
  lines.push('  Detect --> Graph["Build dependency graph"]');
  lines.push('  Detect --> Generate["Generate AI OS artifacts"]');
  lines.push('  Generate --> Docs[".github/ai-os/context/*.md"]');
  lines.push('  Generate --> Instr[".github/copilot-instructions.md"]');
  lines.push('  Generate --> MCP[".github/copilot/mcp.json + .ai-os/mcp-server/"]');
  lines.push('  Generate --> Agents[".github/agents/*.agent.md"]');
  lines.push('  Generate --> Skills[".github/copilot/skills/*.md"]');
  lines.push("```");
  lines.push("");
  lines.push("_Open this file in VS Code Markdown Preview to view the diagram._");
  return lines.join("\n");
}
function generateConventionsDoc(stack) {
  const lines = [
    `# Coding Conventions \u2014 ${stack.projectName}`,
    "",
    "> Auto-generated by AI OS. Update to reflect actual team agreements.",
    "",
    "## Naming Conventions",
    "",
    `- **General style:** ${stack.patterns.namingConvention}`
  ];
  if (stack.patterns.hasTypeScript) {
    lines.push("- **TypeScript interfaces:** PascalCase (e.g., `UserProfile`)");
    lines.push("- **Types/Enums:** PascalCase");
    lines.push("- **Variables/functions:** camelCase");
    lines.push("- **Constants:** SCREAMING_SNAKE_CASE");
  }
  if (stack.primaryFramework?.name === "Next.js" || stack.primaryFramework?.name === "React") {
    lines.push("- **React components:** PascalCase files + exports");
    lines.push("- **Hooks:** `use` prefix (e.g., `useAuth`, `useCart`)");
    lines.push("- **Event handlers:** `handle` prefix (e.g., `handleSubmit`)");
    lines.push("- **Boolean state:** `is`/`has`/`show` prefix (e.g., `isLoading`, `hasError`)");
  }
  lines.push("", "## File Structure Rules", "");
  if (stack.patterns.srcDirectory) {
    lines.push("- All source code lives under `src/`");
  }
  if (stack.patterns.testDirectory) {
    lines.push(`- Tests in \`${stack.patterns.testDirectory}/\``);
  }
  if (stack.patterns.linter) {
    lines.push(`- Linter: **${stack.patterns.linter}** \u2014 must pass before committing`);
  }
  if (stack.patterns.formatter) {
    lines.push(`- Formatter: **${stack.patterns.formatter}** \u2014 auto-format on save`);
  }
  lines.push("", "## Code Style", "");
  lines.push("- Prefer early returns over deep nesting");
  lines.push("- Validate all external inputs at API/form boundaries");
  lines.push("- Async/await over .then() chains");
  lines.push("- No commented-out code in commits");
  lines.push("- No secrets or credentials in source code");
  if (stack.patterns.testFramework) {
    lines.push("", "## Testing", "");
    lines.push(`- Framework: **${stack.patterns.testFramework}**`);
    lines.push("- Unit tests for all business logic");
    lines.push("- Integration tests for API endpoints");
    lines.push("- Never hit real external services in unit tests \u2014 mock them");
  }
  return lines.join("\n");
}
function generateMemoryDoc(stack) {
  const lines = [
    `# Memory Protocol \u2014 ${stack.projectName}`,
    "",
    "> Auto-generated by AI OS. Use this protocol to preserve stable project knowledge across long sessions.",
    "",
    "## Goals",
    "",
    "- Reduce hallucinations by reusing verified repo facts instead of re-deriving assumptions each turn",
    "- Keep core principles persistent across long feature branches and multi-day sessions",
    "- Capture decisions, constraints, and gotchas that are easy to forget",
    "",
    "## Memory Files",
    "",
    "- `.github/ai-os/memory/memory.jsonl` \u2014 append-only durable memory entries",
    "- `.github/ai-os/memory/README.md` \u2014 memory categories and usage rules",
    "",
    "## Agent Workflow",
    "",
    "1. MUST at task start: call `get_repo_memory` with relevant query/category before coding",
    "2. During implementation: avoid contradicting existing memory unless code evidence shows memory is stale",
    "3. MUST at task end: call `remember_repo_fact` only for verified durable findings (not transient details)",
    "",
    "## What To Store",
    "",
    "- Architecture invariants and boundaries",
    "- Non-obvious conventions and naming rules",
    "- Build/test commands that are validated and repeatable",
    "- Known pitfalls, migration gotchas, and failure modes",
    "- Conflict/supersession notes when prior memory must be replaced",
    "",
    "## What Not To Store",
    "",
    "- Secrets, credentials, or personal data",
    "- Ephemeral status updates or one-off debug outputs",
    "- Speculative guesses that were not verified from the codebase",
    "- Duplicate facts that restate existing memory without new evidence"
  ];
  return lines.join("\n");
}
function mergeSections(existing, updated) {
  if (!existing.trim()) return updated;
  const parseSections = (content) => {
    const sections = /* @__PURE__ */ new Map();
    let currentHeading = "__preamble__";
    let currentLines = [];
    for (const line of content.split("\n")) {
      if (line.startsWith("## ")) {
        sections.set(currentHeading, currentLines.join("\n"));
        currentHeading = line.slice(3).trim();
        currentLines = [line];
      } else {
        currentLines.push(line);
      }
    }
    sections.set(currentHeading, currentLines.join("\n"));
    return sections;
  };
  const existingSections = parseSections(existing);
  const updatedSections = parseSections(updated);
  const result = [updatedSections.get("__preamble__") ?? ""];
  for (const [heading, content] of updatedSections) {
    if (heading !== "__preamble__") result.push(content);
  }
  for (const [heading, content] of existingSections) {
    if (heading !== "__preamble__" && !updatedSections.has(heading)) result.push(content);
  }
  return result.join("\n");
}
function generateContextDocs(stack, outputDir) {
  const contextDir = path10.join(outputDir, ".github", "ai-os", "context");
  fs9.mkdirSync(contextDir, { recursive: true });
  const memoryDir = path10.join(outputDir, ".github", "ai-os", "memory");
  fs9.mkdirSync(memoryDir, { recursive: true });
  const managed = [];
  const track = (p) => {
    managed.push(p);
    return p;
  };
  const existingContext = detectExistingAiContext(outputDir);
  const legacyMemory = path10.join(outputDir, ".ai-os", "memory", "memory.jsonl");
  const newMemory = path10.join(memoryDir, "memory.jsonl");
  if (fs9.existsSync(legacyMemory) && !fs9.existsSync(newMemory)) {
    fs9.copyFileSync(legacyMemory, newMemory);
  }
  writeIfChanged(track(path10.join(contextDir, "stack.md")), generateStackDoc(stack));
  const archPath = track(path10.join(contextDir, "architecture.md"));
  const archGenerated = generateArchitectureDoc(stack);
  writeIfChanged(archPath, fs9.existsSync(archPath) ? mergeSections(fs9.readFileSync(archPath, "utf-8"), archGenerated) : archGenerated);
  const convsPath = track(path10.join(contextDir, "conventions.md"));
  const convsGenerated = generateConventionsDoc(stack);
  writeIfChanged(convsPath, fs9.existsSync(convsPath) ? mergeSections(fs9.readFileSync(convsPath, "utf-8"), convsGenerated) : convsGenerated);
  writeIfChanged(track(path10.join(contextDir, "memory.md")), generateMemoryDoc(stack));
  writeIfChanged(track(path10.join(contextDir, "existing-ai-context.md")), generateExistingAiContextDoc(stack, existingContext));
  const memoryReadmePath = track(path10.join(memoryDir, "README.md"));
  if (!fs9.existsSync(memoryReadmePath)) {
    writeIfChanged(
      memoryReadmePath,
      [
        "# AI OS Repository Memory",
        "",
        "- Durable memory lives in `memory.jsonl` as one JSON object per line.",
        "- Use categories: architecture, conventions, build, testing, security, pitfalls, decisions.",
        "- Keep entries concise, factual, and evidence-based."
      ].join("\n")
    );
  }
  const memoryFilePath = track(path10.join(memoryDir, "memory.jsonl"));
  if (!fs9.existsSync(memoryFilePath)) {
    const preambleEntries = [
      {
        id: "session-preamble-start-protocol",
        title: "Session Start Protocol",
        content: "On every new conversation, call get_session_context first to reload MUST-ALWAYS rules, build commands, and key file locations. Then call get_repo_memory and get_conventions before starting any task.",
        category: "conventions",
        tags: "session,always,startup",
        priority: "high",
        createdAt: (/* @__PURE__ */ new Date()).toISOString(),
        source: "ai-os-installer"
      },
      {
        id: "session-preamble-memory-workflow",
        title: "Memory Workflow \u2014 Always-On",
        content: "Before implementation: call get_repo_memory with a relevant query. After a substantial task: call remember_repo_fact only for verified durable findings. Never store speculative, duplicate, or transient notes.",
        category: "conventions",
        tags: "memory,always,session",
        priority: "high",
        createdAt: (/* @__PURE__ */ new Date()).toISOString(),
        source: "ai-os-installer"
      }
    ];
    fs9.writeFileSync(
      memoryFilePath,
      preambleEntries.map((e) => JSON.stringify(e)).join("\n") + "\n",
      "utf-8"
    );
  }
  const graph = buildDependencyGraph(outputDir);
  writeIfChanged(track(path10.join(contextDir, "dependency-graph.json")), JSON.stringify(graph, null, 2));
  const existingConfig = readAiOsConfig(outputDir);
  const config = {
    // Auto-detected fields (always refreshed)
    version: getToolVersion(),
    installedAt: existingConfig?.installedAt ?? (/* @__PURE__ */ new Date()).toISOString(),
    projectName: stack.projectName,
    primaryLanguage: stack.primaryLanguage.name,
    primaryFramework: stack.primaryFramework?.name ?? null,
    frameworks: stack.frameworks.map((f) => f.name),
    packageManager: stack.patterns.packageManager,
    hasTypeScript: stack.patterns.hasTypeScript,
    // User-editable fields (preserved from existing config, fall back to defaults)
    agentsMd: existingConfig?.agentsMd ?? DEFAULT_AI_OS_CONFIG.agentsMd,
    pathSpecificInstructions: existingConfig?.pathSpecificInstructions ?? DEFAULT_AI_OS_CONFIG.pathSpecificInstructions,
    recommendations: existingConfig?.recommendations ?? DEFAULT_AI_OS_CONFIG.recommendations,
    sessionContextCard: existingConfig?.sessionContextCard ?? DEFAULT_AI_OS_CONFIG.sessionContextCard,
    updateCheckEnabled: existingConfig?.updateCheckEnabled ?? DEFAULT_AI_OS_CONFIG.updateCheckEnabled,
    agentFlowMode: existingConfig?.agentFlowMode ?? DEFAULT_AI_OS_CONFIG.agentFlowMode,
    persistentRules: existingConfig?.persistentRules ?? DEFAULT_AI_OS_CONFIG.persistentRules,
    exclude: existingConfig?.exclude ?? DEFAULT_AI_OS_CONFIG.exclude
  };
  const aiOsDir = path10.join(outputDir, ".github", "ai-os");
  writeIfChanged(track(path10.join(aiOsDir, "config.json")), JSON.stringify(config, null, 2));
  if (config.sessionContextCard) {
    const sessionCardPath = track(path10.join(outputDir, ".github", "COPILOT_CONTEXT.md"));
    writeIfChanged(sessionCardPath, generateSessionContextCard(stack, config));
  }
  return managed;
}
function generateSessionContextCard(stack, config) {
  const fw = stack.primaryFramework?.name ?? stack.primaryLanguage.name;
  const pm = stack.patterns.packageManager;
  const isNode = ["npm", "yarn", "pnpm", "bun"].includes(pm);
  const buildCmd = isNode ? `${pm} run build` : pm === "go" ? "go build ./..." : pm === "cargo" ? "cargo build" : pm === "maven" ? "mvn package" : pm === "gradle" ? "./gradlew build" : "build";
  const testCmd = isNode ? `${pm} run test` : pm === "go" ? "go test ./..." : pm === "cargo" ? "cargo test" : pm === "maven" ? "mvn test" : pm === "gradle" ? "./gradlew test" : "test";
  const lintCmd = stack.patterns.linter ? isNode ? `${pm} run lint` : stack.patterns.linter : null;
  const rules = [
    `Use ${fw} conventions for all new code`,
    `Primary language: ${stack.primaryLanguage.name}${stack.patterns.hasTypeScript ? " with TypeScript" : ""}`,
    `Package manager: ${pm} \u2014 do not mix with others`,
    "Call get_repo_memory before starting any non-trivial task",
    "Call get_conventions before writing new code",
    "Call get_impact_of_change before editing any shared file"
  ];
  const allRules = [...config.persistentRules, ...rules].slice(0, 10);
  const keyFilesTable = stack.keyFiles.slice(0, 6).map((f) => `| \`${f}\` | key file |`).join("\n");
  return [
    "# Copilot Context \u2014 Quick Start",
    "",
    "> **If starting a new conversation**: call `get_session_context` before any task to reload all critical context.",
    "",
    "## MUST-ALWAYS Rules",
    "",
    ...allRules.map((r) => `- ${r}`),
    "",
    "## Build & Test",
    "",
    "```bash",
    `${buildCmd}   # build`,
    `${testCmd}   # test`,
    ...lintCmd ? [`${lintCmd}   # lint`] : [],
    "```",
    "",
    "## Key Files",
    "",
    "| File | Role |",
    "|------|------|",
    keyFilesTable,
    "",
    "## Session Restart Protocol",
    "",
    "1. Call `get_session_context` \u2192 reloads this card",
    "2. Call `get_repo_memory` \u2192 reloads durable decisions",
    "3. Call `get_conventions` \u2192 reloads coding rules"
  ].join("\n");
}

// src/generators/agents.ts
import * as fs10 from "fs";
import * as path11 from "path";
var AGENTS_DIR = ".github/agents";
function toBulletList(items) {
  if (items.length === 0) return "- _No items detected yet_";
  return items.map((item) => `- ${item}`).join("\n");
}
function buildFrameworkRules(stack) {
  const frameworkNames = stack.frameworks.map((f) => f.name.toLowerCase());
  const rules = [];
  if (frameworkNames.some((name) => name.includes("next"))) {
    rules.push("- Keep Server Components as default and isolate client-only code behind `'use client'` boundaries");
    rules.push("- Route handlers should validate input and return typed JSON responses");
  }
  if (frameworkNames.some((name) => name.includes("react"))) {
    rules.push("- Keep components focused; extract data and business logic to hooks/util modules");
  }
  if (stack.patterns.hasTypeScript) {
    rules.push("- Keep strict typing; avoid `any` unless there is a documented boundary reason");
  }
  if (rules.length === 0) {
    rules.push("- Follow conventions from `.github/ai-os/context/conventions.md` for naming, structure, and safety checks");
  }
  return rules.join("\n");
}
function buildAgentSpecs(stack, cwd) {
  const specs = [];
  const projectName = path11.basename(cwd);
  const frameworks = stack.frameworks.map((f) => f.name);
  const packages = stack.allDependencies;
  const primaryLang = stack.languages[0]?.name ?? "TypeScript";
  const hasPrisma = packages.some((p) => p.includes("prisma"));
  const hasAuth = packages.some((p) => ["next-auth", "nextauth", "passport", "django.contrib.auth", "flask-login"].some((a) => p.toLowerCase().includes(a)));
  const hasStripe = packages.some((p) => p.toLowerCase().includes("stripe"));
  const hasNextjs = frameworks.some((f) => f.toLowerCase().includes("next"));
  const hasReact = frameworks.some((f) => ["react", "next", "remix", "gatsby"].some((k) => f.toLowerCase().includes(k)));
  const primaryFramework = frameworks[0] ?? primaryLang;
  const frameworkLabel = hasNextjs ? "Next.js" : primaryFramework;
  const frameworkList = frameworks.length > 0 ? frameworks.join(", ") : primaryLang;
  const stackSummary = [
    `Primary language: ${primaryLang}`,
    `Frameworks: ${frameworkList}`,
    `Package manager: ${stack.patterns.packageManager}`,
    `TypeScript: ${stack.patterns.hasTypeScript ? "Yes" : "No"}`
  ];
  const keyFiles = [
    "src/trpc/index.ts",
    "src/lib/vector-store.ts",
    "src/app/api/chat/route.ts",
    "src/components/ChatInterface.tsx",
    "prisma/schema.prisma"
  ].filter((f) => fs10.existsSync(path11.join(cwd, f)));
  const keyFilesList = toBulletList(keyFiles.map((file) => `\`${file}\``));
  const keyEntryPoints = toBulletList((keyFiles.slice(0, 4).length > 0 ? keyFiles.slice(0, 4) : ["src/"]).map((file) => `\`${file}\``));
  const runtimeDir = path11.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1"));
  const templateDir = path11.join(resolveTemplatesDir(runtimeDir), "agents");
  specs.push({
    templateFile: path11.join(templateDir, "repo-initializer.md"),
    outputFile: `${projectName.toLowerCase().replace(/[^a-z0-9-]/g, "-")}-initializer.agent.md`,
    name: `${projectName} Initializer`,
    description: `Maintain and evolve the AI framework artifacts for the ${projectName} repo (docs, skills, prompts) using the real ${frameworkLabel} stack.`,
    argumentHint: 'What artifact to update or create (e.g. "update skills", "add agent for auth")',
    replacements: {
      "{{PROJECT_NAME}}": projectName,
      "{{FRAMEWORK}}": frameworkLabel,
      "{{FRAMEWORK_LIST}}": frameworkList,
      "{{CONVENTIONS_FILE}}": ".github/ai-os/context/conventions.md",
      "{{STACK_FILE}}": ".github/ai-os/context/stack.md",
      "{{ARCHITECTURE_FILE}}": ".github/ai-os/context/architecture.md",
      "{{CONVENTIONS_SUMMARY}}": toBulletList([
        "Treat `.github/ai-os/context/conventions.md` as source of truth for naming and structure",
        "Prefer safe, incremental edits with clear rollback points",
        "Refresh AI artifacts after architecture or workflow changes"
      ])
    }
  });
  specs.push({
    templateFile: path11.join(templateDir, "framework-expert.md"),
    outputFile: `expert-${frameworkLabel.toLowerCase().replace(/[^a-z0-9]/g, "-")}-developer.agent.md`,
    name: `Expert ${frameworkLabel} Developer`,
    description: `Expert ${frameworkLabel} developer specializing in ${primaryLang} patterns for ${projectName}.`,
    argumentHint: "Describe the feature, bug or refactor you need help with",
    replacements: {
      "{{PROJECT_NAME}}": projectName,
      "{{FRAMEWORK}}": frameworkLabel,
      "{{STACK_SUMMARY}}": toBulletList(stackSummary),
      "{{KEY_FILES_LIST}}": keyFilesList,
      "{{CONVENTIONS_FILE}}": ".github/ai-os/context/conventions.md",
      "{{ARCHITECTURE_FILE}}": ".github/ai-os/context/architecture.md",
      "{{STACK_FILE}}": ".github/ai-os/context/stack.md",
      "{{BUILD_COMMAND}}": stack.patterns.packageManager === "npm" ? "npm run build" : `${stack.patterns.packageManager} build`,
      "{{FRAMEWORK_RULES}}": buildFrameworkRules(stack)
    }
  });
  specs.push({
    templateFile: path11.join(templateDir, "codebase-explorer.md"),
    outputFile: "codebase-explorer.agent.md",
    name: "Codebase Explorer",
    description: `Read-only navigator for ${projectName} \u2014 answers "how does X work?" questions.`,
    argumentHint: 'Ask about any feature, file, or pattern (e.g. "how does auth work?")',
    replacements: {
      "{{PROJECT_NAME}}": projectName,
      "{{STACK_SUMMARY}}": toBulletList(stackSummary),
      "{{KEY_ENTRY_POINTS}}": keyEntryPoints
    }
  });
  if (hasPrisma) {
    const schemaFile = fs10.existsSync(path11.join(cwd, "prisma/schema.prisma")) ? "prisma/schema.prisma" : "schema.prisma";
    specs.push({
      templateFile: path11.join(templateDir, "db-expert.md"),
      outputFile: "expert-database.agent.md",
      name: "Database Expert",
      description: `Prisma ORM expert for ${projectName} \u2014 schema design, migrations, query optimization.`,
      argumentHint: "Describe the DB change, schema question, or query you need",
      replacements: {
        "{{PROJECT_NAME}}": projectName,
        "{{ORM}}": "Prisma",
        "{{DATABASE}}": "PostgreSQL (Supabase)",
        "{{SCHEMA_FILE}}": schemaFile,
        "{{MIGRATIONS_DIR}}": "prisma/migrations",
        "{{STACK_SUMMARY}}": toBulletList(stackSummary),
        "{{MIGRATE_COMMAND}}": "npx prisma migrate dev --name <name>",
        "{{GENERATE_COMMAND}}": "npx prisma generate",
        "{{RAW_SQL_FILE}}": "src/server/db/raw-sql.ts"
      }
    });
  }
  if (hasAuth) {
    const authProvider = hasAuth && packages.some((p) => p.includes("next-auth")) ? "NextAuth.js" : "Auth";
    const authFile = "src/app/api/auth/[...nextauth]/authOptions.ts";
    specs.push({
      templateFile: path11.join(templateDir, "auth-expert.md"),
      outputFile: "expert-auth.agent.md",
      name: "Auth Expert",
      description: `${authProvider} expert for ${projectName} \u2014 providers, sessions, route protection.`,
      argumentHint: "Describe the auth feature, provider, or protection you need",
      replacements: {
        "{{PROJECT_NAME}}": projectName,
        "{{AUTH_PROVIDER}}": authProvider,
        "{{AUTH_STRATEGY}}": "JWT",
        "{{AUTH_CONFIG_FILE}}": authFile,
        "{{AUTH_SESSION_HELPER}}": "getServerSession() from src/lib/auth.ts",
        "{{AUTH_DESCRIPTION}}": toBulletList([
          "Server routes and protected pages read identity from the validated session only",
          "Authorization checks must happen on the server boundary before data access",
          "Provider setup and callback behavior should remain centralized in the auth config file"
        ])
      }
    });
  }
  if (hasStripe) {
    const plansFile = fs10.existsSync(path11.join(cwd, "src/constants/stripe.ts")) ? "src/constants/stripe.ts" : "src/lib/stripe.ts";
    specs.push({
      templateFile: path11.join(templateDir, "payments-expert.md"),
      outputFile: "expert-payments.agent.md",
      name: "Payments Expert",
      description: `Stripe billing expert for ${projectName} \u2014 subscriptions, webhooks, plan enforcement.`,
      argumentHint: "Describe the billing feature, webhook, or plan change you need",
      replacements: {
        "{{PROJECT_NAME}}": projectName,
        "{{PAYMENT_PROVIDER}}": "Stripe",
        "{{PLANS_FILE}}": plansFile,
        "{{WEBHOOK_FILE}}": "src/app/api/webhooks/stripe/route.ts",
        "{{STRIPE_LIB_FILE}}": "src/lib/stripe.ts",
        "{{CHECKOUT_PROCEDURE}}": "createCheckoutSession / createBillingPortalSession",
        "{{BILLING_DESCRIPTION}}": toBulletList([
          "Plan metadata is source-of-truth for feature gating",
          "Webhook processing updates subscription state in persistent storage",
          "Checkout and billing portal links should be generated server-side only"
        ])
      }
    });
  }
  return specs;
}
function scanExistingAgents(cwd) {
  const agentsDir = path11.join(cwd, AGENTS_DIR);
  if (!fs10.existsSync(agentsDir)) return { userDefined: [], aiOsGenerated: [] };
  const files = fs10.readdirSync(agentsDir).filter((f) => f.endsWith(".md") || f.endsWith(".agent.md"));
  const userDefined = [];
  const aiOsGenerated = [];
  for (const file of files) {
    const content = fs10.readFileSync(path11.join(agentsDir, file), "utf-8");
    const isAiOs = content.includes("ai-os/context/architecture.md") || content.includes("ai-os/context/conventions.md") || content.includes("ai-os/context/stack.md");
    if (isAiOs) {
      aiOsGenerated.push(file);
    } else {
      userDefined.push(file);
    }
  }
  return { userDefined, aiOsGenerated };
}
function buildSequentialAgentSpecs(stack, cwd) {
  const specs = [];
  const projectName = path11.basename(cwd);
  const frameworks = stack.frameworks.map((f) => f.name);
  const primaryLang = stack.languages[0]?.name ?? "TypeScript";
  const frameworkLabel = frameworks[0] ?? primaryLang;
  const frameworkList = frameworks.length > 0 ? frameworks.join(", ") : primaryLang;
  const runtimeDir = path11.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1"));
  const templateDir = path11.join(resolveTemplatesDir(runtimeDir), "agents");
  const stackSummary = [
    `Primary language: ${primaryLang}`,
    `Frameworks: ${frameworkList}`,
    `Package manager: ${stack.patterns.packageManager}`,
    `TypeScript: ${stack.patterns.hasTypeScript ? "Yes" : "No"}`
  ];
  const keyFiles = [
    "src/trpc/index.ts",
    "src/lib/vector-store.ts",
    "src/app/api/chat/route.ts",
    "prisma/schema.prisma"
  ].filter((f) => fs10.existsSync(path11.join(cwd, f)));
  const keyFilesList = keyFiles.length > 0 ? keyFiles.map((f) => `- \`${f}\``).join("\n") : "- _No key files detected yet_";
  const buildCmd = stack.patterns.packageManager === "npm" ? "npm run build" : stack.patterns.packageManager === "pnpm" ? "pnpm build" : stack.patterns.packageManager === "yarn" ? "yarn build" : stack.patterns.packageManager === "bun" ? "bun run build" : stack.patterns.packageManager === "maven" ? "mvn compile" : stack.patterns.packageManager === "gradle" ? "gradle build" : stack.patterns.packageManager === "go" ? "go build ./..." : stack.patterns.packageManager === "cargo" ? "cargo build" : "npm run build";
  const testCmd = stack.buildCommands?.test ?? (stack.patterns.packageManager === "npm" ? "npm test" : stack.patterns.packageManager === "pnpm" ? "pnpm test" : stack.patterns.packageManager === "yarn" ? "yarn test" : stack.patterns.packageManager === "bun" ? "bun test" : stack.patterns.packageManager === "maven" ? "mvn test" : stack.patterns.packageManager === "gradle" ? "gradle test" : stack.patterns.packageManager === "go" ? "go test ./..." : stack.patterns.packageManager === "cargo" ? "cargo test" : "npm test");
  const regenerateCmd = stack.patterns.packageManager === "npm" ? "npx ai-os" : stack.patterns.packageManager === "pnpm" ? "pnpm dlx ai-os" : stack.patterns.packageManager === "bun" ? "bunx ai-os" : "npx ai-os";
  const commonReplacements = {
    "{{PROJECT_NAME}}": projectName,
    "{{FRAMEWORK}}": frameworkLabel,
    "{{STACK_SUMMARY}}": stackSummary.map((s) => `- ${s}`).join("\n"),
    "{{KEY_FILES_LIST}}": keyFilesList,
    "{{FRAMEWORK_RULES}}": buildFrameworkRules(stack),
    "{{BUILD_COMMAND}}": buildCmd,
    "{{TEST_COMMAND}}": testCmd,
    "{{REGENERATE_COMMAND}}": regenerateCmd
  };
  specs.push({
    templateFile: path11.join(templateDir, "enhancement-advisor.md"),
    outputFile: "feature-enhancement-advisor.agent.md",
    name: `${projectName} \u2014 Feature Enhancement Advisor`,
    description: `Scan ${projectName} for improvement opportunities and expansion ideas. Use when you want prioritized enhancements, gap analysis, roadmap proposals, and concrete implementation recommendations for this repository only.`,
    argumentHint: "Describe scope (e.g. reliability, DX, CI/CD, security, performance) and depth (quick/medium/deep).",
    replacements: commonReplacements
  });
  specs.push({
    templateFile: path11.join(templateDir, "idea-validator.md"),
    outputFile: "idea-validator.agent.md",
    name: `${projectName} \u2014 Idea Validator`,
    description: `Validates enhancement recommendations from the Feature Enhancement Advisor against actual codebase reality. Use after the Enhancement Advisor produces a report \u2014 before any implementation begins.`,
    argumentHint: "Paste the Enhancement Advisor numbered report here, or describe the finding(s) to validate.",
    replacements: commonReplacements
  });
  specs.push({
    templateFile: path11.join(templateDir, "implementation-agent.md"),
    outputFile: "implementation-agent.agent.md",
    name: `${projectName} \u2014 Implementation Agent`,
    description: `Executes the Approved Work Order produced by the Idea Validator. Implements changes in dependency-safe sequence. Use only after the Idea Validator has produced a verified Approved Work Order.`,
    argumentHint: "Paste the Approved Work Order from the Idea Validator, or name a specific item to implement.",
    replacements: commonReplacements
  });
  return specs;
}
function injectReplacements(template, replacements) {
  let result = template;
  for (const [key, value] of Object.entries(replacements)) {
    result = result.replaceAll(key, value);
  }
  return result;
}
async function generateAgentsWithOptions(stack, cwd, options) {
  const agentsDir = path11.join(cwd, AGENTS_DIR);
  fs10.mkdirSync(agentsDir, { recursive: true });
  const existingFiles = fs10.existsSync(agentsDir) ? fs10.readdirSync(agentsDir).map((f) => f.toLowerCase()) : [];
  function conceptCovered(keywords) {
    return existingFiles.some((f) => keywords.some((k) => f.includes(k)));
  }
  const agentFlowMode = options.config?.agentFlowMode ?? "create";
  const specs = [
    ...buildAgentSpecs(stack, cwd),
    ...agentFlowMode === "create" ? buildSequentialAgentSpecs(stack, cwd) : []
  ];
  const sequentialFlowFiles = /* @__PURE__ */ new Set([
    "feature-enhancement-advisor.agent.md",
    "idea-validator.agent.md",
    "implementation-agent.agent.md"
  ]);
  const generated = [];
  for (const spec of specs) {
    const outputPath = path11.join(agentsDir, spec.outputFile);
    if (fs10.existsSync(outputPath) && !options.refreshExisting) continue;
    if (!options.refreshExisting) {
      if (sequentialFlowFiles.has(spec.outputFile)) {
      } else {
        const baseKeywords = spec.outputFile.replace(".agent.md", "").split("-").filter((w) => w.length > 3);
        if (conceptCovered(baseKeywords)) continue;
      }
    }
    if (!fs10.existsSync(spec.templateFile)) {
      console.warn(`  \u26A0 Agent template not found: ${spec.templateFile}`);
      continue;
    }
    let content = fs10.readFileSync(spec.templateFile, "utf-8");
    content = content.replace(/^name:.*$/m, `name: ${spec.name}`).replace(/^description:.*$/m, `description: ${spec.description}`).replace(/^argument-hint:.*$/m, `argument-hint: "${spec.argumentHint}"`);
    if (spec.model) {
      content = content.replace(/^model:.*$/m, `model: ${spec.model}`);
    }
    content = injectReplacements(content, spec.replacements);
    const unresolved = content.match(/\{\{[^}]+\}\}/g);
    if (unresolved && unresolved.length > 0) {
      console.warn(`  \u26A0 Unresolved placeholders in ${spec.outputFile}: ${Array.from(new Set(unresolved)).join(", ")} \u2014 removing`);
      content = applyFallbacks(content);
    }
    writeIfChanged(outputPath, content);
    generated.push(outputPath);
  }
  return generated;
}
async function generateAgents(stack, cwd, options) {
  return generateAgentsWithOptions(stack, cwd, {
    refreshExisting: options?.refreshExisting ?? false,
    config: options?.config
  });
}

// src/generators/skills.ts
import * as fs11 from "fs";
import * as path12 from "path";
var SKILLS_DIR = ".github/copilot/skills";
var AGENTS_SKILLS_DIR = ".agents/skills";
function buildSkillSpecs(stack, cwd) {
  const specs = [];
  const projectName = path12.basename(cwd);
  const frameworks = stack.frameworks.map((f) => f.name.toLowerCase());
  const packages = stack.allDependencies;
  const hasExpressLike = frameworks.some((f) => ["express", "fastify", "hono", "koa", "nest"].some((x) => f.includes(x)));
  const hasJavaSpringLike = frameworks.some((f) => ["spring", "quarkus", "micronaut", "java"].some((x) => f.includes(x)));
  const templateDir = path12.join(resolveTemplatesDir(path12.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1"))), "skills");
  const add = (template, output, replacements = {}) => {
    const templatePath = path12.join(templateDir, template);
    if (fs11.existsSync(templatePath)) {
      specs.push({
        templateFile: templatePath,
        outputFile: output,
        replacements: { "{{PROJECT_NAME}}": projectName, ...replacements }
      });
    }
  };
  if (frameworks.some((f) => f.includes("next"))) {
    add("nextjs.md", "ai-os-nextjs-patterns.md");
  }
  if (frameworks.some((f) => f.includes("react")) && !frameworks.some((f) => f.includes("next"))) {
    add("react.md", "ai-os-react-patterns.md");
  }
  if (packages.includes("@trpc/server") || packages.includes("trpc")) {
    const trpcRouterFile = fs11.existsSync(path12.join(cwd, "src/trpc/index.ts")) ? "src/trpc/index.ts" : "src/server/trpc.ts";
    add("trpc.md", "ai-os-trpc-patterns.md", { "{{TRPC_ROUTER_FILE}}": trpcRouterFile });
  }
  if (packages.includes("prisma") || packages.includes("@prisma/client")) {
    const schemaFile = fs11.existsSync(path12.join(cwd, "prisma/schema.prisma")) ? "prisma/schema.prisma" : "schema.prisma";
    add("prisma.md", "ai-os-prisma-patterns.md", { "{{SCHEMA_FILE}}": schemaFile });
  }
  if (packages.includes("stripe")) {
    const plansFile = fs11.existsSync(path12.join(cwd, "src/constants/stripe.ts")) ? "src/constants/stripe.ts" : "src/lib/stripe.ts";
    add("stripe.md", "ai-os-billing-stripe.md", {
      "{{PLANS_FILE}}": plansFile,
      "{{STRIPE_LIB_FILE}}": fs11.existsSync(path12.join(cwd, "src/lib/stripe.ts")) ? "src/lib/stripe.ts" : plansFile,
      "{{WEBHOOK_FILE}}": "src/app/api/webhooks/stripe/route.ts"
    });
  }
  if (packages.includes("next-auth") || packages.includes("nextauth")) {
    const authFile = fs11.existsSync(path12.join(cwd, "src/app/api/auth/[...nextauth]/authOptions.ts")) ? "src/app/api/auth/[...nextauth]/authOptions.ts" : "src/lib/auth.ts";
    add("auth-nextauth.md", "ai-os-auth-flow.md", { "{{AUTH_CONFIG_FILE}}": authFile });
  }
  if (packages.includes("@supabase/supabase-js")) {
    add("supabase.md", "ai-os-supabase-patterns.md");
  }
  if (packages.includes("langchain") || packages.includes("@langchain/community") || packages.includes("pgvector")) {
    add("rag-pgvector.md", "ai-os-rag-pipeline.md");
  }
  if (hasExpressLike) {
    add("express.md", "ai-os-express-api.md");
  }
  if (frameworks.some((f) => f.includes("fastapi") || f.includes("django"))) {
    add("python-fastapi.md", "ai-os-fastapi-patterns.md");
  }
  if (stack.languages.some((l) => l.name.toLowerCase() === "go")) {
    add("go.md", "ai-os-go-patterns.md");
  }
  if (hasJavaSpringLike) {
    add("java-spring.md", "ai-os-java-spring-patterns.md");
  }
  if (frameworks.some((f) => f.includes("remix"))) {
    add("remix.md", "ai-os-remix-patterns.md");
  }
  if (frameworks.some((f) => f.includes("solid"))) {
    add("solid.md", "ai-os-solid-patterns.md");
  }
  if (frameworks.some((f) => f === "bun") || packages.includes("bun")) {
    add("bun.md", "ai-os-bun-patterns.md");
  }
  if (frameworks.some((f) => f === "deno")) {
    add("deno.md", "ai-os-deno-patterns.md");
  }
  return specs;
}
async function generateSkillsWithOptions(stack, cwd, options) {
  const skillsDir = path12.join(cwd, SKILLS_DIR);
  fs11.mkdirSync(skillsDir, { recursive: true });
  const specs = buildSkillSpecs(stack, cwd);
  const generatedPaths = [];
  for (const spec of specs) {
    const outputPath = path12.join(skillsDir, spec.outputFile);
    if (fs11.existsSync(outputPath) && !options.refreshExisting) {
      generatedPaths.push(outputPath);
      continue;
    }
    let content = fs11.readFileSync(spec.templateFile, "utf-8");
    for (const [key, value] of Object.entries(spec.replacements)) {
      content = content.replaceAll(key, value);
    }
    writeIfChanged(outputPath, content);
    generatedPaths.push(outputPath);
  }
  if (options.refreshExisting && fs11.existsSync(skillsDir)) {
    const currentSet = new Set(generatedPaths.map((p) => path12.basename(p)));
    const onDisk = fs11.readdirSync(skillsDir).filter((f) => f.startsWith("ai-os-") && f.endsWith(".md"));
    for (const stale of onDisk) {
      if (!currentSet.has(stale)) {
        fs11.rmSync(path12.join(skillsDir, stale));
        console.log(`  \u{1F5D1}\uFE0F  Pruned stale skill: ${stale}`);
      }
    }
  }
  return generatedPaths;
}
async function generateSkills(stack, cwd, options) {
  return generateSkillsWithOptions(stack, cwd, { refreshExisting: options?.refreshExisting ?? false });
}
var BUNDLED_SKILLS = [
  { dirName: "skill-creator", label: "skill-creator" }
];
function getBundledSkillSourceDir(dirName) {
  return new URL(`../../${dirName}`, import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1");
}
async function deployBundledSkills(cwd, options) {
  const deployed = [];
  for (const skill of BUNDLED_SKILLS) {
    const sourceDir = getBundledSkillSourceDir(skill.dirName);
    const targetDir = path12.join(cwd, AGENTS_SKILLS_DIR, skill.dirName);
    if (!fs11.existsSync(sourceDir)) {
      continue;
    }
    if (fs11.existsSync(targetDir) && !options?.refreshExisting) {
      continue;
    }
    fs11.mkdirSync(path12.join(cwd, AGENTS_SKILLS_DIR), { recursive: true });
    fs11.cpSync(sourceDir, targetDir, { recursive: true, force: true });
    deployed.push(skill.label);
  }
  return deployed;
}

// src/generators/prompts.ts
import * as fs12 from "fs";
import * as path13 from "path";
var PROMPTS_FILE = ".github/copilot/prompts.json";
function buildPrompts(stack, cwd) {
  const prompts = [];
  const frameworks = stack.frameworks.map((f) => f.name.toLowerCase());
  const packages = stack.allDependencies;
  const hasNext = frameworks.some((f) => f.includes("next"));
  const hasNuxt = frameworks.some((f) => f.includes("nuxt"));
  const hasVue = frameworks.some((f) => f.includes("vue"));
  const hasAngular = frameworks.some((f) => f.includes("angular"));
  const hasAstro = frameworks.some((f) => f.includes("astro"));
  const hasNest = frameworks.some((f) => f.includes("nest"));
  const hasExpressLike = frameworks.some((f) => ["express", "fastify", "hono", "koa"].some((x) => f.includes(x)));
  const hasFastApi = frameworks.some((f) => f.includes("fastapi"));
  const hasDjango = frameworks.some((f) => f.includes("django"));
  const hasLaravel = frameworks.some((f) => f.includes("laravel"));
  const hasSpring = frameworks.some((f) => f.includes("spring"));
  const hasDotnet = frameworks.some((f) => f.includes(".net") || f.includes("asp.net"));
  const hasTrpc = packages.includes("@trpc/server") || packages.includes("trpc");
  const hasPrisma = packages.includes("prisma") || packages.includes("@prisma/client");
  const hasStripe = packages.includes("stripe");
  const hasAuth = packages.includes("next-auth") || packages.includes("nextauth");
  const hasVector = packages.some((p) => p.includes("langchain") || p.includes("pgvector"));
  if (hasNext) {
    prompts.push({
      id: "/new-page",
      title: "New App Router Page",
      description: "Create a new Next.js App Router page with auth guard",
      prompt: `Create a new Next.js 15 App Router page at the path I specify.
Requirements:
- Server Component by default (no 'use client' unless needed)
- Guard with getServerSession() \u2192 redirect to /auth/signin if no session
- Pass any data to a Client Component child only if interactivity is needed
- Use TypeScript strict types
- Follow the project conventions in .github/ai-os/context/conventions.md`
    });
    prompts.push({
      id: "/new-api-route",
      title: "New API Route",
      description: "Create a Next.js API route handler",
      prompt: `Create a new Next.js API route handler at the path I specify.
Requirements:
- Use NextRequest / NextResponse
- Validate auth with getServerSession() \u2192 return 401 if missing
- Parse and validate request body with Zod (create schema in src/validators/ if needed)
- Return structured JSON responses
- Use try/catch and return appropriate HTTP status codes
- Do NOT create an API route for data that can be a tRPC procedure`
    });
  }
  if (hasNuxt || hasVue) {
    prompts.push({
      id: "/new-vue-page",
      title: "New Vue/Nuxt Page",
      description: "Create a new Vue or Nuxt page/component with typed props and data flow",
      prompt: `Create a new ${hasNuxt ? "Nuxt page" : "Vue page/component"} at the path I specify.
Requirements:
- Use script setup with TypeScript
- Keep page-level data fetching in a composable/service, not in deeply nested components
- Validate route params and external data shapes
- Keep component state minimal and derive where possible
- Follow the conventions in .github/ai-os/context/conventions.md`
    });
  }
  if (hasAngular) {
    prompts.push({
      id: "/new-angular-feature",
      title: "New Angular Feature",
      description: "Create a feature module/standalone component with typed service integration",
      prompt: `Create a new Angular feature (standalone component + service) at the path I specify.
Requirements:
- Use strict TypeScript typing and typed HttpClient responses
- Put business logic in services, keep components focused on presentation
- Use reactive forms for non-trivial form inputs
- Add guard/interceptor wiring if auth is required
- Follow naming and structure conventions from .github/ai-os/context/conventions.md`
    });
  }
  if (hasAstro) {
    prompts.push({
      id: "/new-astro-page",
      title: "New Astro Page",
      description: "Create a new Astro page with islands only where interactivity is required",
      prompt: `Create a new Astro page at the path I specify.
Requirements:
- Keep content/server rendering first; only hydrate islands where necessary
- Use typed frontmatter and validate external inputs
- Extract reusable UI into components and data loaders into utility modules
- Ensure route and file naming follow project conventions`
    });
  }
  if (hasNest || hasExpressLike) {
    prompts.push({
      id: "/new-backend-endpoint",
      title: "New Backend Endpoint",
      description: "Create a typed backend endpoint with validation, auth boundary checks, and service layer",
      prompt: `Create a new backend endpoint at the path I specify.
Requirements:
- Validate input payload and params with Zod or framework-native validation
- Keep controller/route handlers thin and delegate business logic to services
- Enforce auth/authorization at the boundary
- Return consistent error response shapes and status codes
- Add unit/integration test scaffolding for happy path + validation failure`
    });
  }
  if (hasFastApi) {
    prompts.push({
      id: "/new-fastapi-route",
      title: "New FastAPI Route",
      description: "Create an async FastAPI route with Pydantic models and service delegation",
      prompt: `Create a new FastAPI route in the module I specify.
Requirements:
- Use async handlers and Pydantic request/response schemas
- Keep endpoint logic thin; move business rules into services
- Add explicit HTTPException handling for expected error paths
- Include pytest test skeleton with AsyncClient`
    });
  }
  if (hasDjango) {
    prompts.push({
      id: "/new-django-api",
      title: "New Django API Endpoint",
      description: "Create a Django endpoint with serializer/form validation and scoped query logic",
      prompt: `Create a new Django API endpoint at the location I specify.
Requirements:
- Validate request data with serializers/forms
- Keep DB access scoped to the authenticated user when applicable
- Keep business logic out of views and in services/managers
- Add tests for authorization, validation, and success responses`
    });
  }
  if (hasLaravel) {
    prompts.push({
      id: "/new-laravel-endpoint",
      title: "New Laravel Endpoint",
      description: "Create a new Laravel API endpoint with Form Request validation and service-layer logic",
      prompt: `Create a new Laravel API endpoint and wire it in routes/api.php.
Requirements:
- Use Form Request classes for validation
- Keep controller actions thin and move domain logic to services
- Enforce auth/policy checks before data mutation
- Add feature tests for success and validation errors`
    });
  }
  if (hasSpring) {
    prompts.push({
      id: "/new-spring-endpoint",
      title: "New Spring Endpoint",
      description: "Create a Spring REST endpoint with DTO validation and service abstraction",
      prompt: `Create a new Spring Boot REST endpoint.
Requirements:
- Use DTOs with bean validation annotations
- Keep controller thin and delegate to service classes
- Map domain exceptions to appropriate HTTP status responses
- Add a unit test (service) and web layer test (controller) skeleton`
    });
  }
  if (hasDotnet) {
    prompts.push({
      id: "/new-dotnet-endpoint",
      title: "New .NET Endpoint",
      description: "Create an ASP.NET Core endpoint with validation and service-layer boundaries",
      prompt: `Create a new ASP.NET Core endpoint.
Requirements:
- Use request/response DTOs and model validation
- Keep endpoint/controller minimal; push business logic into services
- Enforce authorization attributes/policies where required
- Add test skeletons for validation and successful execution`
    });
  }
  if (hasTrpc) {
    prompts.push({
      id: "/new-trpc-procedure",
      title: "New tRPC Procedure",
      description: "Add a new tRPC query or mutation to src/trpc/index.ts",
      prompt: `Add a new tRPC procedure to src/trpc/index.ts.
Requirements:
- Use privateProcedure if it requires auth (most cases), publicProcedure only if explicitly public
- Validate input with Zod (.input(z.object({...})))
- Always scope DB queries by ctx.userId
- Throw TRPCError with appropriate code on failures
- Add any new validators to src/validators/
- Also show me the client usage pattern (trpc.<name>.useQuery / useMutation)`
    });
  }
  if (hasPrisma) {
    prompts.push({
      id: "/new-model",
      title: "New Prisma Model",
      description: "Add a new Prisma model to schema.prisma + generate migration",
      prompt: `Add a new Prisma model to the schema.
Requirements:
- Add to prisma/schema.prisma with proper types, relations, and @@map for snake_case table names
- Include id (cuid), createdAt, updatedAt fields
- Add any necessary indexes with @@index
- Show me the migration command: npx prisma migrate dev --name <name>
- Show me any new tRPC procedures or API routes needed to expose the model
- Follow the existing model patterns in the schema`
    });
  }
  if (hasStripe) {
    prompts.push({
      id: "/add-plan",
      title: "Add Subscription Plan",
      description: "Add a new Stripe subscription plan tier",
      prompt: `Add a new subscription plan tier to the project.
Requirements:
- Add to src/constants/stripe.ts with appropriate limits (quota, maxFileSizeMb, messageLimit)
- Create the product/price in Stripe dashboard and update the price ID
- Update getUserSubscriptionPlan() in src/lib/stripe.ts if plan lookup logic changes
- Show me which enforcement points need updating (upload route, chat route, etc.)
- Show me any UI changes needed in the pricing page`
    });
  }
  if (hasAuth) {
    prompts.push({
      id: "/add-oauth",
      title: "Add OAuth Provider",
      description: "Add a new OAuth provider to NextAuth.js",
      prompt: `Add a new OAuth provider to the NextAuth.js config.
Requirements:
- Add provider to src/app/api/auth/[...nextauth]/authOptions.ts
- Use conditional inclusion if env vars are present (so app works without the provider set)
- List the required environment variables to add to .env.local
- Show the OAuth app callback URL to configure in the provider dashboard
- Ensure user is upserted in the signIn callback with the provider's data`
    });
  }
  if (hasVector) {
    prompts.push({
      id: "/rag-query",
      title: "RAG Query / Retrieval",
      description: "Write or optimize a vector similarity search query",
      prompt: `Write or optimize a pgvector similarity search query for the RAG pipeline.
Requirements:
- Use cosine distance (<->) on the document_chunks table
- Always scope by fileId (prevent cross-user leakage)
- Return top-K results with content + metadata (pageNumber, snippet)
- Ensure the embedding is 384D (HuggingFace MiniLM-L6-v2)
- Show me how to integrate the results into the SSE stream format
- Reference src/lib/vector-store.ts and src/app/api/chat/route.ts`
    });
  }
  prompts.push({
    id: "/explain-file",
    title: "Explain File",
    description: "Get a detailed explanation of a file in the codebase",
    prompt: `Explain the file I specify in detail.
Include:
- Its purpose and responsibility in the architecture
- Key exports and their signatures
- Any important side effects or dependencies
- How it connects to other parts of the system
- Any gotchas or non-obvious behavior
Reference the project architecture in .github/ai-os/context/architecture.md as context.`
  });
  prompts.push({
    id: "/refactor-component",
    title: "Refactor Component",
    description: "Refactor a component following project conventions",
    prompt: `Refactor the component I specify following the project conventions.
Before touching anything:
1. Read the component file completely
2. List all imports and consumers (grep for the component name)
3. Identify props, tRPC hooks, and state
Then:
- Apply the naming conventions from .github/ai-os/context/conventions.md
- Extract business logic to lib/ if present in the component
- Ensure TypeScript strict compliance (no any)
- Verify all callers still compile after the refactor`
  });
  return prompts;
}
async function generatePrompts(stack, cwd, options) {
  const promptsPath = path13.join(cwd, PROMPTS_FILE);
  fs12.mkdirSync(path13.dirname(promptsPath), { recursive: true });
  let existing = { version: 1, prompts: [] };
  if (fs12.existsSync(promptsPath)) {
    try {
      existing = JSON.parse(fs12.readFileSync(promptsPath, "utf-8"));
    } catch {
    }
  }
  const generatedPrompts = buildPrompts(stack, cwd);
  let changed = 0;
  if (options?.refreshExisting) {
    const byId = new Map(existing.prompts.map((p) => [p.id, p]));
    for (const prompt of generatedPrompts) {
      const prev = byId.get(prompt.id);
      if (!prev) {
        existing.prompts.push(prompt);
        changed++;
        continue;
      }
      if (prev.title !== prompt.title || prev.description !== prompt.description || prev.prompt !== prompt.prompt) {
        byId.set(prompt.id, prompt);
        changed++;
      }
    }
    existing.prompts = existing.prompts.map((p) => byId.get(p.id) ?? p);
  } else {
    const existingIds = new Set(existing.prompts.map((p) => p.id));
    const newPrompts = generatedPrompts.filter((p) => !existingIds.has(p.id));
    if (newPrompts.length === 0) return [];
    existing.prompts = [...existing.prompts, ...newPrompts];
    changed = newPrompts.length;
  }
  if (changed === 0) return [];
  writeIfChanged(promptsPath, JSON.stringify(existing, null, 2));
  return [promptsPath];
}

// src/generators/workflows.ts
import path14 from "node:path";
function generateWorkflows(outputDir, options) {
  const managed = [];
  const track = (p) => {
    managed.push(p);
    return p;
  };
  if (options?.config?.updateCheckEnabled !== false) {
    const workflowPath = track(path14.join(outputDir, ".github", "workflows", "ai-os-update-check.yml"));
    writeIfChanged(workflowPath, getUpdateCheckWorkflowContent());
  }
  return managed;
}
function getUpdateCheckWorkflowContent() {
  return `name: AI OS Update Check

on:
  schedule:
    - cron: '0 9 * * 1'
  workflow_dispatch:

permissions:
  contents: read
  issues: write

jobs:
  check-for-ai-os-updates:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Read installed and latest versions
        id: versions
        shell: bash
        run: |
          set -euo pipefail

          ENABLED=$(node -e "const fs=require('fs'); try { const c=JSON.parse(fs.readFileSync('.github/ai-os/config.json','utf8')); process.stdout.write(String(c.updateCheckEnabled !== false)); } catch { process.stdout.write('true'); }")
          echo "enabled=$ENABLED" >> "$GITHUB_OUTPUT"

          INSTALLED=$(node -e "const fs=require('fs'); try { const c=JSON.parse(fs.readFileSync('.github/ai-os/config.json','utf8')); process.stdout.write(c.version || '0.0.0'); } catch { process.stdout.write('0.0.0'); }")
          echo "installed=$INSTALLED" >> "$GITHUB_OUTPUT"

          LATEST=$(curl -fsSL https://raw.githubusercontent.com/marinvch/ai-os/dev/package.json | node -e "let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>{const j=JSON.parse(d); process.stdout.write(j.version||'0.0.0');});")
          echo "latest=$LATEST" >> "$GITHUB_OUTPUT"

          NEEDS_UPDATE=$(node -e "const a=process.argv[1].split('.').map(n=>parseInt(n,10)||0); const b=process.argv[2].split('.').map(n=>parseInt(n,10)||0); const lt=(x,y)=>x[0]<y[0]||x[0]===y[0]&&(x[1]<y[1]||x[1]===y[1]&&x[2]<y[2]); process.stdout.write(lt(a,b)?'true':'false');" "$INSTALLED" "$LATEST")
          echo "needs_update=$NEEDS_UPDATE" >> "$GITHUB_OUTPUT"

      - name: Create issue if update is available
        if: steps.versions.outputs.enabled == 'true' && steps.versions.outputs.needs_update == 'true'
        uses: actions/github-script@v7
        with:
          github-token: \${{ secrets.GITHUB_TOKEN }}
          script: |
            const latest = '\${{ steps.versions.outputs.latest }}';
            const installed = '\${{ steps.versions.outputs.installed }}';
            const owner = context.repo.owner;
            const repo = context.repo.repo;
            const title = 'AI OS update available: v' + latest;

            const open = await github.paginate(github.rest.issues.listForRepo, {
              owner,
              repo,
              state: 'open',
              per_page: 100,
            });

            if (open.some((i) => i.title === title)) {
              core.info('Update issue already exists; skipping.');
              return;
            }

            await github.rest.issues.create({
              owner,
              repo,
              title,
              body: [
                'A newer AI OS version is available.',
                '',
                '- Installed: v' + installed,
                '- Latest: v' + latest,
                '',
                'To update, run:',
                'npx -y github:marinvch/ai-os --refresh-existing',
              ].join('
'),
            });
`;
}

// src/planner.ts
import fs13 from "node:fs";
import path15 from "node:path";
function exists3(root, relPath) {
  return fs13.existsSync(path15.join(root, relPath));
}
function detectRepoType(targetDir) {
  if (exists3(targetDir, ".github/ai-os/config.json") || exists3(targetDir, ".ai-os/config.json")) return "existing-ai-os";
  if (exists3(targetDir, ".github/copilot-instructions.md") || exists3(targetDir, ".github/copilot/prompts.json")) {
    return "existing-non-ai-os";
  }
  return "new";
}
function decideAction(targetDir, relPath, mode, behavior) {
  const alreadyExists = exists3(targetDir, relPath);
  if (!alreadyExists) {
    return { path: relPath, action: "create", reason: "File does not exist yet", risk: "low" };
  }
  if (behavior === "always-overwrite") {
    return {
      path: relPath,
      action: "update",
      reason: "Generator rewrites this artifact each run (write-if-changed prevents no-op diffs)",
      risk: relPath.includes("copilot-instructions.md") ? "medium" : "low"
    };
  }
  if (mode === "refresh-existing" || mode === "update") {
    return {
      path: relPath,
      action: "update",
      reason: "Refresh mode updates existing generated artifacts in place",
      risk: "low"
    };
  }
  return {
    path: relPath,
    action: "merge",
    reason: "Safe mode only appends/keeps existing content where possible",
    risk: "low"
  };
}
function buildOnboardingPlan(targetDir, mode) {
  const actions = [];
  actions.push(decideAction(targetDir, ".github/copilot-instructions.md", mode, "always-overwrite"));
  actions.push(decideAction(targetDir, ".github/instructions/ai-os.instructions.md", mode, "always-overwrite"));
  actions.push(decideAction(targetDir, ".github/copilot/mcp.json", mode, "always-overwrite"));
  actions.push(decideAction(targetDir, ".github/ai-os/tools.json", mode, "always-overwrite"));
  actions.push(decideAction(targetDir, ".ai-os/mcp-server/runtime-manifest.json", mode, "always-overwrite"));
  actions.push(decideAction(targetDir, ".github/ai-os/context/stack.md", mode, "always-overwrite"));
  actions.push(decideAction(targetDir, ".github/ai-os/context/architecture.md", mode, "safe-merge"));
  actions.push(decideAction(targetDir, ".github/ai-os/context/conventions.md", mode, "safe-merge"));
  actions.push(decideAction(targetDir, ".github/ai-os/context/memory.md", mode, "always-overwrite"));
  actions.push(decideAction(targetDir, ".github/ai-os/context/existing-ai-context.md", mode, "always-overwrite"));
  actions.push(decideAction(targetDir, ".github/ai-os/context/dependency-graph.json", mode, "always-overwrite"));
  actions.push(decideAction(targetDir, ".github/ai-os/config.json", mode, "always-overwrite"));
  actions.push(decideAction(targetDir, ".github/ai-os/manifest.json", mode, "always-overwrite"));
  actions.push(decideAction(targetDir, ".github/ai-os/memory/README.md", mode, "safe-merge"));
  actions.push(decideAction(targetDir, ".github/ai-os/memory/memory.jsonl", mode, "safe-merge"));
  actions.push(decideAction(targetDir, ".github/COPILOT_CONTEXT.md", mode, "always-overwrite"));
  actions.push(decideAction(targetDir, ".github/ai-os/recommendations.md", mode, "always-overwrite"));
  actions.push(decideAction(targetDir, ".github/agents/", mode, "safe-merge"));
  actions.push(decideAction(targetDir, ".github/copilot/skills/", mode, "safe-merge"));
  actions.push(decideAction(targetDir, ".github/copilot/prompts.json", mode, "safe-merge"));
  actions.push(decideAction(targetDir, ".agents/skills/skill-creator/", mode, "safe-merge"));
  return {
    targetDir,
    detectedRepoType: detectRepoType(targetDir),
    mode,
    actions
  };
}
function formatOnboardingPlan(plan) {
  const counts = plan.actions.reduce(
    (acc, action) => {
      acc[action.action] += 1;
      return acc;
    },
    { create: 0, update: 0, merge: 0, skip: 0 }
  );
  const lines = [];
  lines.push("");
  lines.push("  \u{1F9ED} Onboarding Plan");
  lines.push(`  \u{1F4C2} Target: ${plan.targetDir}`);
  lines.push(`  \u{1F9E9} Repo type: ${plan.detectedRepoType}`);
  lines.push(`  \u{1F527} Mode: ${plan.mode}`);
  lines.push(`  \u{1F4CA} Actions: create=${counts.create}, update=${counts.update}, merge=${counts.merge}, skip=${counts.skip}`);
  lines.push("");
  for (const action of plan.actions) {
    lines.push(`  - [${action.action}] ${action.path} (${action.risk} risk) \u2014 ${action.reason}`);
  }
  lines.push("");
  lines.push("  \u2705 Use --apply to execute this plan.");
  lines.push("");
  return lines.join("\n");
}

// src/recommendations/index.ts
import fs14 from "node:fs";
import path16 from "node:path";

// src/recommendations/registry.ts
var DEPENDENCY_RECOMMENDATIONS = {
  prisma: {
    trigger: "prisma",
    mcp: { package: "prisma/mcp-server", description: "Official Prisma MCP server for schema-aware DB queries" },
    vscode: ["Prisma.prisma"],
    skills: ["prisma"]
  },
  "@prisma/client": {
    trigger: "@prisma/client",
    mcp: { package: "prisma/mcp-server", description: "Official Prisma MCP server for schema-aware DB queries" },
    vscode: ["Prisma.prisma"],
    skills: ["prisma"]
  },
  stripe: {
    trigger: "stripe",
    skills: ["stripe"],
    copilotExtension: { name: "Stripe Copilot Extension", url: "https://marketplace.visualstudio.com/items?itemName=Stripe.stripe-vscode" },
    vscode: ["Stripe.stripe-vscode"]
  },
  "@trpc/server": {
    trigger: "@trpc/server",
    skills: ["trpc"]
  },
  "@trpc/client": {
    trigger: "@trpc/client",
    skills: ["trpc"]
  },
  next: {
    trigger: "next",
    skills: ["nextjs", "vercel-react-best-practices", "context7"],
    vscode: ["bradlc.vscode-tailwindcss"]
  },
  "next.js": {
    trigger: "next.js",
    skills: ["nextjs", "vercel-react-best-practices", "context7"],
    vscode: ["bradlc.vscode-tailwindcss"]
  },
  react: {
    trigger: "react",
    skills: ["react", "vercel-react-best-practices", "context7"],
    vscode: ["dsznajder.es7-react-js-snippets", "burkeholland.simple-react-snippets"]
  },
  nuxt: {
    trigger: "nuxt",
    skills: ["context7"],
    vscode: ["Vue.volar"]
  },
  vue: {
    trigger: "vue",
    vscode: ["Vue.volar"],
    skills: ["context7"]
  },
  "express": {
    trigger: "express",
    skills: ["express"]
  },
  "fastapi": {
    trigger: "fastapi",
    skills: ["python-fastapi", "context7"],
    vscode: ["ms-python.python"]
  },
  "django": {
    trigger: "django",
    vscode: ["ms-python.python", "batisteo.vscode-django"],
    skills: ["context7"]
  },
  supabase: {
    trigger: "supabase",
    mcp: { package: "@supabase/mcp-server-supabase", description: "Official Supabase MCP server" },
    skills: ["supabase"],
    vscode: ["supabase.vscode-supabase-extension"]
  },
  "@supabase/supabase-js": {
    trigger: "@supabase/supabase-js",
    mcp: { package: "@supabase/mcp-server-supabase", description: "Official Supabase MCP server" },
    skills: ["supabase"]
  },
  drizzle: {
    trigger: "drizzle-orm",
    skills: ["prisma"]
    // drizzle uses similar patterns
  },
  "drizzle-orm": {
    trigger: "drizzle-orm",
    skills: ["context7"]
  }
};
var FRAMEWORK_RECOMMENDATIONS = {
  "Next.js": {
    trigger: "Next.js",
    skills: ["nextjs", "vercel-react-best-practices", "context7"],
    vscode: ["dsznajder.es7-react-js-snippets", "bradlc.vscode-tailwindcss"]
  },
  "React": {
    trigger: "React",
    skills: ["react", "vercel-react-best-practices", "context7"],
    vscode: ["dsznajder.es7-react-js-snippets"]
  },
  "Express": {
    trigger: "Express",
    skills: ["express"]
  },
  "NestJS": {
    trigger: "NestJS",
    vscode: ["nrwl.angular-console"],
    skills: ["context7"]
  },
  "FastAPI": {
    trigger: "FastAPI",
    skills: ["python-fastapi", "context7"],
    vscode: ["ms-python.python"]
  },
  "Spring Boot": {
    trigger: "Spring Boot",
    skills: ["java-spring", "context7"],
    vscode: ["vscjava.vscode-java-pack", "redhat.java"]
  },
  "Astro": {
    trigger: "Astro",
    vscode: ["astro-build.astro-vscode"],
    skills: ["context7"]
  },
  "SvelteKit": {
    trigger: "SvelteKit",
    vscode: ["svelte.svelte-vscode"],
    skills: ["context7"]
  },
  "Svelte": {
    trigger: "Svelte",
    vscode: ["svelte.svelte-vscode"]
  },
  "Nuxt": {
    trigger: "Nuxt",
    vscode: ["Vue.volar"],
    skills: ["context7"]
  },
  "Vue": {
    trigger: "Vue",
    vscode: ["Vue.volar"]
  },
  "tRPC": {
    trigger: "tRPC",
    skills: ["trpc"]
  },
  "Prisma": {
    trigger: "Prisma",
    mcp: { package: "prisma/mcp-server", description: "Official Prisma MCP server" },
    vscode: ["Prisma.prisma"],
    skills: ["prisma"]
  }
};
var LANGUAGE_RECOMMENDATIONS = {
  "TypeScript": {
    trigger: "TypeScript",
    vscode: ["ms-vscode.vscode-typescript-next"]
  },
  "Go": {
    trigger: "Go",
    vscode: ["golang.go"],
    skills: ["context7"]
  },
  "Rust": {
    trigger: "Rust",
    vscode: ["rust-lang.rust-analyzer"],
    skills: ["context7"]
  },
  "Python": {
    trigger: "Python",
    vscode: ["ms-python.python", "ms-python.black-formatter"],
    skills: ["context7"]
  },
  "Java": {
    trigger: "Java",
    vscode: ["vscjava.vscode-java-pack"],
    skills: ["context7"]
  },
  "Ruby": {
    trigger: "Ruby",
    vscode: ["Shopify.ruby-lsp"]
  },
  "PHP": {
    trigger: "PHP",
    vscode: ["bmewburn.vscode-intelephense-client"]
  }
};
var UNIVERSAL_RECOMMENDATIONS = [
  {
    trigger: "universal",
    skills: ["find-skills", "context7"]
  }
];

// src/recommendations/index.ts
function collectRecommendations(stack) {
  const collected = { mcp: [], vscode: [], skills: [], copilotExtensions: [] };
  const seenMcp = /* @__PURE__ */ new Set();
  const seenVscode = /* @__PURE__ */ new Set();
  const seenSkills = /* @__PURE__ */ new Set();
  const seenExt = /* @__PURE__ */ new Set();
  function applyRec(rec) {
    if (rec.mcp && !seenMcp.has(rec.mcp.package)) {
      seenMcp.add(rec.mcp.package);
      collected.mcp.push({ trigger: rec.trigger, package: rec.mcp.package, description: rec.mcp.description });
    }
    for (const ext of rec.vscode ?? []) {
      if (!seenVscode.has(ext)) {
        seenVscode.add(ext);
        collected.vscode.push({ trigger: rec.trigger, id: ext });
      }
    }
    for (const skill of rec.skills ?? []) {
      if (!seenSkills.has(skill)) {
        seenSkills.add(skill);
        collected.skills.push({ trigger: rec.trigger, name: skill });
      }
    }
    if (rec.copilotExtension && !seenExt.has(rec.copilotExtension.name)) {
      seenExt.add(rec.copilotExtension.name);
      collected.copilotExtensions.push({ trigger: rec.trigger, ...rec.copilotExtension });
    }
  }
  for (const dep of stack.allDependencies) {
    const rec = DEPENDENCY_RECOMMENDATIONS[dep];
    if (rec) applyRec(rec);
  }
  for (const fw of stack.frameworks) {
    const rec = FRAMEWORK_RECOMMENDATIONS[fw.name];
    if (rec) applyRec(rec);
  }
  for (const lang of stack.languages) {
    const rec = LANGUAGE_RECOMMENDATIONS[lang.name];
    if (rec) applyRec(rec);
  }
  for (const rec of UNIVERSAL_RECOMMENDATIONS) {
    applyRec(rec);
  }
  return collected;
}
function generateRecommendationsDoc(stack, collected) {
  const lines = [
    `# AI OS Recommendations \u2014 ${stack.projectName}`,
    "",
    "> Auto-generated by AI OS based on detected stack. Refreshed on every `--refresh-existing` run.",
    ""
  ];
  if (collected.mcp.length > 0) {
    lines.push("## Recommended MCP Servers", "");
    for (const item of collected.mcp) {
      lines.push(`### ${item.package}`);
      lines.push(`> Triggered by: \`${item.trigger}\``);
      lines.push("");
      lines.push(item.description);
      lines.push("");
      lines.push("**Install in `.github/copilot/mcp.json`:**");
      lines.push("```json");
      lines.push(`"${item.package.replace("/", "-")}": {`);
      lines.push('  "type": "stdio",');
      lines.push(`  "command": "npx",`);
      lines.push(`  "args": ["-y", "${item.package}"]`);
      lines.push("}");
      lines.push("```");
      lines.push("");
    }
  }
  if (collected.vscode.length > 0) {
    lines.push("## Recommended VS Code Extensions", "");
    for (const item of collected.vscode) {
      lines.push(`- [\`${item.id}\`](https://marketplace.visualstudio.com/items?itemName=${item.id}) \u2014 for \`${item.trigger}\``);
    }
    lines.push("");
    lines.push("**Install all at once:**");
    lines.push("```bash");
    for (const item of collected.vscode) {
      lines.push(`code --install-extension ${item.id}`);
    }
    lines.push("```");
    lines.push("");
  }
  if (collected.skills.length > 0) {
    lines.push("## Agent Skills to Install", "");
    for (const item of collected.skills) {
      lines.push(`- **${item.name}** \u2014 for \`${item.trigger}\``);
    }
    lines.push("");
    lines.push("**Install via skills CLI:**");
    lines.push("```bash");
    for (const item of collected.skills) {
      lines.push(`npx -y skills add --skill ${item.name} -g -a github-copilot`);
    }
    lines.push("```");
    lines.push("");
  }
  if (collected.copilotExtensions.length > 0) {
    lines.push("## GitHub Copilot Extensions", "");
    for (const item of collected.copilotExtensions) {
      lines.push(`- [${item.name}](${item.url}) \u2014 for \`${item.trigger}\``);
    }
    lines.push("");
  }
  lines.push("---");
  lines.push(`*Generated at ${(/* @__PURE__ */ new Date()).toISOString()} by AI OS*`);
  return lines.join("\n");
}
function getSkillsGapReport(stack, skillsLockPath) {
  const collected = collectRecommendations(stack);
  const recommendedSkills = new Set(collected.skills.map((s) => s.name));
  let installed = [];
  try {
    const lock = JSON.parse(fs14.readFileSync(skillsLockPath, "utf-8"));
    if (Array.isArray(lock.skills)) {
      installed = lock.skills;
    } else if (lock.skills && typeof lock.skills === "object") {
      installed = Object.keys(lock.skills);
    }
  } catch {
  }
  const installedSet = new Set(installed.map((s) => s.toLowerCase()));
  const missing = [...recommendedSkills].filter((s) => !installedSet.has(s.toLowerCase()));
  if (missing.length === 0) return "";
  const cmds = missing.map((s) => `npx -y skills add --skill ${s} -g -a github-copilot`).join("\n");
  return `  \u{1F4E6} Skills gap detected \u2014 Missing: [${missing.join(", ")}]
  Run:
${cmds.split("\n").map((l) => `    ${l}`).join("\n")}`;
}
function generateRecommendations(stack, outputDir) {
  const collected = collectRecommendations(stack);
  const content = generateRecommendationsDoc(stack, collected);
  const outPath = path16.join(outputDir, ".github", "ai-os", "recommendations.md");
  writeIfChanged(outPath, content);
  return outPath;
}

// src/generate.ts
function parseArgs() {
  const args = process.argv.slice(2);
  let cwd = process.cwd();
  let dryRun = false;
  let mode = "safe";
  let action = "apply";
  let prune = false;
  let verbose = false;
  let cleanUpdate = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--cwd" && args[i + 1]) {
      cwd = path17.resolve(args[i + 1]);
      i++;
    } else if (args[i] === "--cwd" && !args[i + 1]) {
      throw new Error("--cwd requires a path value");
    } else if (args[i]?.startsWith("--cwd=")) {
      cwd = path17.resolve(args[i].slice("--cwd=".length));
    } else if (args[i] === "--dry-run") {
      dryRun = true;
    } else if (args[i] === "--refresh-existing") {
      mode = "refresh-existing";
    } else if (args[i] === "--update") {
      mode = "update";
    } else if (args[i] === "--plan") {
      action = "plan";
    } else if (args[i] === "--preview") {
      action = "preview";
    } else if (args[i] === "--apply") {
      action = "apply";
    } else if (args[i] === "--prune") {
      prune = true;
    } else if (args[i]?.startsWith("--clean-update")) {
      cleanUpdate = true;
      mode = "refresh-existing";
    } else if (args[i] === "--check-hygiene") {
      action = "check-hygiene";
    } else if (args[i] === "--verbose" || args[i] === "-v") {
      verbose = true;
    }
  }
  return { cwd, dryRun, mode, action, prune, verbose, cleanUpdate };
}
function printBanner() {
  const version = `v${getToolVersion()}`;
  const versionCell = `AI OS  ${version}`.padEnd(25, " ");
  console.log("");
  console.log("  \u2554\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2557");
  console.log(`  \u2551          ${versionCell}\u2551`);
  console.log("  \u2551  Portable Copilot Context Engine  \u2551");
  console.log("  \u255A\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255D");
  console.log("");
}
function printAgentFlowSetupPrompt(cwd, currentMode) {
  const scan = scanExistingAgents(cwd);
  const hasUserAgents = scan.userDefined.length > 0;
  if (currentMode !== null) return;
  console.log("  \u250C\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2510");
  console.log("  \u2502  \u{1F916} Sequential Agent Flow \u2014 Setup                           \u2502");
  console.log("  \u2502                                                             \u2502");
  console.log("  \u2502  AI OS can generate a 3-agent sequential improvement flow:  \u2502");
  console.log("  \u2502                                                             \u2502");
  console.log("  \u2502   1. Feature Enhancement Advisor  (finds improvements)     \u2502");
  console.log("  \u2502      \u2193                                                      \u2502");
  console.log("  \u2502   2. Idea Validator               (confirms before coding)  \u2502");
  console.log("  \u2502      \u2193                                                      \u2502");
  console.log("  \u2502   3. Implementation Agent         (executes validated plan)  \u2502");
  console.log("  \u2502                                                             \u2502");
  if (hasUserAgents) {
    console.log(`  \u2502  Existing agents detected: ${scan.userDefined.join(", ").slice(0, 38).padEnd(38)} \u2502`);
    console.log("  \u2502                                                             \u2502");
    console.log("  \u2502  Choose an option in .github/ai-os/config.json:            \u2502");
    console.log('  \u2502    "agentFlowMode": "create"  \u2014 add the 3 agents (default) \u2502');
    console.log('  \u2502    "agentFlowMode": "hook"    \u2014 guide to link to existing   \u2502');
    console.log('  \u2502    "agentFlowMode": "skip"    \u2014 do not generate agents      \u2502');
  } else {
    console.log("  \u2502  No existing agents found \u2014 the 3 agents will be created.  \u2502");
    console.log('  \u2502  Set "agentFlowMode": "skip" in config.json to opt out.    \u2502');
  }
  console.log("  \u2502                                                             \u2502");
  console.log("  \u2502  Already created: .github/agents/feature-enhancement-advisor.agent.md \u2502");
  console.log("  \u2502                   .github/agents/idea-validator.agent.md    \u2502");
  console.log("  \u2502                   .github/agents/implementation-agent.agent.md \u2502");
  console.log("  \u2514\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2518");
  console.log("");
  if (currentMode === "hook" && hasUserAgents) {
    printAgentHookGuide(scan.userDefined);
  }
}
function printAgentHookGuide(userDefinedAgents) {
  console.log("  \u{1F4CE} Hook Guide \u2014 connecting your existing agents to the ai-os flow:");
  console.log("");
  for (const agent of userDefinedAgents) {
    console.log(`     ${agent}`);
    console.log('       \u2192 Add a "Handoff" section pointing to feature-enhancement-advisor.agent.md');
    console.log("         or idea-validator.agent.md as the next step in your workflow.");
  }
  console.log("");
  console.log("  Example handoff to add at the bottom of an existing agent:");
  console.log("");
  console.log("     ## Handoff");
  console.log("     When analysis is complete, pass the findings to the");
  console.log("     **Idea Validator** agent for cross-checking before implementation.");
  console.log("");
}
function printAgentFlowStatus(cwd, mode) {
  const scan = scanExistingAgents(cwd);
  const flowFiles = [
    "feature-enhancement-advisor.agent.md",
    "idea-validator.agent.md",
    "implementation-agent.agent.md"
  ];
  const present = flowFiles.filter((f) => scan.aiOsGenerated.includes(f) || scan.userDefined.includes(f));
  const activeMode = mode ?? "create";
  console.log("  \u{1F916} Agent flow status:");
  console.log(`     agent flow mode: ${activeMode}`);
  console.log(`     flow agents present: ${present.length}/3`);
  if (present.length > 0) {
    console.log(`     detected: ${present.join(", ")}`);
  }
  if (activeMode === "hook") {
    console.log("     hook mode enabled \u2014 AI OS will keep your existing agents and print handoff guidance.");
  } else if (activeMode === "skip") {
    console.log('     skip mode enabled \u2014 set agentFlowMode to "create" in .github/ai-os/config.json to enable flow agents.');
  }
  console.log("");
}
function printSummary(stack, outputDir, written, skipped, pruned, agents) {
  const mcpToolCount = getMcpToolsForStack(stack).length;
  const fw = stack.frameworks.map((f) => f.name).join(", ") || stack.primaryLanguage.name;
  console.log(`  \u{1F4E6} Project:    ${stack.projectName}`);
  console.log(`  \u{1F524} Language:   ${stack.primaryLanguage.name} (${stack.primaryLanguage.percentage}%)`);
  console.log(`  \u{1F3D7}\uFE0F  Framework:  ${fw}`);
  console.log(`  \u{1F4E6} Pkg Mgr:   ${stack.patterns.packageManager}`);
  console.log(`  \u{1F537} TypeScript: ${stack.patterns.hasTypeScript ? "Yes" : "No"}`);
  console.log("");
  console.log("  Diff summary:");
  console.log(`  \u2705 Written (new or changed):  ${written.length}`);
  console.log(`  \u23ED\uFE0F  Unchanged (skipped):        ${skipped.length}`);
  if (pruned.length > 0) {
    console.log(`  \u{1F5D1}\uFE0F  Pruned (stale):              ${pruned.length}`);
    for (const p of pruned) console.log(`       \u2022 ${path17.relative(outputDir, p).replace(/\\/g, "/")}`);
  }
  if (agents.length > 0) {
    console.log(`  \u{1F916} Agents generated: ${agents.length}`);
  }
  console.log(`  \u{1F527} MCP tools registered: ${mcpToolCount}`);
  console.log(`  \u{1F5F3}\uFE0F  Manifest: ${path17.relative(outputDir, getManifestPath(outputDir)).replace(/\\/g, "/")}`);
  console.log("");
  console.log("  \u{1F680} AI OS installed! Open this repo in VS Code with GitHub Copilot enabled.");
  console.log(`  \u{1F4A1} Try @workspace, /new-page, /new-trpc-procedure, or any agent from Chat.`);
  console.log("");
}
async function main() {
  printBanner();
  const { cwd, dryRun, mode: rawMode, action, prune: pruneFlag, verbose, cleanUpdate } = parseArgs();
  let mode = rawMode;
  if (verbose) {
    setVerboseMode(true);
    console.log("  \u{1F50D} Verbose mode enabled \u2014 per-file write/skip/prune reasons will be shown.\n");
  }
  if (action === "check-hygiene") {
    runHygieneCheck(cwd);
    return;
  }
  console.log(`  \u{1F4C2} Scanning: ${cwd}`);
  console.log(`  \u{1F527} Mode: ${mode}`);
  console.log(`  \u25B6\uFE0F  Action: ${action}`);
  console.log("");
  const updateStatus = checkUpdateStatus(cwd);
  const installedVersionLabel = updateStatus.installedVersion ?? "none";
  console.log(`  \u{1FA7A} Diagnostics: tool=v${updateStatus.toolVersion}, installed=v${installedVersionLabel}, firstInstall=${updateStatus.isFirstInstall ? "yes" : "no"}, updateAvailable=${updateStatus.updateAvailable ? "yes" : "no"}`);
  if (mode === "update") {
    if (updateStatus.isFirstInstall) {
      console.log("  \u2139\uFE0F  No existing AI OS installation found. Running fresh install...");
    } else if (updateStatus.updateAvailable) {
      console.log(`  \u{1F504} Updating from v${updateStatus.installedVersion ?? "?"} \u2192 v${updateStatus.toolVersion}`);
    } else {
      console.log(`  \u2705 Already up-to-date (v${updateStatus.toolVersion}). Re-generating to refresh context...`);
    }
    mode = "refresh-existing";
  } else if (mode === "safe" && !updateStatus.isFirstInstall) {
    printUpdateBanner(updateStatus);
  }
  if (mode === "refresh-existing") {
    pruneLegacyArtifacts(cwd, { fullCleanup: cleanUpdate });
  }
  const stack = analyze(cwd);
  const existingConfig = readAiOsConfig(cwd);
  const onboardingPlan = buildOnboardingPlan(cwd, mode);
  if (action === "plan") {
    console.log(formatOnboardingPlan(onboardingPlan));
    return;
  }
  if (action === "preview") {
    console.log(formatOnboardingPlan(onboardingPlan));
    console.log("  \u{1F50D} Preview only: no files were written. Run with --apply to execute.");
    console.log("");
    return;
  }
  if (dryRun) {
    console.log("  [DRY RUN] Detected stack:");
    console.log(JSON.stringify(stack, null, 2));
    return;
  }
  const previousManifest = readManifest(cwd);
  const previousFiles = new Set(previousManifest?.files ?? []);
  const contextFiles = generateContextDocs(stack, cwd);
  const config = readAiOsConfig(cwd) ?? existingConfig;
  const instructionFiles = generateInstructions(stack, cwd, { refreshExisting: mode === "refresh-existing", config: config ?? void 0 });
  const mcpFiles = generateMcpJson(stack, cwd, { refreshExisting: mode === "refresh-existing" });
  const agentFiles = await generateAgents(stack, cwd, { refreshExisting: mode === "refresh-existing", config: config ?? void 0 });
  const skillFiles = await generateSkills(stack, cwd, { refreshExisting: mode === "refresh-existing" });
  const promptFiles = await generatePrompts(stack, cwd, { refreshExisting: mode === "refresh-existing" });
  const workflowFiles = generateWorkflows(cwd, { config: config ?? void 0 });
  await deployBundledSkills(cwd, { refreshExisting: mode === "refresh-existing" });
  const recommendationFiles = [];
  if (config?.recommendations !== false) {
    const recPath = generateRecommendations(stack, cwd);
    recommendationFiles.push(recPath);
    const skillsLockPath = path17.join(path17.dirname(new URL(import.meta.url).pathname), "..", "skills-lock.json");
    const gapReport = getSkillsGapReport(stack, skillsLockPath);
    if (gapReport) console.log(`
${gapReport}
`);
  }
  const allManagedAbs = [
    ...contextFiles,
    ...instructionFiles,
    ...mcpFiles,
    ...agentFiles,
    ...skillFiles,
    ...promptFiles,
    ...workflowFiles,
    ...recommendationFiles
  ];
  const toRel = (p) => path17.relative(cwd, p).replace(/\\/g, "/");
  const currentRelFiles = allManagedAbs.map(toRel);
  const manifestRel = toRel(getManifestPath(cwd));
  currentRelFiles.push(manifestRel);
  const shouldPrune = pruneFlag || mode === "refresh-existing";
  const prunedAbs = [];
  if (shouldPrune && previousFiles.size > 0) {
    const currentSet = new Set(currentRelFiles);
    for (const rel of previousFiles) {
      if (!currentSet.has(rel)) {
        const abs = path17.join(cwd, rel);
        if (fs15.existsSync(abs)) {
          try {
            fs15.rmSync(abs);
            prunedAbs.push(abs);
            if (verbose) {
              console.log(`  \u{1F5D1}\uFE0F  prune   ${rel}  (stale \u2014 not in current generation)`);
            } else {
              console.log(`  \u{1F5D1}\uFE0F  Pruned stale artifact: ${rel}`);
            }
          } catch {
            console.warn(`  \u26A0 Could not prune: ${rel}`);
          }
        } else if (verbose) {
          console.log(`  \u{1F5D1}\uFE0F  prune   ${rel}  (already missing, skipping delete)`);
        }
      }
    }
  }
  writeManifest(cwd, getToolVersion(), currentRelFiles);
  const newFiles = currentRelFiles.filter((r) => r !== manifestRel && !previousFiles.has(r));
  const existingFiles = currentRelFiles.filter((r) => r !== manifestRel && previousFiles.has(r));
  printSummary(stack, cwd, newFiles, existingFiles, prunedAbs, agentFiles);
  const agentFlowMode = config?.agentFlowMode;
  const isFirstInstall = updateStatus.isFirstInstall;
  if (isFirstInstall || agentFlowMode === void 0) {
    printAgentFlowSetupPrompt(cwd, config?.agentFlowMode ?? null);
  }
  printAgentFlowStatus(cwd, config?.agentFlowMode ?? null);
}
main().catch((err) => {
  console.error("  \u274C Error:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
function runHygieneCheck(cwd) {
  console.log(`  \u{1F9F9} Hygiene check: ${cwd}`);
  console.log("");
  const issues = [];
  const legacyContextDir = path17.join(cwd, ".ai-os", "context");
  if (fs15.existsSync(legacyContextDir)) {
    const legacyFiles = fs15.readdirSync(legacyContextDir);
    if (legacyFiles.length > 0) {
      issues.push(`  \u26A0  Legacy .ai-os/context/ found with ${legacyFiles.length} file(s) \u2014 run --refresh-existing to migrate and prune`);
    }
  }
  const lockPaths = [
    path17.join(cwd, ".github", "ai-os", "memory", ".memory.lock"),
    path17.join(cwd, ".ai-os", "memory", ".memory.lock")
  ];
  for (const lockPath of lockPaths) {
    if (fs15.existsSync(lockPath)) {
      issues.push(`  \u26A0  Stale lock file found: ${path17.relative(cwd, lockPath)} \u2014 safe to delete`);
    }
  }
  const mcpNodeModules = path17.join(cwd, ".ai-os", "mcp-server", "node_modules");
  if (fs15.existsSync(mcpNodeModules)) {
    issues.push(`  \u26A0  node_modules present in .ai-os/mcp-server/ \u2014 Phase F (bundle deploy) will eliminate this`);
  }
  const aiOsDirs = [
    path17.join(cwd, ".github", "ai-os"),
    path17.join(cwd, ".ai-os")
  ];
  for (const dir of aiOsDirs) {
    if (!fs15.existsSync(dir)) continue;
    const tmpFiles = findFilesRecursive(dir, (f) => f.endsWith(".tmp"));
    for (const f of tmpFiles) {
      issues.push(`  \u26A0  Orphaned temp file: ${path17.relative(cwd, f)}`);
    }
  }
  const manifest = readManifest(cwd);
  if (manifest) {
    const missingFiles = manifest.files.filter((f) => !fs15.existsSync(path17.join(cwd, f)));
    if (missingFiles.length > 0) {
      issues.push(`  \u26A0  ${missingFiles.length} manifest entries point to missing files \u2014 run --refresh-existing`);
    }
  } else {
    issues.push(`  \u26A0  No manifest.json found \u2014 run AI OS generation to create one`);
  }
  if (issues.length === 0) {
    console.log("  \u2705 Hygiene check passed \u2014 no orphaned files or dump artifacts found.");
  } else {
    console.log("  Issues found:");
    for (const issue of issues) console.log(issue);
    console.log("");
    console.log(`  Total issues: ${issues.length}`);
    process.exit(1);
  }
  console.log("");
}
function findFilesRecursive(dir, predicate) {
  const results = [];
  try {
    for (const entry of fs15.readdirSync(dir, { withFileTypes: true })) {
      const full = path17.join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...findFilesRecursive(full, predicate));
      } else if (entry.isFile() && predicate(entry.name)) {
        results.push(full);
      }
    }
  } catch {
  }
  return results;
}
