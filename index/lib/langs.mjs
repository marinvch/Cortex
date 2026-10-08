import { javaCode } from "./imports.mjs";

// Extension → language. Deliberately small: a context manager needs to know what KIND of file
// something is, not to be a linguist. Unknown extensions fall through to "other" and still get
// indexed, because an unrecognised file is still part of the repo's surface.
const BY_EXT = {
  js: "javascript", mjs: "javascript", cjs: "javascript", jsx: "javascript",
  ts: "typescript", mts: "typescript", cts: "typescript", tsx: "typescript",
  py: "python", rb: "ruby", go: "go", rs: "rust", java: "java", kt: "kotlin",
  cs: "csharp", php: "php", swift: "swift", scala: "scala", ex: "elixir", exs: "elixir",
  c: "c", h: "c", cc: "cpp", cpp: "cpp", cxx: "cpp", hpp: "cpp",
  sh: "shell", bash: "shell", zsh: "shell", ps1: "powershell",
  sql: "sql", graphql: "graphql", gql: "graphql", proto: "protobuf", prisma: "prisma",
  md: "markdown", mdx: "markdown", rst: "restructuredtext", txt: "text",
  json: "json", yml: "yaml", yaml: "yaml", toml: "toml", ini: "ini", xml: "xml",
  html: "html", css: "css", scss: "scss", sass: "scss", less: "less", vue: "vue", svelte: "svelte",
  tf: "terraform", hcl: "terraform", dockerfile: "dockerfile",
};

const BY_NAME = {
  dockerfile: "dockerfile", makefile: "make", ".gitignore": "config", ".cortexignore": "config",
  ".gitattributes": "config", ".editorconfig": "config", "version": "config",
};

const CODE = new Set([
  "javascript", "typescript", "python", "ruby", "go", "rust", "java", "kotlin", "csharp",
  "php", "swift", "scala", "elixir", "c", "cpp", "vue", "svelte",
]);
/** Every language `categoryOf` calls code — each needs an import extractor or a place on the blind list. */
export const CODE_LANGUAGES = CODE;
const DOCS = new Set(["markdown", "restructuredtext", "text"]);
const CONFIG = new Set(["json", "yaml", "toml", "ini", "xml", "config", "prisma"]);
const INFRA = new Set(["dockerfile", "terraform", "make"]);
const SCRIPT = new Set(["shell", "powershell"]);
const SCHEMA = new Set(["sql", "graphql", "protobuf"]);

export function detectLanguage(path) {
  const name = path.split("/").pop().toLowerCase();
  if (BY_NAME[name]) return BY_NAME[name];
  if (name.startsWith("dockerfile")) return "dockerfile";
  const ext = name.includes(".") ? name.split(".").pop() : "";
  return BY_EXT[ext] || "other";
}

export function categoryOf(lang) {
  if (CODE.has(lang)) return "code";
  if (DOCS.has(lang)) return "docs";
  if (CONFIG.has(lang)) return "config";
  if (INFRA.has(lang)) return "infra";
  if (SCRIPT.has(lang)) return "script";
  if (SCHEMA.has(lang)) return "schema";
  if (lang === "html" || lang === "css" || lang === "scss" || lang === "less") return "markup";
  return "other";
}

