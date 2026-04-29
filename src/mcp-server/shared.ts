/**
 * shared.ts — private internal helpers for mcp-server sub-modules.
 * Not part of the public barrel (utils.ts). Sub-modules import from here
 * to avoid circular dependencies with utils.ts.
 */
import fs from 'node:fs';
import path from 'node:path';

// ── Project root ───────────────────────────────────────────────────────────────

export const ROOT = process.env['AI_OS_ROOT'] ?? process.cwd();

export function readAiOsFile(relPath: string): string {
  try {
    return fs.readFileSync(path.join(ROOT, '.github', 'ai-os', relPath), 'utf-8');
  } catch {
    return '';
  }
}

// ── File path helpers ──────────────────────────────────────────────────────────

export function getMemoryFilePath(): string {
  return path.join(ROOT, '.github', 'ai-os', 'memory', 'memory.jsonl');
}

export function getMemoryDirPath(): string {
  return path.join(ROOT, '.github', 'ai-os', 'memory');
}

export function getMemoryLockFilePath(): string {
  return path.join(getMemoryDirPath(), '.memory.lock');
}

export function getSessionMemoryDirPath(): string {
  return path.join(getMemoryDirPath(), 'session');
}

export function getSessionLockFilePath(): string {
  return path.join(getSessionMemoryDirPath(), '.session.lock');
}

export function getActivePlanPath(): string {
  return path.join(getSessionMemoryDirPath(), 'active-plan.json');
}

export function getCheckpointLogPath(): string {
  return path.join(getSessionMemoryDirPath(), 'checkpoints.jsonl');
}

export function getFailureLedgerPath(): string {
  return path.join(getSessionMemoryDirPath(), 'failure-ledger.jsonl');
}

export function getCompactContextPath(): string {
  return path.join(getSessionMemoryDirPath(), 'compact-context.md');
}

export function getRuntimeStatePath(): string {
  return path.join(getSessionMemoryDirPath(), 'runtime-state.json');
}

// ── Ensure store helpers ───────────────────────────────────────────────────────

export function ensureMemoryStore(): void {
  const memoryDir = getMemoryDirPath();
  if (!fs.existsSync(memoryDir)) {
    fs.mkdirSync(memoryDir, { recursive: true });
  }
  const memoryFile = getMemoryFilePath();
  if (!fs.existsSync(memoryFile)) {
    fs.writeFileSync(memoryFile, '', 'utf-8');
  }
}

export function ensureSessionMemoryStore(): void {
  ensureMemoryStore();
  const sessionDir = getSessionMemoryDirPath();
  if (!fs.existsSync(sessionDir)) {
    fs.mkdirSync(sessionDir, { recursive: true });
  }
  const checkpointsPath = getCheckpointLogPath();
  if (!fs.existsSync(checkpointsPath)) {
    fs.writeFileSync(checkpointsPath, '', 'utf-8');
  }
  const failurePath = getFailureLedgerPath();
  if (!fs.existsSync(failurePath)) {
    fs.writeFileSync(failurePath, '', 'utf-8');
  }
}

// ── I/O utilities ──────────────────────────────────────────────────────────────

export function writeTextAtomic(filePath: string, content: string): void {
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tempPath, content, 'utf-8');
  fs.renameSync(tempPath, filePath);
}

export function readJsonlFile<T>(filePath: string): T[] {
  if (!fs.existsSync(filePath)) return [];
  const lines = fs.readFileSync(filePath, 'utf-8').split('\n').map((line) => line.trim()).filter(Boolean);
  const rows: T[] = [];
  for (const line of lines) {
    try {
      rows.push(JSON.parse(line) as T);
    } catch {
      // Ignore malformed lines in session artifacts.
    }
  }
  return rows;
}

export function sleepSync(ms: number): void {
  const shared = new SharedArrayBuffer(4);
  const int32 = new Int32Array(shared);
  Atomics.wait(int32, 0, 0, ms);
}

export function trimJsonlFileToCap(filePath: string, cap: number): void {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, 'utf-8').split('\n').filter(Boolean);
  if (lines.length <= cap) return;
  writeTextAtomic(filePath, lines.slice(lines.length - cap).join('\n') + '\n');
}

