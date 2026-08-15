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
const TEST_PATTERNS = [
  /(^|\/)__tests__\//, /(^|\/)tests?\//, /(^|\/)spec\//,
  /\.test\.[a-z]+$/, /\.spec\.[a-z]+$/, /_test\.[a-z]+$/, /_spec\.[a-z]+$/,
  /(^|\/)test_[^/]+\.py$/, /(^|\/)conftest\.py$/,
  /Test[s]?\.(java|kt|cs|scala)$/, /Spec\.(kt|scala)$/,
];

export function isTestPath(path) {
  return TEST_PATTERNS.some((re) => re.test(path));
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
