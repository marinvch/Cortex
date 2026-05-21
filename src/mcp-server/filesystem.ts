/**
 * filesystem.ts — Filesystem and process MCP tools for AI OS.
 *
 * Security model:
 * - readFile and listDirectory enforce path containment (no traversal outside ROOT)
 * - run_* tools (runTests, runLint, runBuild) are disabled by default and must be
 *   explicitly enabled via AI_OS_ALLOW_RUN_TOOLS=1 env var or allowRunTools in config.json
 * - No shell: true — all child processes use argv arrays only
 * - Output is capped at 8KB to prevent token blowout
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT } from './shared.js';

const MAX_OUTPUT_BYTES = 8 * 1024;
const MAX_FILE_BYTES = 32 * 1024;

const BLOCKED_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', '.next', '.nuxt',
  '__pycache__', '.venv', 'venv', 'target', 'vendor', '.cache', '.gradle',
]);

/** Resolve a user-supplied path and verify it is within ROOT (no path traversal). */
function resolveSafe(userPath: string): string | null {
  const resolved = path.resolve(ROOT, userPath);
  if (!resolved.startsWith(ROOT + path.sep) && resolved !== ROOT) return null;
  return resolved;
}

/**
 * Read the content of a file within the project root.
 * Rejects paths that traverse outside the root (../../etc/passwd etc.).
 */
export function readFile(filePath: string): string {
  if (!filePath || typeof filePath !== 'string') {
    return 'Error: filePath is required';
  }
  const resolved = resolveSafe(filePath);
  if (!resolved) {
    return `Error: path traversal detected — "${filePath}" is outside the project root`;
  }
  if (!fs.existsSync(resolved)) {
    return `Error: file not found: ${filePath}`;
  }
  if (!fs.statSync(resolved).isFile()) {
    return `Error: not a file: ${filePath}`;
  }
  const size = fs.statSync(resolved).size;
  if (size > MAX_FILE_BYTES) {
    return `File is too large to read inline (${size} bytes). Use search_codebase to find specific sections.`;
  }
  try {
    return fs.readFileSync(resolved, 'utf-8');
  } catch (e) {
    return `Error reading file: ${e instanceof Error ? e.message : String(e)}`;
  }
}

/**
 * List directory contents with basic metadata.
 * Rejects paths that traverse outside the root.
 */
export function listDirectory(dirPath: string): string {
  const target = dirPath || '.';
  const resolved = resolveSafe(target);
  if (!resolved) {
    return `Error: path traversal detected — "${target}" is outside the project root`;
  }
  if (!fs.existsSync(resolved)) {
    return `Error: directory not found: ${target}`;
  }
  if (!fs.statSync(resolved).isDirectory()) {
    return `Error: not a directory: ${target}`;
  }
  try {
    const entries = fs.readdirSync(resolved, { withFileTypes: true })
      .filter(e => !BLOCKED_DIRS.has(e.name))
      .sort((a, b) => {
        if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
    const lines = entries.map(e => {
      if (e.isDirectory()) return `${e.name}/  [dir]`;
      try {
        const stat = fs.statSync(path.join(resolved, e.name));
        return `${e.name}  (${stat.size} bytes)`;
      } catch {
        return e.name;
      }
    });
    const relativePath = path.relative(ROOT, resolved).replace(/\\/g, '/') || '.';
    return `Directory: ${relativePath}\n\n${lines.join('\n')}`;
  } catch (e) {
    return `Error listing directory: ${e instanceof Error ? e.message : String(e)}`;
  }
}

/** Returns true when run-tool execution is allowed. */
function runToolsAllowed(): boolean {
  if (process.env['AI_OS_ALLOW_RUN_TOOLS'] === '1') return true;
  const configPath = path.join(ROOT, '.github', 'ai-os', 'config.json');
  try {
    const cfg = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as { allowRunTools?: boolean };
    return cfg.allowRunTools === true;
  } catch {
    return false;
  }
}

/** Detect the package manager from package.json / lock files. */
function detectPackageManager(): string {
  if (fs.existsSync(path.join(ROOT, 'bun.lockb'))) return 'bun';
  if (fs.existsSync(path.join(ROOT, 'pnpm-lock.yaml'))) return 'pnpm';
  if (fs.existsSync(path.join(ROOT, 'yarn.lock'))) return 'yarn';
  return 'npm';
}

function runScript(scriptName: string): string {
  if (!runToolsAllowed()) {
    return `run_* tools are disabled by default. Set AI_OS_ALLOW_RUN_TOOLS=1 or "allowRunTools": true in .github/ai-os/config.json to enable.`;
  }
  const pm = detectPackageManager();
  let cmd: string;
  let args: string[];
  if (pm === 'bun') {
    cmd = 'bun'; args = ['run', scriptName];
  } else if (pm === 'pnpm') {
    cmd = 'pnpm'; args = ['run', scriptName];
  } else if (pm === 'yarn') {
    cmd = 'yarn'; args = [scriptName];
  } else {
    cmd = 'npm'; args = ['run', scriptName];
  }
  try {
    const result = spawnSync(cmd, args, {
      cwd: ROOT,
      maxBuffer: MAX_OUTPUT_BYTES * 2,
      timeout: 120_000,
      encoding: 'utf-8',
    });
    const stdout = result.stdout ?? '';
    const stderr = result.stderr ?? '';
    const combined = [stdout, stderr].filter(Boolean).join('\n').slice(0, MAX_OUTPUT_BYTES);
    const exitCode = result.status ?? (result.error ? 1 : 0);
    return `Exit code: ${exitCode}\n\n${combined}`;
  } catch (e) {
    return `Error running ${scriptName}: ${e instanceof Error ? e.message : String(e)}`;
  }
}

/** Run the project test suite (requires explicit opt-in). */
export function runTests(): string {
  return runScript('test');
}

/** Run the project linter (requires explicit opt-in). */
export function runLint(): string {
  return runScript('lint');
}

/** Run the project build (requires explicit opt-in). */
export function runBuild(): string {
  return runScript('build');
}