// Test detection is convention-based across the ecosystems Cortex is likely to meet. Getting this
// wrong in either direction matters: a missed test file reads as "untested" in the findings report.
//
// Three kinds of pattern, kept apart because two exceptions below turn on which kind matched: a
// test DIRECTORY, a file NAMED as a test, and a name that merely starts with `test-`.
const TEST_DIR_PATTERNS = [/(^|\/)__tests__\//, /(^|\/)tests?\//, /(^|\/)spec\//];
const TEST_NAME_PATTERNS = [
  /\.test\.[a-z]+$/, /\.spec\.[a-z]+$/, /_test\.[a-z]+$/, /_spec\.[a-z]+$/,
  /(^|\/)test_[^/]+\.py$/, /(^|\/)conftest\.py$/,
  // The hyphenated prefix is how shell and ops repos have named tests for decades — `test-foo.sh`
  // next to `foo.sh` — and bats is the other shell convention. Restricted to these extensions on
  // purpose: `src/test-utils.ts` is a helper, not a test.
  /\.bats$/,
  /Test[s]?\.(java|kt|cs|scala)$/, /Spec\.(kt|scala)$/,
];
const TEST_PREFIX_PATTERN = /(^|\/)test-[^/]+\.(sh|bash|zsh|py)$/;

// A runner's setup file: its config loads it, and it holds no test. In a test directory it was
// counted because of where it sits (`src/test/setup.ts`, #548). Only these names, and only when the
// directory is the sole reason: `tests/setup.test.js` is a test, `tests/helpers.ts` keeps its status.
const SETUP_FILE = /(^|\/)(?:setup|setup-?tests|test-?setup|(?:vitest|jest|playwright)\.setup|global-?setup|global-?teardown|teardown)\.[a-z]+$/i;

// Agent configuration. A hook or a skill's script under `.claude/` is named for what it guards —
// /cortex's own `.claude/hooks/test-paths.sh` fences the Tester — so there only a file NAMED as a
// test is one. Without this, installing the agent team raised the repo's test count by one.
const AGENT_CONFIG = /(^|\/)\.claude\//;

/**
 * Whether a file is the kind of thing that can BE a test: code, a script, or a `.bats` suite.
 *
 * The directory patterns above say where tests live, and a test directory also holds READMEs,
 * fixtures, snapshots and — once `/cortex-brief tests` has run — an `AGENTS.md`. On pmndrs/zustand
 * that brief made the index report 16 tests instead of 15, and because it names
 * `vitest.config.mts`, the coverage mention signal marked the config tested and the untested
 * finding shrank. Cortex's own output changed Cortex's findings. A document cannot run, so it
 * never tests anything; `lib/coverage.mjs` asks this too, so an index built before this rule
 * cannot lend coverage from one either.
 */
export function canBeTest(path) {
  if (/\.bats$/.test(path)) return true;
  const cat = categoryOf(detectLanguage(path));
  return cat === "code" || cat === "script";
}

export function isTestPath(path) {
  if (!canBeTest(path)) return false;
  if (TEST_NAME_PATTERNS.some((re) => re.test(path))) return true;
  if (AGENT_CONFIG.test(path)) return false;
  if (TEST_PREFIX_PATTERN.test(path)) return true;
  return TEST_DIR_PATTERNS.some((re) => re.test(path)) && !SETUP_FILE.test(path);
}

// Common entry points, used so an entry file is never reported as an unreferenced orphan.
const ENTRY_PATTERNS = [
  /^(src\/)?index\.[a-z]+$/, /^(src\/)?main\.[a-z]+$/, /^(src\/)?app\.[a-z]+$/,
  /^(src\/)?server\.[a-z]+$/, /^(src\/)?cli\.[a-z]+$/,
  /^main\.go$/, /(^|\/)cmd\/[^/]+\/main\.go$/, /^(src\/)?lib\.rs$/, /^(src\/)?main\.rs$/,
  /^manage\.py$/, /^wsgi\.py$/, /^asgi\.py$/, /^__main__\.py$/, /^Program\.cs$/,
];

export function isEntryPath(path) {
  return ENTRY_PATTERNS.some((re) => re.test(path));
}

// A JVM entry point is declared in the code, not by the file's name. `RestServiceApplication.java`
// under `src/main/java/com/example/` is where a Spring Boot service starts, and nothing imports it
// because the JVM, not another class, is its caller — so a path rule cannot see it and the orphan
// finding called the one file a service cannot run without "unreferenced" (#459).
//
// Deliberately two declarations and no more: `@SpringBootApplication`, and a `main` the launcher
// can call. Spring also discovers `@Configuration` and `@Component` classes by scanning, but those
// are an ordinary class's annotations, and treating them as entries would hide the dead
// configuration class that genuinely is worth checking. Read through `javaCode`, so a `main`
// quoted in a javadoc or a string is not one. Java 25's instance `void main()` is not recognised.
const JVM_ENTRY = {
  java: [
    /@(?:[\w$]+\.)*SpringBootApplication\b/,
    /\b(?:public\s+static|static\s+public)\s+(?:final\s+)?void\s+main\s*\(\s*(?:final\s+)?(?:java\.lang\.)?String\s*(?:\[\s*\]\s*[\w$]+|\.\.\.\s*[\w$]+|[\w$]+\s*\[\s*\])\s*\)/,
  ],
  kotlin: [
    /@(?:[\w$]+\.)*SpringBootApplication\b/,
    // Top-level `fun main` sits at column 0; a companion object's is marked `@JvmStatic`. An
    // indented `fun main` with neither is a method some class happens to call main.
    /^(?:(?:public|internal|suspend)\s+)*fun\s+main\s*\(/m,
    /@JvmStatic\s+(?:(?:public|suspend)\s+)*fun\s+main\s*\(/,
  ],
};

/** Whether this source declares itself a program entry point — a JVM `main` or a Spring Boot app. */
export function isEntrySource(text, lang) {
  const patterns = JVM_ENTRY[lang];
  if (!patterns || !text) return false;
  const code = javaCode(text);
  return patterns.some((re) => re.test(code));
}
