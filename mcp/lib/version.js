import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// The repo-root VERSION file is the single source of truth. Reading it here (rather than
// hardcoding a string) is what stops server.js, package.json and the docs from drifting apart —
// they already did once between 1.0.0 and 1.1.0.
const REPO_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url)))); // mcp/lib/version.js → repo root

export function readVersion(repoRoot = REPO_ROOT) {
  try {
    const v = readFileSync(join(repoRoot, "VERSION"), "utf8").trim();
    if (v) return v;
  } catch { /* fall through to the packaged version */ }
  try {
    return JSON.parse(readFileSync(join(repoRoot, "mcp", "package.json"), "utf8")).version || "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export const VERSION = readVersion();
