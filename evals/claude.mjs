// Starting the `claude` CLI, in one place. The skill runner (run.mjs) and the outcome harness
// (harness/run.mjs) both call it. The arguments stay with each caller, because they differ on
// purpose: one replaces the system prompt and allows no tools, the other is a working session.
//
// Nothing here knows what a call is for. It starts the process, feeds it stdin, kills it when told
// to, and reads the one JSON object `--output-format json` prints.

import { spawn } from "node:child_process";

export const claudeBin = () => process.env.CLAUDE_CLI_BIN || (process.platform === "win32" ? "claude.cmd" : "claude");

// Runs the CLI once and resolves { code, stdout, stderr } when it exits, whatever the exit code.
// Rejects only when the process could not be started. Aborting `signal` kills the process and
// everything it started.
export function spawnClaude({ bin = claudeBin(), args = [], cwd, env = process.env, input = "", signal }) {
  return new Promise((resolve, reject) => {
    // A .cmd shim cannot be spawned without a shell (Node refuses it since the 2024 batch-file fix),
    // and the shell joins argv unquoted, so quote each argument, including an empty one.
    const shell = /\.(cmd|bat)$/i.test(bin);
    const child = shell
      ? spawn([bin, ...args].map((a) => `"${a}"`).join(" "), { cwd, shell: true, env, windowsHide: true })
      : spawn(bin, args, { cwd, env, windowsHide: true });
    let stdout = "", stderr = "";
    child.stdout.on("data", (d) => { stdout += d; });
    child.stderr.on("data", (d) => { stderr += d; });
    child.on("error", reject);
    const kill = () => {
      if (process.platform === "win32") spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
      else child.kill("SIGKILL");
    };
    if (signal?.aborted) kill();
    else signal?.addEventListener("abort", kill, { once: true });
    child.on("close", (code) => resolve({ code, stdout, stderr }));
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
}

// The result object of `--output-format json`. Throws, naming the exit code and the end of what
// was printed, when stdout is not one JSON object: a login prompt, a crash, an empty answer.
export function parseResult({ code, stdout, stderr }) {
  let result;
  try { result = JSON.parse(stdout); } catch { throw new Error(`claude exited ${code}: ${(stderr || stdout).trim().slice(-300)}`); }
  if (result === null || typeof result !== "object" || Array.isArray(result)) throw new Error(`claude exited ${code}: not a result object`);
  return result;
}
