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

// Deliberately not `path.basename`: that resolves separators for the platform it runs on, and on
// POSIX a backslash is an ordinary character — so a Windows `AI_OS_ROOT` came back as one long
// segment and every repo install was misdetected as a vault. Which mode a root names is a fact
// about the string, not about the host, so both separators are split here explicitly.
export function detectMode(root) {
  const last = String(root ?? "").replace(/[\\/]+$/, "").split(/[\\/]/).pop();
  return last === ".cortex" ? REPO : VAULT;
}

export function isRepoMode(root) {
  return detectMode(root) === REPO;
}