// ── Lock constants (private to this module) ────────────────────────────────────

const MEMORY_LOCK_WAIT_MS = 2000;
const MEMORY_LOCK_RETRY_MS = 50;
const MEMORY_LOCK_STALE_MS = 15000;
const SESSION_LOCK_WAIT_MS = 1000;
const SESSION_LOCK_RETRY_MS = 30;

// ── Lock cleanup on process exit / signal ─────────────────────────────────────
// Track the currently held lock path so exit/signal handlers can release it
// even when the process is terminated before the finally block executes.
let _activeLockPath: string | null = null;

function _releaseLockOnExit(): void {
  if (_activeLockPath) {
    try {
      fs.unlinkSync(_activeLockPath);
    } catch {
      // Best-effort cleanup — file may already be gone.
    }
    _activeLockPath = null;
  }
}

// Runs when process.exit() is called (covers normal exits, healthcheck, errors).
process.on('exit', _releaseLockOnExit);

// ── Session lock — separate lighter-weight lock for session-only files ─────────
// Session files (.github/ai-os/memory/session/*) are distinct from the durable
// repo memory store (memory.jsonl). Using a dedicated lock prevents session ops
// (which run on every tool call) from blocking durable memory reads/writes.
let _activeSessionLockPath: string | null = null;

function _releaseSessionLockOnExit(): void {
  if (_activeSessionLockPath) {
    try { fs.unlinkSync(_activeSessionLockPath); } catch { /* Best-effort cleanup. */ }
    _activeSessionLockPath = null;
  }
}

process.on('exit', _releaseSessionLockOnExit);

export function withSessionLock<T>(fn: () => T): T {
  ensureSessionMemoryStore();
  const lockPath = getSessionLockFilePath();
  const startedAt = Date.now();
  let lockFd: number | null = null;

  while (Date.now() - startedAt < SESSION_LOCK_WAIT_MS) {
    try {
      lockFd = fs.openSync(lockPath, 'wx');
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;

      try {
        const lockStat = fs.statSync(lockPath);
        if (Date.now() - lockStat.mtimeMs > MEMORY_LOCK_STALE_MS) {
          fs.unlinkSync(lockPath);
          continue;
        }
      } catch { /* Best effort only. */ }

      sleepSync(SESSION_LOCK_RETRY_MS);
    }
  }

  if (lockFd === null) {
    // Session lock timed out — proceed without lock as degraded fallback.
    // Session files are non-critical; a missed write is preferable to blocking a tool call.
    return fn();
  }

  _activeSessionLockPath = lockPath;

  try {
    return fn();
  } finally {
    _activeSessionLockPath = null;
    try { fs.closeSync(lockFd); } catch { /* Best-effort cleanup. */ }
    try { fs.unlinkSync(lockPath); } catch { /* Best-effort cleanup. */ }
  }
}

export function withMemoryLock<T>(fn: () => T): T {
  ensureMemoryStore();
  const lockPath = getMemoryLockFilePath();
  const startedAt = Date.now();
  let lockFd: number | null = null;

  while (Date.now() - startedAt < MEMORY_LOCK_WAIT_MS) {
    try {
      lockFd = fs.openSync(lockPath, 'wx');
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw err;
      }

      // Recover stale lock files left behind by abrupt process termination.
      try {
        const lockStat = fs.statSync(lockPath);
        if (Date.now() - lockStat.mtimeMs > MEMORY_LOCK_STALE_MS) {
          fs.unlinkSync(lockPath);
          continue;
        }
      } catch {
        // Best effort only; if stat/unlink fails, keep waiting until timeout.
      }

      sleepSync(MEMORY_LOCK_RETRY_MS);
    }
  }

  if (lockFd === null) {
    throw new Error('Timed out waiting for repository memory lock.');
  }

  _activeLockPath = lockPath; // Register for signal-handler cleanup.

  try {
    return fn();
  } finally {
    _activeLockPath = null; // Unregister before explicit cleanup.

    try {
      fs.closeSync(lockFd);
    } catch {
      // Best-effort cleanup.
    }

    try {
      fs.unlinkSync(lockPath);
    } catch {
      // Best-effort cleanup.
    }
  }
}
