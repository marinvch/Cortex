import { basename } from "node:path";

// The same MCP server serves two different worlds, and which one it is in is decided entirely by
// the root it was pointed at:
//
//   repo  — AI_OS_ROOT is a <repo>/.cortex directory. Memory is committed and shared by the team;
//           the tools are about this codebase.
//   vault — AI_OS_ROOT is a personal Cortex vault. The original inbox/daily/projects tools apply.
//
// Detecting rather than configuring keeps the plugin manifest to a single env var, and makes a
// misconfiguration obvious: point it at the wrong directory and the tool list changes.

export const REPO = "repo";
export const VAULT = "vault";

export function detectMode(root) {
  return basename(String(root ?? "").replace(/[\\/]+$/, "")) === ".cortex" ? REPO : VAULT;
}

export function isRepoMode(root) {
  return detectMode(root) === REPO;
}
