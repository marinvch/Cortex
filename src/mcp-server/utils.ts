import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getLatestResolvableVersion } from '../updater.js';

const ROOT = process.env['AI_OS_ROOT'] ?? process.cwd();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function getProjectRoot(): string {
  return path.resolve(ROOT);
}

export function readAiOsFile(relPath: string): string {
  try {
    return fs.readFileSync(path.join(ROOT, '.github', 'ai-os', relPath), 'utf-8');
  } catch {
    return '';
  }
}

interface RepoMemoryEntry {
  id: string;
  createdAt: string;
  updatedAt?: string;
  title: string;
  content: string;
  category: string;
  tags: string[];
  fingerprint?: string;
  status?: 'active' | 'stale';
  staleReason?: string;
  supersedesId?: string;
  conflictWithId?: string;
}

interface ActivePlan {
  objective: string;
  acceptanceCriteria: string;
  status: 'active' | 'paused' | 'completed';
  currentStep?: string;
  nextStep?: string;
  blockers: string[];
  createdAt: string;
  updatedAt: string;
}

interface CheckpointEntry {
  id: string;
  title: string;
  status: 'open' | 'closed';
  notes?: string;
  toolCallCount?: number;
  createdAt: string;
  closedAt?: string;
}

interface FailurePatternEntry {
  id: string;
  tool: string;
  errorSignature: string;
  rootCause: string;
  attemptedFix: string;
  outcome: 'unresolved' | 'partial' | 'resolved';
  confidence: number;
  occurrences: number;
  firstSeenAt: string;
  lastSeenAt: string;
}

interface RuntimeState {
  toolCallCount: number;
  lastWatchdogCheckpointCount: number;
  threshold: number;
  updatedAt: string;
}

interface MemoryReadResult {
  entries: RepoMemoryEntry[];
  malformedCount: number;
}

const MEMORY_STALE_DAYS = 180;
const MEMORY_LOCK_WAIT_MS = 2000;
const MEMORY_LOCK_RETRY_MS = 50;
const MEMORY_LOCK_STALE_MS = 15000;
const DEFAULT_WATCHDOG_THRESHOLD = 8;
const SESSION_LOCK_WAIT_MS = 1000;
const SESSION_LOCK_RETRY_MS = 30;
const SESSION_CHECKPOINTS_CAP = 100;
const SESSION_FAILURES_CAP = 50;

function getMemoryFilePath(): string {
  return path.join(ROOT, '.github', 'ai-os', 'memory', 'memory.jsonl');
}

function getMemoryDirPath(): string {
  return path.join(ROOT, '.github', 'ai-os', 'memory');
}

function getMemoryLockFilePath(): string {
  return path.join(getMemoryDirPath(), '.memory.lock');
}

function getSessionMemoryDirPath(): string {
  return path.join(getMemoryDirPath(), 'session');
}

function getSessionLockFilePath(): string {
  return path.join(getSessionMemoryDirPath(), '.session.lock');
}

function getActivePlanPath(): string {
  return path.join(getSessionMemoryDirPath(), 'active-plan.json');
}

function getCheckpointLogPath(): string {
  return path.join(getSessionMemoryDirPath(), 'checkpoints.jsonl');
}

function getFailureLedgerPath(): string {
  return path.join(getSessionMemoryDirPath(), 'failure-ledger.jsonl');
}

function getCompactContextPath(): string {
  return path.join(getSessionMemoryDirPath(), 'compact-context.md');
}

function getRuntimeStatePath(): string {
  return path.join(getSessionMemoryDirPath(), 'runtime-state.json');
}

function ensureMemoryStore(): void {
  const memoryDir = getMemoryDirPath();
  if (!fs.existsSync(memoryDir)) {
    fs.mkdirSync(memoryDir, { recursive: true });
  }

  const memoryFile = getMemoryFilePath();
  if (!fs.existsSync(memoryFile)) {
    fs.writeFileSync(memoryFile, '', 'utf-8');
  }
}

function ensureSessionMemoryStore(): void {
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

function writeTextAtomic(filePath: string, content: string): void {
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tempPath, content, 'utf-8');
  fs.renameSync(tempPath, filePath);
}

function readJsonlFile<T>(filePath: string): T[] {
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

function readRuntimeState(): RuntimeState {
  const filePath = getRuntimeStatePath();
  const fallback: RuntimeState = {
    toolCallCount: 0,
    lastWatchdogCheckpointCount: 0,
    threshold: DEFAULT_WATCHDOG_THRESHOLD,
    updatedAt: new Date().toISOString(),
  };

  if (!fs.existsSync(filePath)) return fallback;

  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Partial<RuntimeState>;
    const threshold = typeof raw.threshold === 'number' && raw.threshold >= 1
      ? Math.floor(raw.threshold)
      : DEFAULT_WATCHDOG_THRESHOLD;

    return {
      toolCallCount: typeof raw.toolCallCount === 'number' ? Math.max(0, Math.floor(raw.toolCallCount)) : 0,
      lastWatchdogCheckpointCount: typeof raw.lastWatchdogCheckpointCount === 'number'
        ? Math.max(0, Math.floor(raw.lastWatchdogCheckpointCount))
        : 0,
      threshold,
      updatedAt: typeof raw.updatedAt === 'string' && raw.updatedAt.trim()
        ? raw.updatedAt
        : new Date().toISOString(),
    };
  } catch {
    return fallback;
  }
}

function writeRuntimeState(state: RuntimeState): void {
  writeTextAtomic(getRuntimeStatePath(), JSON.stringify(state, null, 2));
}

function normalizeFailureText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function sleepSync(ms: number): void {
  const shared = new SharedArrayBuffer(4);
  const int32 = new Int32Array(shared);
  Atomics.wait(int32, 0, 0, ms);
}

// ── Lock cleanup on process exit / signal ────────────────────────────────────
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

// ── Session lock — separate lighter-weight lock for session-only files ────────
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

function withSessionLock<T>(fn: () => T): T {
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

function withMemoryLock<T>(fn: () => T): T {
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
      // This reduces lock-contention failures without relaxing normal locking behavior.
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

function normalizeWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function normalizeMemoryText(value: string): string {
  return normalizeWhitespace(value).toLowerCase();
}

function normalizeTags(tags: string[]): string[] {
  return [...new Set(tags.map((tag) => normalizeMemoryText(tag)).filter(Boolean))].sort();
}

function buildMemoryKey(entry: Pick<RepoMemoryEntry, 'title' | 'category'>): string {
  return `${normalizeMemoryText(entry.category)}::${normalizeMemoryText(entry.title)}`;
}

function buildFingerprint(entry: Pick<RepoMemoryEntry, 'title' | 'category' | 'content'>): string {
  return `${buildMemoryKey(entry)}::${normalizeMemoryText(entry.content)}`;
}

function toIsoDate(dateValue?: string): string {
  const parsed = dateValue ? new Date(dateValue) : new Date();
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

function ageInDays(isoDate: string): number {
  const dt = new Date(isoDate);
  if (Number.isNaN(dt.getTime())) return 0;
  return Math.floor((Date.now() - dt.getTime()) / (1000 * 60 * 60 * 24));
}

function canonicalizeEntry(raw: Partial<RepoMemoryEntry>): RepoMemoryEntry | null {
  const title = typeof raw.title === 'string' ? normalizeWhitespace(raw.title) : '';
  const content = typeof raw.content === 'string' ? normalizeWhitespace(raw.content) : '';
  if (!title || !content) return null;

  const category = typeof raw.category === 'string' && raw.category.trim()
    ? normalizeMemoryText(raw.category)
    : 'general';

  const createdAt = toIsoDate(raw.createdAt);
  const updatedAt = raw.updatedAt ? toIsoDate(raw.updatedAt) : undefined;
  const id = typeof raw.id === 'string' && raw.id.trim()
    ? raw.id.trim()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const tags = normalizeTags(Array.isArray(raw.tags) ? raw.tags.filter((tag): tag is string => typeof tag === 'string') : []);
  const status = raw.status === 'stale' ? 'stale' : 'active';
  const fingerprint = buildFingerprint({ title, content, category });

  return {
    id,
    createdAt,
    updatedAt,
    title,
    content,
    category,
    tags,
    fingerprint,
    status,
    staleReason: typeof raw.staleReason === 'string' ? raw.staleReason : undefined,
    supersedesId: typeof raw.supersedesId === 'string' ? raw.supersedesId : undefined,
    conflictWithId: typeof raw.conflictWithId === 'string' ? raw.conflictWithId : undefined,
  };
}

function sortByRecencyDesc(a: RepoMemoryEntry, b: RepoMemoryEntry): number {
  const aTime = new Date(a.updatedAt ?? a.createdAt).getTime();
  const bTime = new Date(b.updatedAt ?? b.createdAt).getTime();
  return bTime - aTime;
}

function applyStalePolicy(entries: RepoMemoryEntry[]): RepoMemoryEntry[] {
  const byKey = new Map<string, RepoMemoryEntry[]>();
  for (const entry of entries) {
    const key = buildMemoryKey(entry);
    const list = byKey.get(key) ?? [];
    list.push(entry);
    byKey.set(key, list);
  }

  for (const [, list] of byKey) {
    list.sort(sortByRecencyDesc);
    let activeSeen = false;
    for (const entry of list) {
      if (entry.status === 'stale') continue;

      if (!activeSeen) {
        activeSeen = true;
        continue;
      }

      entry.status = 'stale';
      entry.staleReason = entry.staleReason ?? 'superseded-by-newer-entry';
      entry.updatedAt = toIsoDate(entry.updatedAt);
    }
  }

  for (const entry of entries) {
    if (entry.status === 'stale') continue;
    if (ageInDays(entry.updatedAt ?? entry.createdAt) > MEMORY_STALE_DAYS) {
      entry.status = 'stale';
      entry.staleReason = entry.staleReason ?? `auto-stale-${MEMORY_STALE_DAYS}d`;
      entry.updatedAt = toIsoDate(entry.updatedAt);
    }
  }

  return entries;
}

function dedupeEntries(entries: RepoMemoryEntry[]): RepoMemoryEntry[] {
  const seen = new Map<string, RepoMemoryEntry>();
  const ordered = [...entries].sort(sortByRecencyDesc);

  for (const entry of ordered) {
    const dedupeKey = `${entry.fingerprint ?? buildFingerprint(entry)}::${entry.status ?? 'active'}`;
    if (!seen.has(dedupeKey)) {
      seen.set(dedupeKey, entry);
      continue;
    }

    const kept = seen.get(dedupeKey)!;
    kept.tags = normalizeTags([...kept.tags, ...entry.tags]);
  }

  return [...seen.values()].sort(sortByRecencyDesc);
}

function serializeEntries(entries: RepoMemoryEntry[]): string {
  return entries.map((entry) => JSON.stringify(entry)).join('\n') + (entries.length > 0 ? '\n' : '');
}

function writeMemoryEntriesAtomic(entries: RepoMemoryEntry[]): void {
  const memoryPath = getMemoryFilePath();
  const tempPath = `${memoryPath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tempPath, serializeEntries(entries), 'utf-8');
  fs.renameSync(tempPath, memoryPath);
}

/**
 * Trim a JSONL file to the most recent `cap` lines (by append order).
 * No-op if the file has fewer entries than `cap`.
 */
function trimJsonlFileToCap(filePath: string, cap: number): void {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, 'utf-8').split('\n').filter(Boolean);
  if (lines.length <= cap) return;
  writeTextAtomic(filePath, lines.slice(lines.length - cap).join('\n') + '\n');
}

function readMemoryEntries(): MemoryReadResult {
  ensureMemoryStore();
  const file = getMemoryFilePath();
  const content = fs.readFileSync(file, 'utf-8');
  const lines = content.split('\n').map((line) => line.trim()).filter(Boolean);
  const entries: RepoMemoryEntry[] = [];
  let malformedCount = 0;

  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as Partial<RepoMemoryEntry>;
      const canonical = canonicalizeEntry(parsed);
      if (canonical) entries.push(canonical);
      else malformedCount += 1;
    } catch {
      malformedCount += 1;
    }
  }

  return {
    entries: applyStalePolicy(dedupeEntries(entries)),
    malformedCount,
  };
}

function recoverMalformedMemoryIfNeeded(result: MemoryReadResult): void {
  if (result.malformedCount <= 0) return;
  writeMemoryEntriesAtomic(result.entries);
}

export function getMemoryGuidelines(): string {
  const guidelines = readAiOsFile('context/memory.md');
  return guidelines || 'No memory guidelines found. Re-run AI OS generation to create .github/ai-os/context/memory.md.';
}

export function getRepoMemory(query?: string, category?: string, limit?: number): string {
  const { entries, malformedCount } = readMemoryEntries();
  const q = (query ?? '').trim().toLowerCase();
  const c = (category ?? '').trim().toLowerCase();
  const cap = Math.max(1, Math.min(limit ?? 10, 50));

  const filtered = entries
    .filter((entry) => {
      if (c && entry.category.toLowerCase() !== c) return false;
      if (!q) return true;

      const haystack = [entry.title, entry.content, entry.category, ...entry.tags]
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    })
    .slice(0, cap);

  if (filtered.length === 0) {
    return 'No repository memory entries found for the provided filters.';
  }

  const activeCount = entries.filter((entry) => entry.status !== 'stale').length;
  const staleCount = entries.length - activeCount;

  const lines: string[] = [
    '## Repository Memory',
    '',
    `- Total entries: ${entries.length}`,
    `- Active: ${activeCount}`,
    `- Stale: ${staleCount}`,
  ];

  if (malformedCount > 0) {
    lines.push(`- Malformed lines skipped: ${malformedCount} (recovery is applied on next write)`);
  }

  for (const entry of filtered) {
    lines.push('');
    const state = entry.status === 'stale' ? 'stale' : 'active';
    lines.push(`- **${entry.title}** [${entry.category}] (${state})`);
    lines.push(`  - Created: ${entry.createdAt}`);
    lines.push(`  - Updated: ${entry.updatedAt ?? entry.createdAt}`);
    if (entry.tags.length > 0) {
      lines.push(`  - Tags: ${entry.tags.join(', ')}`);
    }
    if (entry.staleReason) {
      lines.push(`  - Stale reason: ${entry.staleReason}`);
    }
    if (entry.conflictWithId) {
      lines.push(`  - Conflict marker: supersedes ${entry.conflictWithId}`);
    }
    lines.push(`  - ${entry.content}`);
  }

  return lines.join('\n');
}

export function rememberRepoFact(title: string, content: string, category?: string, tags?: string): string {
  const trimmedTitle = title.trim();
  const trimmedContent = content.trim();
  if (!trimmedTitle || !trimmedContent) {
    return 'Both title and content are required to store memory.';
  }

  try {
    return withMemoryLock(() => {
      const now = new Date().toISOString();
      const incoming = canonicalizeEntry({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        createdAt: now,
        updatedAt: now,
        title: trimmedTitle,
        content: trimmedContent,
        category: category?.trim() || 'general',
        tags: (tags ?? '').split(',').map((tag) => tag.trim()),
        status: 'active',
      });

      if (!incoming) {
        return 'Invalid memory payload. Title and content are required.';
      }

      const parsed = readMemoryEntries();
      const entries = parsed.entries;
      recoverMalformedMemoryIfNeeded(parsed);

      const key = buildMemoryKey(incoming);
      const sameKey = entries
        .filter((entry) => buildMemoryKey(entry) === key)
        .sort(sortByRecencyDesc);

      const sameFingerprint = sameKey.find((entry) => (entry.fingerprint ?? buildFingerprint(entry)) === incoming.fingerprint);
      if (sameFingerprint) {
        const mergedTags = normalizeTags([...sameFingerprint.tags, ...incoming.tags]);
        const tagsChanged = mergedTags.length !== sameFingerprint.tags.length;

        if (tagsChanged) {
          sameFingerprint.tags = mergedTags;
          sameFingerprint.updatedAt = now;
          writeMemoryEntriesAtomic(dedupeEntries(applyStalePolicy(entries)));
          return `Updated memory tags for existing fact: ${sameFingerprint.title} (${sameFingerprint.category})`;
        }

        return `Skipped duplicate memory fact: ${sameFingerprint.title} (${sameFingerprint.category})`;
      }

      const currentActive = sameKey.find((entry) => entry.status !== 'stale');
      if (currentActive) {
        currentActive.status = 'stale';
        currentActive.staleReason = 'superseded-by-conflicting-update';
        currentActive.updatedAt = now;
        incoming.supersedesId = currentActive.id;
        incoming.conflictWithId = currentActive.id;
      }

      entries.push(incoming);

      const normalized = dedupeEntries(applyStalePolicy(entries));
      writeMemoryEntriesAtomic(normalized);

      if (currentActive) {
        return `Stored memory entry with conflict marker: ${incoming.title} (${incoming.category})`;
      }

      return `Stored memory entry: ${incoming.title} (${incoming.category})`;
    });
  } catch (err) {
    return `Failed to store memory entry: ${err instanceof Error ? err.message : String(err)}`;
  }
}

export function getActivePlan(): string {
  ensureSessionMemoryStore();
  const filePath = getActivePlanPath();

  if (!fs.existsSync(filePath)) {
    return 'No active session plan found. Create one with `upsert_active_plan`.';
  }

  try {
    const plan = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as ActivePlan;
    const lines: string[] = [
      '## Active Plan',
      '',
      `- Objective: ${plan.objective}`,
      `- Acceptance Criteria: ${plan.acceptanceCriteria}`,
      `- Status: ${plan.status}`,
      `- Created: ${plan.createdAt}`,
      `- Updated: ${plan.updatedAt}`,
    ];

    if (plan.currentStep) lines.push(`- Current Step: ${plan.currentStep}`);
    if (plan.nextStep) lines.push(`- Next Step: ${plan.nextStep}`);

    lines.push('- Blockers:');
    if (plan.blockers.length === 0) {
      lines.push('  - none');
    } else {
      for (const blocker of plan.blockers) {
        lines.push(`  - ${blocker}`);
      }
    }

    return lines.join('\n');
  } catch {
    return 'Failed to read active plan. Recreate it with `upsert_active_plan`.';
  }
}

export function upsertActivePlan(
  objective: string,
  acceptanceCriteria: string,
  status?: string,
  currentStep?: string,
  nextStep?: string,
  blockers?: string,
): string {
  const trimmedObjective = objective.trim();
  const trimmedCriteria = acceptanceCriteria.trim();

  if (!trimmedObjective || !trimmedCriteria) {
    return 'Both objective and acceptanceCriteria are required to upsert active plan.';
  }

  const now = new Date().toISOString();
  const normalizedStatus = status === 'paused' || status === 'completed' ? status : 'active';
  const blockerList = (blockers ?? '')
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);

  try {
    return withSessionLock(() => {
      ensureSessionMemoryStore();
      const filePath = getActivePlanPath();
      const existing: Partial<ActivePlan> = fs.existsSync(filePath)
        ? JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Partial<ActivePlan>
        : {};

      const plan: ActivePlan = {
        objective: trimmedObjective,
        acceptanceCriteria: trimmedCriteria,
        status: normalizedStatus,
        currentStep: currentStep?.trim() || existing.currentStep,
        nextStep: nextStep?.trim() || existing.nextStep,
        blockers: blockerList.length > 0 ? blockerList : (existing.blockers ?? []),
        createdAt: existing.createdAt ?? now,
        updatedAt: now,
      };

      writeTextAtomic(filePath, JSON.stringify(plan, null, 2));
      return `Active plan upserted (${plan.status}).`;
    });
  } catch (err) {
    return `Failed to upsert active plan: ${err instanceof Error ? err.message : String(err)}`;
  }
}

export function appendCheckpoint(title: string, status?: string, notes?: string, toolCallCount?: number): string {
  const trimmedTitle = title.trim();
  if (!trimmedTitle) {
    return 'Checkpoint title is required.';
  }

  const now = new Date().toISOString();
  const normalizedStatus = status === 'closed' ? 'closed' : 'open';
  const entry: CheckpointEntry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title: trimmedTitle,
    status: normalizedStatus,
    notes: notes?.trim() || undefined,
    toolCallCount: typeof toolCallCount === 'number' ? toolCallCount : undefined,
    createdAt: now,
    closedAt: normalizedStatus === 'closed' ? now : undefined,
  };

  try {
    return withSessionLock(() => {
      ensureSessionMemoryStore();
      const filePath = getCheckpointLogPath();
      fs.appendFileSync(filePath, `${JSON.stringify(entry)}\n`, 'utf-8');
      trimJsonlFileToCap(filePath, SESSION_CHECKPOINTS_CAP);
      return `Checkpoint appended: ${entry.id}`;
    });
  } catch (err) {
    return `Failed to append checkpoint: ${err instanceof Error ? err.message : String(err)}`;
  }
}

export function closeCheckpoint(checkpointId: string, notes?: string): string {
  const id = checkpointId.trim();
  if (!id) {
    return 'checkpointId is required.';
  }

  try {
    return withSessionLock(() => {
      ensureSessionMemoryStore();
      const filePath = getCheckpointLogPath();
      const entries = readJsonlFile<CheckpointEntry>(filePath);
      const index = entries.findIndex((entry) => entry.id === id);

      if (index < 0) {
        return `Checkpoint not found: ${id}`;
      }

      const now = new Date().toISOString();
      const existingNotes = entries[index].notes?.trim();
      const closingNotes = notes?.trim();
      const mergedNotes = [existingNotes, closingNotes].filter(Boolean).join(' | ');

      entries[index] = {
        ...entries[index],
        status: 'closed',
        notes: mergedNotes || undefined,
        closedAt: now,
      };

      writeTextAtomic(filePath, entries.map((entry) => JSON.stringify(entry)).join('\n') + (entries.length ? '\n' : ''));
      return `Checkpoint closed: ${id}`;
    });
  } catch (err) {
    return `Failed to close checkpoint: ${err instanceof Error ? err.message : String(err)}`;
  }
}

export function recordFailurePattern(
  tool: string,
  errorSignature: string,
  rootCause: string,
  attemptedFix: string,
  outcome?: string,
  confidence?: number,
): string {
  const trimmedTool = tool.trim();
  const trimmedSignature = errorSignature.trim();
  const trimmedRootCause = rootCause.trim();
  const trimmedFix = attemptedFix.trim();

  if (!trimmedTool || !trimmedSignature || !trimmedRootCause || !trimmedFix) {
    return 'tool, errorSignature, rootCause, and attemptedFix are required to record failure pattern.';
  }

  const normalizedOutcome = outcome === 'resolved' || outcome === 'partial' ? outcome : 'unresolved';
  const normalizedConfidence = typeof confidence === 'number' ? Math.max(0, Math.min(1, confidence)) : 0.5;
  const now = new Date().toISOString();

  try {
    return withSessionLock(() => {
      ensureSessionMemoryStore();
      const filePath = getFailureLedgerPath();
      const rows = readJsonlFile<FailurePatternEntry>(filePath);

      const key = [
        normalizeFailureText(trimmedTool),
        normalizeFailureText(trimmedSignature),
        normalizeFailureText(trimmedRootCause),
        normalizeFailureText(trimmedFix),
      ].join('::');

      const existing = rows.find((entry) => [
        normalizeFailureText(entry.tool),
        normalizeFailureText(entry.errorSignature),
        normalizeFailureText(entry.rootCause),
        normalizeFailureText(entry.attemptedFix),
      ].join('::') === key);

      if (existing) {
        existing.occurrences += 1;
        existing.lastSeenAt = now;
        existing.outcome = normalizedOutcome;
        existing.confidence = normalizedConfidence;
        writeTextAtomic(filePath, rows.map((entry) => JSON.stringify(entry)).join('\n') + (rows.length ? '\n' : ''));
        return `Failure pattern updated: ${existing.id} (occurrences=${existing.occurrences})`;
      }

      const entry: FailurePatternEntry = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        tool: trimmedTool,
        errorSignature: trimmedSignature,
        rootCause: trimmedRootCause,
        attemptedFix: trimmedFix,
        outcome: normalizedOutcome,
        confidence: normalizedConfidence,
        occurrences: 1,
        firstSeenAt: now,
        lastSeenAt: now,
      };

      rows.push(entry);
      trimJsonlFileToCap(filePath, SESSION_FAILURES_CAP);
      writeTextAtomic(filePath, rows.map((item) => JSON.stringify(item)).join('\n') + '\n');
      return `Failure pattern recorded: ${entry.id}`;
    });
  } catch (err) {
    return `Failed to record failure pattern: ${err instanceof Error ? err.message : String(err)}`;
  }
}

export function compactSessionContext(): string {
  try {
    return withSessionLock(() => {
      ensureSessionMemoryStore();

      const activePlanPath = getActivePlanPath();
      const checkpointsPath = getCheckpointLogPath();
      const failurePath = getFailureLedgerPath();
      const outputPath = getCompactContextPath();

      const plan = fs.existsSync(activePlanPath)
        ? JSON.parse(fs.readFileSync(activePlanPath, 'utf-8')) as ActivePlan
        : null;

      const checkpoints = readJsonlFile<CheckpointEntry>(checkpointsPath)
        .slice(-12)
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

      const failures = readJsonlFile<FailurePatternEntry>(failurePath)
        .slice(-12)
        .sort((a, b) => new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime());

      const lines: string[] = [
        '# Compact Session Context',
        '',
        `Generated: ${new Date().toISOString()}`,
        '',
        '## Active Goal',
      ];

      if (!plan) {
        lines.push('- No active plan yet.');
      } else {
        lines.push(`- Objective: ${plan.objective}`);
        lines.push(`- Acceptance Criteria: ${plan.acceptanceCriteria}`);
        lines.push(`- Status: ${plan.status}`);
        if (plan.currentStep) lines.push(`- Current Step: ${plan.currentStep}`);
        if (plan.nextStep) lines.push(`- Next Step: ${plan.nextStep}`);
        lines.push('- Blockers:');
        if (plan.blockers.length === 0) {
          lines.push('  - none');
        } else {
          for (const blocker of plan.blockers) lines.push(`  - ${blocker}`);
        }
      }

      lines.push('', '## Open Checkpoints');
      const openCheckpoints = checkpoints.filter((entry) => entry.status === 'open');
      if (openCheckpoints.length === 0) {
        lines.push('- none');
      } else {
        for (const item of openCheckpoints) {
          lines.push(`- ${item.id}: ${item.title}`);
          if (item.notes) lines.push(`  - notes: ${item.notes}`);
          if (typeof item.toolCallCount === 'number') lines.push(`  - tool calls: ${item.toolCallCount}`);
        }
      }

      lines.push('', '## Recent Failure Patterns');
      if (failures.length === 0) {
        lines.push('- none');
      } else {
        for (const item of failures.slice(0, 8)) {
          lines.push(`- ${item.tool}: ${item.errorSignature} (occurrences=${item.occurrences}, outcome=${item.outcome})`);
          lines.push(`  - root cause: ${item.rootCause}`);
          lines.push(`  - attempted fix: ${item.attemptedFix}`);
        }
      }

      lines.push('', '## Next Action Hint');
      if (plan?.nextStep) {
        lines.push(`- Resume from: ${plan.nextStep}`);
      } else {
        lines.push('- Define next step with `upsert_active_plan` to avoid goal drift.');
      }

      writeTextAtomic(outputPath, lines.join('\n') + '\n');
      return `Compact context written to .github/ai-os/memory/session/compact-context.md\n\n${lines.join('\n')}`;
    });
  } catch (err) {
    return `Failed to compact session context: ${err instanceof Error ? err.message : String(err)}`;
  }
}

export function recordToolCallAndRunWatchdog(toolName: string): string | null {
  try {
    return withSessionLock(() => {
      ensureSessionMemoryStore();

      const state = readRuntimeState();
      const now = new Date().toISOString();
      state.toolCallCount += 1;
      state.updatedAt = now;

      const thresholdReached =
        state.toolCallCount - state.lastWatchdogCheckpointCount >= state.threshold;

      if (!thresholdReached) {
        writeRuntimeState(state);
        return null;
      }

      const checkpoint: CheckpointEntry = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        title: `Goal watchdog checkpoint @${state.toolCallCount} calls`,
        status: 'open',
        notes: `Auto-checkpoint after ${state.threshold} tool calls. Re-read active plan and confirm alignment. Trigger tool: ${toolName}`,
        toolCallCount: state.toolCallCount,
        createdAt: now,
      };

      const checkpointsPath = getCheckpointLogPath();
      fs.appendFileSync(checkpointsPath, `${JSON.stringify(checkpoint)}\n`, 'utf-8');
      trimJsonlFileToCap(checkpointsPath, SESSION_CHECKPOINTS_CAP);

      state.lastWatchdogCheckpointCount = state.toolCallCount;
      writeRuntimeState(state);

      return `Watchdog checkpoint created (${checkpoint.id}) after ${state.toolCallCount} tool calls.`;
    });
  } catch {
    return null;
  }
}

/**
 * Update the automatic watchdog checkpoint interval.
 * The new threshold persists in runtime-state.json for the remainder of the session.
 * Accepts values 1–100; values outside this range are clamped.
 */
export function setWatchdogThreshold(threshold: number): string {
  const normalized = Math.max(1, Math.min(100, Math.floor(threshold)));
  try {
    return withSessionLock(() => {
      ensureSessionMemoryStore();
      const state = readRuntimeState();
      state.threshold = normalized;
      state.updatedAt = new Date().toISOString();
      writeRuntimeState(state);
      return `Watchdog threshold updated to ${normalized} tool calls.`;
    });
  } catch (err) {
    return `Failed to set watchdog threshold: ${err instanceof Error ? err.message : String(err)}`;
  }
}

/**
 * Reset all session state files so a new branch/task starts from a clean slate.
 * Clears: active-plan.json, checkpoints.jsonl, failure-ledger.jsonl,
 * runtime-state.json, and compact-context.md.
 * Durable repo memory (memory.jsonl) is never touched.
 */
export function resetSessionState(): string {
  try {
    return withSessionLock(() => {
      ensureSessionMemoryStore();
      const removed: string[] = [];

      const planPath = getActivePlanPath();
      if (fs.existsSync(planPath)) {
        fs.unlinkSync(planPath);
        removed.push('active-plan.json');
      }

      const checkpointsPath = getCheckpointLogPath();
      if (fs.existsSync(checkpointsPath)) {
        writeTextAtomic(checkpointsPath, '');
        removed.push('checkpoints.jsonl (truncated)');
      }

      const failurePath = getFailureLedgerPath();
      if (fs.existsSync(failurePath)) {
        writeTextAtomic(failurePath, '');
        removed.push('failure-ledger.jsonl (truncated)');
      }

      const runtimePath = getRuntimeStatePath();
      if (fs.existsSync(runtimePath)) {
        fs.unlinkSync(runtimePath);
        removed.push('runtime-state.json');
      }

      const compactPath = getCompactContextPath();
      if (fs.existsSync(compactPath)) {
        fs.unlinkSync(compactPath);
        removed.push('compact-context.md');
      }

      if (removed.length === 0) {
        return 'Session state was already empty — nothing to reset.';
      }

      return `Session state reset. Cleared: ${removed.join(', ')}. Durable repo memory (memory.jsonl) was not modified.`;
    });
  } catch (err) {
    return `Failed to reset session state: ${err instanceof Error ? err.message : String(err)}`;
  }
}

/**
 * Prompt the agent to mirror its hosted/in-context memory facts into memory.jsonl.
 * Since Copilot's hosted memory is not accessible from this server, this tool
 * returns a prompt template the agent should follow to sync facts manually.
 */
export function syncHostedMemory(): string {
  const { entries } = readMemoryEntries();
  const activeEntries = entries.filter((e) => e.status !== 'stale');

  const lines: string[] = [
    '## Sync Hosted Memory → memory.jsonl',
    '',
    'This tool cannot access Copilot\'s hosted memory directly.',
    'Follow these steps to mirror durable facts into `.github/ai-os/memory/memory.jsonl`:',
    '',
    '1. Review your current hosted/in-context memory for facts about this project.',
    '2. For each fact not already in `memory.jsonl` (listed below), call `remember_repo_fact`.',
    '3. Use categories: architecture, conventions, build, testing, security, pitfalls, decisions.',
    '',
    `**Currently in memory.jsonl:** ${activeEntries.length} active entries`,
  ];

  if (activeEntries.length > 0) {
    lines.push('');
    lines.push('**Existing active entries (do not duplicate):');
    for (const entry of activeEntries.slice(0, 20)) {
      lines.push(`- [${entry.category}] ${entry.title}`);
    }
    if (activeEntries.length > 20) {
      lines.push(`- … and ${activeEntries.length - 20} more`);
    }
  }

  lines.push('');
  lines.push('**Example call to add a missing fact:**');
  lines.push('```');
  lines.push('remember_repo_fact(');
  lines.push('  title: "Your fact title",');
  lines.push('  content: "Detailed description of the fact or decision",');
  lines.push('  category: "conventions",');
  lines.push('  tags: "tag1,tag2"');
  lines.push(')');
  lines.push('```');

  return lines.join('\n');
}

export function searchFiles(query: string, filePattern?: string, caseSensitive = false): string {
  try {
    const flags = caseSensitive ? '' : '--ignore-case';
    const globArg = filePattern ? `-g "${filePattern}"` : '';
    const cmd = `npx --yes ripgrep ${flags} ${globArg} --line-number --max-count=5 "${query}" "${ROOT}"`;
    const result = execSync(cmd, { maxBuffer: 512 * 1024, timeout: 10000 }).toString();
    return result.slice(0, 8000); // Cap output for token efficiency
  } catch (err) {
    if (err instanceof Error && 'stdout' in err) {
      return String((err as NodeJS.ErrnoException & { stdout: Buffer }).stdout ?? 'No results found');
    }
    return 'No results found';
  }
}

const IGNORE_DIRS = new Set([
  'node_modules', '.git', '.next', '.nuxt', 'dist', 'build', 'out',
  '__pycache__', '.venv', 'venv', 'target', 'vendor', 'coverage',
  '.gradle', 'bin', 'obj', '.vs', 'packages', '.cache',
]);

export function buildFileTree(dir: string, depth = 0, maxDepth = 4): string[] {
  if (depth > maxDepth) return [];
  const prefix = '  '.repeat(depth);
  const lines: string[] = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
      .filter(e => !e.name.startsWith('.') || e.name === '.github')
      .filter(e => !IGNORE_DIRS.has(e.name))
      .sort((a, b) => {
        if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

    for (const entry of entries) {
      if (entry.isDirectory()) {
        lines.push(`${prefix}${entry.name}/`);
        lines.push(...buildFileTree(path.join(dir, entry.name), depth + 1, maxDepth));
      } else {
        lines.push(`${prefix}${entry.name}`);
      }
    }
  } catch { /* ignore permission errors */ }
  return lines;
}

export function getPrismaSchema(): string {
  const candidates = ['prisma/schema.prisma', 'schema.prisma', 'db/schema.prisma'];
  for (const rel of candidates) {
    const abs = path.join(ROOT, rel);
    if (fs.existsSync(abs)) {
      return fs.readFileSync(abs, 'utf-8');
    }
  }
  return 'Prisma schema not found';
}

export function getTrpcProcedures(): string {
  const candidates = ['src/trpc/index.ts', 'src/server/trpc.ts', 'server/trpc.ts'];
  for (const rel of candidates) {
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) continue;
    const content = fs.readFileSync(abs, 'utf-8');
    const lines = content.split('\n');
    const procedures: string[] = [];
    for (const line of lines) {
      const m = line.match(/^\s+(\w+):\s+(public|private)Procedure/);
      if (m) procedures.push(`- ${m[1]} (${m[2]})`);
    }
    if (procedures.length > 0) {
      return `**tRPC Procedures** (from ${rel}):\n${procedures.join('\n')}`;
    }
    return `Found router at ${rel} but could not parse procedures. First 50 lines:\n\`\`\`\n${lines.slice(0, 50).join('\n')}\n\`\`\``;
  }
  return 'tRPC router not found';
}

export function getApiRoutes(filter?: string): string {
  const routes = new Set<string>();

  function addRoute(route: string): void {
    const trimmed = route.trim();
    if (!trimmed) return;
    routes.add(trimmed);
  }

  // Next.js app router route handlers
  const apiDir = path.join(ROOT, 'src/app/api');
  function scanNextApiDir(dir: string, prefix = ''): void {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          scanNextApiDir(path.join(dir, entry.name), `${prefix}/${entry.name}`);
          continue;
        }
        if (entry.name !== 'route.ts' && entry.name !== 'route.js') continue;

        const content = fs.readFileSync(path.join(dir, entry.name), 'utf-8');
        const methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].filter((m) =>
          new RegExp(`export\\s+(?:async\\s+)?function\\s+${m}`).test(content),
        );
        if (methods.length === 0) continue;
        const route = prefix.replace(/\/\[([^\]]+)\]/g, '/:$1');
        addRoute(`${methods.join(', ')} ${route}`);
      }
    } catch {
      // ignore
    }
  }
  if (fs.existsSync(apiDir)) {
    scanNextApiDir(apiDir, '/api');
  }

  // Generic regex scan for Python/Java/Go/Rust routing constructs
  const scanPatterns: Array<{ glob: string; patterns: RegExp[] }> = [
    {
      glob: '*.py',
      patterns: [
        /@(app|router)\.(get|post|put|patch|delete)\(['"]([^'"]+)['"]/g,
        /path\(['"]([^'"]+)['"],/g,
      ],
    },
    {
      glob: '*.java',
      patterns: [
        /@(?:Get|Post|Put|Patch|Delete|Request)Mapping\(([^)]*)\)/g,
      ],
    },
    {
      glob: '*.go',
      patterns: [
        /\.(GET|POST|PUT|PATCH|DELETE)\("([^"]+)"/g,
        /HandleFunc\("([^"]+)"/g,
      ],
    },
    {
      glob: '*.rs',
      patterns: [
        /#\[(get|post|put|patch|delete)\("([^"]+)"\)\]/g,
        /route\("([^"]+)",\s*(get|post|put|patch|delete)/g,
      ],
    },
    {
      glob: '*.{ts,js}',
      patterns: [
        /router\.(get|post|put|patch|delete)\(['"]([^'"]+)['"]/g,
        /app\.(get|post|put|patch|delete)\(['"]([^'"]+)['"]/g,
      ],
    },
  ];

  for (const scan of scanPatterns) {
    try {
      const cmd = `npx --yes ripgrep --files -g "${scan.glob}" "${ROOT}"`;
      const files = execSync(cmd, { maxBuffer: 1024 * 1024, timeout: 12000 }).toString().split('\n').filter(Boolean);

      for (const file of files.slice(0, 300)) {
        let content = '';
        try {
          content = fs.readFileSync(file, 'utf-8');
        } catch {
          continue;
        }

        for (const pattern of scan.patterns) {
          const matches = content.matchAll(pattern);
          for (const match of matches) {
            if (scan.glob === '*.java') {
              const mappingArgs = match[1] ?? '';
              const methodMatch = mappingArgs.match(/RequestMethod\.(GET|POST|PUT|PATCH|DELETE)/);
              const method = methodMatch?.[1] ?? (match[0].includes('GetMapping') ? 'GET' : match[0].includes('PostMapping') ? 'POST' : match[0].includes('PutMapping') ? 'PUT' : match[0].includes('PatchMapping') ? 'PATCH' : match[0].includes('DeleteMapping') ? 'DELETE' : 'REQUEST');
              const pathMatch = mappingArgs.match(/['"]([^'"]+)['"]/);
              if (pathMatch) addRoute(`${method} ${pathMatch[1]}`);
              continue;
            }

            const method = (match[2] ?? match[1] ?? '').toString().toUpperCase();
            const routePath = (match[3] ?? match[2] ?? match[1] ?? '').toString();
            if (!routePath.startsWith('/')) continue;

            if (['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
              addRoute(`${method} ${routePath}`);
            } else {
              addRoute(`ROUTE ${routePath}`);
            }
          }
        }
      }
    } catch {
      // ignore scan errors
    }
  }

  const result = [...routes].sort();
  const filtered = filter ? result.filter((route) => route.toLowerCase().includes(filter.toLowerCase())) : result;
  return filtered.length > 0 ? `**API Routes:**\n${filtered.join('\n')}` : 'No API routes found';
}

export function getEnvVars(): string {
  const envExamplePaths = ['.env.example', '.env.local.example', '.env.sample', '.env.template'];
  let envContent = '';

  for (const p of envExamplePaths) {
    if (fs.existsSync(path.join(ROOT, p))) {
      envContent = fs.readFileSync(path.join(ROOT, p), 'utf-8');
      break;
    }
  }

  // Also scan code for env references across supported runtimes
  const codeEnvVars = new Set<string>();
  const extractors: Array<{ regex: RegExp; fileGlob: string }> = [
    { regex: /process\.env\.(\w+)/g, fileGlob: '*.{ts,tsx,js,jsx,mjs,cjs}' },
    { regex: /os\.getenv\(['"]([A-Z0-9_]+)['"]/g, fileGlob: '*.py' },
    { regex: /os\.environ\[['"]([A-Z0-9_]+)['"]\]/g, fileGlob: '*.py' },
    { regex: /System\.getenv\(['"]([A-Z0-9_]+)['"]\)/g, fileGlob: '*.java' },
    { regex: /os\.Getenv\(['"]([A-Z0-9_]+)['"]\)/g, fileGlob: '*.go' },
    { regex: /std::env::var\(['"]([A-Z0-9_]+)['"]\)/g, fileGlob: '*.rs' },
  ];

  for (const extractor of extractors) {
    try {
      const cmd = `npx --yes ripgrep --files -g "${extractor.fileGlob}" "${ROOT}"`;
      const files = execSync(cmd, { maxBuffer: 1024 * 1024, timeout: 10000 }).toString().split('\n').filter(Boolean);
      for (const file of files.slice(0, 400)) {
        let content = '';
        try {
          content = fs.readFileSync(file, 'utf-8');
        } catch {
          continue;
        }

        for (const match of content.matchAll(extractor.regex)) {
          if (match[1]) codeEnvVars.add(match[1]);
        }
      }
    } catch {
      // best-effort extraction
    }
  }

  const lines: string[] = ['**Required Environment Variables:**', ''];

  if (envContent) {
    lines.push('From .env.example:');
    lines.push('```');
    lines.push(envContent.split('\n').filter(l => l.trim() && !l.startsWith('#')).join('\n'));
    lines.push('```');
  }

  if (codeEnvVars.size > 0) {
    lines.push('');
    lines.push('Referenced in code:');
    [...codeEnvVars].sort().forEach(v => lines.push(`- ${v}`));
  }

  return lines.join('\n');
}

export function getPackageInfo(packageName?: string): string {
  const lines: string[] = [];

  // Node
  const pkgPath = path.join(ROOT, 'package.json');
  if (fs.existsSync(pkgPath)) {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as {
      name?: string;
      version?: string;
      engines?: { node?: string };
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };

    if (packageName && allDeps[packageName]) {
      return `**${packageName}:** ${allDeps[packageName]}`;
    }

    lines.push(`**Node Package:** ${pkg.name ?? 'unknown'}@${pkg.version ?? '0.0.0'}`);
    lines.push(`**Node Engine:** ${pkg.engines?.node ?? 'not specified'}`);
    const depPairs = Object.entries(pkg.dependencies ?? {}).slice(0, 40).map(([k, v]) => `  ${k}: ${v}`);
    if (depPairs.length > 0) {
      lines.push('', '**Node Dependencies:**', ...depPairs);
    }
  }

  // Python
  const requirementsPath = path.join(ROOT, 'requirements.txt');
  if (fs.existsSync(requirementsPath)) {
    const reqLines = fs.readFileSync(requirementsPath, 'utf-8').split('\n').map((line) => line.trim()).filter(Boolean).filter((line) => !line.startsWith('#'));
    if (packageName) {
      const found = reqLines.find((line) => line.toLowerCase().startsWith(packageName.toLowerCase()));
      if (found) return `**${packageName}:** ${found}`;
    }
    lines.push('', `**Python Requirements:** ${reqLines.length} entries`);
    lines.push(...reqLines.slice(0, 40).map((line) => `  ${line}`));
  }

  // Java
  const pomPath = path.join(ROOT, 'pom.xml');
  if (fs.existsSync(pomPath)) {
    const pom = fs.readFileSync(pomPath, 'utf-8');
    const artifact = pom.match(/<artifactId>([^<]+)<\/artifactId>/)?.[1] ?? 'unknown';
    const version = pom.match(/<version>([^<]+)<\/version>/)?.[1] ?? 'unknown';
    lines.push('', `**Maven Project:** ${artifact}@${version}`);
  }
  const gradlePath = path.join(ROOT, 'build.gradle');
  const gradleKtsPath = path.join(ROOT, 'build.gradle.kts');
  if (fs.existsSync(gradlePath) || fs.existsSync(gradleKtsPath)) {
    lines.push('', '**Gradle Build:** detected');
  }

  // Go
  const goModPath = path.join(ROOT, 'go.mod');
  if (fs.existsSync(goModPath)) {
    const goMod = fs.readFileSync(goModPath, 'utf-8');
    const moduleName = goMod.match(/^module\s+(\S+)/m)?.[1] ?? 'unknown';
    lines.push('', `**Go Module:** ${moduleName}`);
  }

  // Rust
  const cargoPath = path.join(ROOT, 'Cargo.toml');
  if (fs.existsSync(cargoPath)) {
    const cargo = fs.readFileSync(cargoPath, 'utf-8');
    const name = cargo.match(/^name\s*=\s*"([^"]+)"/m)?.[1] ?? 'unknown';
    const version = cargo.match(/^version\s*=\s*"([^"]+)"/m)?.[1] ?? 'unknown';
    lines.push('', `**Rust Crate:** ${name}@${version}`);
  }

  if (lines.length === 0) {
    return 'No supported package/build manifest found (package.json, requirements.txt, pom.xml/build.gradle, go.mod, Cargo.toml).';
  }

  return lines.join('\n').trim();
}

export function getFileSummary(filePath: string): string {
  const absPath = path.isAbsolute(filePath) ? filePath : path.join(ROOT, filePath);
  try {
    const content = fs.readFileSync(absPath, 'utf-8');
    const lines = content.split('\n');
    const ext = path.extname(filePath).toLowerCase();
    const exports: string[] = [];
    const imports: string[] = [];

    for (const line of lines.slice(0, 200)) {
      // TypeScript/JavaScript exports
      if (/^export\s+(default\s+)?(function|class|const|interface|type|enum)\s+(\w+)/.test(line)) {
        const match = line.match(/^export\s+(?:default\s+)?(?:function|class|const|interface|type|enum)\s+(\w+)/);
        if (match) exports.push(match[1]);
      }
      // Python functions/classes
      if ((ext === '.py') && /^(def|class)\s+(\w+)/.test(line)) {
        const match = line.match(/^(def|class)\s+(\w+)/);
        if (match) exports.push(`${match[1]} ${match[2]}`);
      }
      // Go functions
      if ((ext === '.go') && /^func\s+(\w+)/.test(line)) {
        const match = line.match(/^func\s+(\w+)/);
        if (match) exports.push(`func ${match[1]}`);
      }
      // Imports (first 10)
      if (imports.length < 10 && /^import\s/.test(line)) {
        imports.push(line.trim());
      }
    }

    const summary: string[] = [
      `**File:** \`${filePath}\``,
      `**Size:** ${lines.length} lines`,
      '',
    ];

    if (imports.length > 0) {
      summary.push('**Key Imports:**');
      summary.push(...imports.map(i => `- ${i}`));
      summary.push('');
    }
    if (exports.length > 0) {
      summary.push('**Exports:**');
      summary.push(...exports.map(e => `- ${e}`));
      summary.push('');
    }

    // First 30 lines as preview
    summary.push('**Preview (first 30 lines):**');
    summary.push('```');
    summary.push(...lines.slice(0, 30));
    summary.push('```');

    return summary.join('\n');
  } catch {
    return `Could not read file: ${filePath}`;
  }
}

export function getImpactOfChange(filePath: string): string {
  const newGraphPath = path.join(ROOT, '.github', 'ai-os', 'context', 'dependency-graph.json');
  const legacyGraphPath = path.join(ROOT, '.ai-os', 'context', 'dependency-graph.json');
  const graphPath = fs.existsSync(newGraphPath) ? newGraphPath : legacyGraphPath;
  if (!fs.existsSync(graphPath)) {
    return 'Dependency graph not found. Re-run the AI OS installer: `npx -y github:marinvch/ai-os --refresh-existing` (or the bootstrap one-liner from the README).';
  }

  let graph: { nodes: Record<string, { imports: string[]; importedBy: string[]; exports: string[] }> };
  try {
    graph = JSON.parse(fs.readFileSync(graphPath, 'utf-8'));
  } catch {
    return 'Could not parse dependency graph.';
  }

  // Normalize the input path to forward slashes, strip leading ./
  const normalized = filePath.replace(/\\/g, '/').replace(/^\.\//, '');

  const node = graph.nodes[normalized];
  if (!node) {
    // Try partial match
    const candidates = Object.keys(graph.nodes).filter(k => k.includes(normalized));
    if (candidates.length === 0) {
      return `File "${normalized}" not found in dependency graph. It may not be a tracked source file.`;
    }
    if (candidates.length > 1) {
      return `Ambiguous path "${normalized}" — did you mean one of:\n${candidates.map(c => `- ${c}`).join('\n')}`;
    }
    return getImpactOfChange(candidates[0]!);
  }

  // BFS to collect transitive dependents
  const visited = new Set<string>();
  const queue: string[] = [...node.importedBy];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);
    const n = graph.nodes[current];
    if (n) queue.push(...n.importedBy);
  }

  const direct = node.importedBy;
  const transitive = [...visited].filter(f => !direct.includes(f));

  const lines: string[] = [
    `## Impact Analysis: \`${normalized}\``,
    '',
    `**Exports:** ${node.exports.length > 0 ? node.exports.join(', ') : '_none detected_'}`,
    '',
    `**Imports (${node.imports.length} direct dependencies):**`,
    ...node.imports.map(f => `- ${f}`),
    '',
    `**Directly imported by (${direct.length} files):**`,
    ...(direct.length > 0 ? direct.map(f => `- ${f}`) : ['- _nothing imports this file_']),
    '',
    `**Transitively affected (${transitive.length} files):**`,
    ...(transitive.length > 0 ? transitive.map(f => `- ${f}`) : ['- _no transitive dependents_']),
  ];

  return lines.join('\n');
}

export function getDependencyChain(filePath: string): string {
  const newGraphPath = path.join(ROOT, '.github', 'ai-os', 'context', 'dependency-graph.json');
  const legacyGraphPath = path.join(ROOT, '.ai-os', 'context', 'dependency-graph.json');
  const graphPath = fs.existsSync(newGraphPath) ? newGraphPath : legacyGraphPath;
  if (!fs.existsSync(graphPath)) {
    return 'Dependency graph not found. Re-run the AI OS installer: `npx -y github:marinvch/ai-os --refresh-existing` (or the bootstrap one-liner from the README).';
  }

  let graph: { nodes: Record<string, { imports: string[]; importedBy: string[]; exports: string[] }> };
  try {
    graph = JSON.parse(fs.readFileSync(graphPath, 'utf-8'));
  } catch {
    return 'Could not parse dependency graph.';
  }

  const normalized = filePath.replace(/\\/g, '/').replace(/^\.\//, '');
  const node = graph.nodes[normalized];
  if (!node) {
    return `File "${normalized}" not found in dependency graph.`;
  }

  const lines: string[] = [
    `## Dependency Chain: \`${normalized}\``,
    '',
    '### This file imports:',
  ];

  if (node.imports.length === 0) {
    lines.push('- _no local imports_');
  } else {
    for (const imp of node.imports) {
      const impNode = graph.nodes[imp];
      const exports = impNode?.exports.slice(0, 5).join(', ') ?? '';
      lines.push(`- **${imp}**${exports ? ` → exports: \`${exports}\`` : ''}`);
    }
  }

  lines.push('');
  lines.push('### This file is imported by:');

  if (node.importedBy.length === 0) {
    lines.push('- _nothing imports this file_');
  } else {
    for (const parent of node.importedBy) {
      const parentNode = graph.nodes[parent];
      const grandparents = parentNode?.importedBy.slice(0, 3).join(', ') ?? '';
      lines.push(`- **${parent}**${grandparents ? ` (used by: ${grandparents})` : ''}`);
    }
  }

  return lines.join('\n');
}

export function checkForUpdates(): string {
  const newConfigPath = path.join(ROOT, '.github', 'ai-os', 'config.json');
  const legacyConfigPath = path.join(ROOT, '.ai-os', 'config.json');
  const configPath = fs.existsSync(newConfigPath) ? newConfigPath : legacyConfigPath;
  if (!fs.existsSync(configPath)) {
    return 'AI OS is not installed in this repository. Run the bootstrap installer: `curl -fsSL https://raw.githubusercontent.com/marinvch/ai-os/master/bootstrap.sh | bash`';
  }

  let installedVersion = '0.0.0';
  let installedAt = 'unknown';
  try {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as {
      version?: string;
      installedAt?: string;
    };
    installedVersion = config.version ?? '0.0.0';
    installedAt = config.installedAt ?? 'unknown';
  } catch {
    return 'Could not read .github/ai-os/config.json';
  }

  let toolVersion = '0.0.0';
  try {
    const toolPkg = JSON.parse(
      fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf-8'),
    ) as { version?: string };
    toolVersion = toolPkg.version ?? '0.0.0';
  } catch { /* tool package.json not found */ }

  const latestVersion = getLatestResolvableVersion(toolVersion);

  const parse = (v: string): number[] => v.replace(/^v/, '').split('.').map(Number);
  const [cMaj = 0, cMin = 0, cPat = 0] = parse(latestVersion);
  const [iMaj = 0, iMin = 0, iPat = 0] = parse(installedVersion);
  const updateAvailable =
    cMaj > iMaj ||
    (cMaj === iMaj && cMin > iMin) ||
    (cMaj === iMaj && cMin === iMin && cPat > iPat);

  if (updateAvailable) {
    return [
      `## AI OS Update Available`,
      ``,
      `- **Installed:** v${installedVersion} (generated ${installedAt})`,
      `- **Latest:**    v${latestVersion}`,
      ``,
      `Run the following to update all AI OS artifacts in-place:`,
      `\`\`\`bash`,
      `npx -y "github:marinvch/ai-os#v${latestVersion}" --refresh-existing`,
      `\`\`\``,
      `Or use the bootstrap one-liner: \`curl -fsSL https://raw.githubusercontent.com/marinvch/ai-os/master/bootstrap.sh | bash\``,
      `This refreshes context docs, agents, skills, MCP tools, and the dependency graph without deleting your existing files.`,
    ].join('\n');
  }

  return `AI OS is up-to-date (v${installedVersion}). Last generated: ${installedAt}`;
}

// ── Tool #19: Session Context ─────────────────────────────────────────────────

export function getSessionContext(): string {
  const SESSION_BOOTSTRAP = [
    '',
    '---',
    '',
    '## Session Start Bootstrap',
    '',
    '**At the start of every session, run in order:**',
    '',
    '1. `get_session_context` ← you are here',
    '2. `get_repo_memory` — reload durable architectural decisions',
    '3. `get_conventions` — reload coding rules before writing any code',
    '',
    '**Before any non-trivial change:**',
    '',
    '- `get_project_structure` — explore unfamiliar directories',
    '- `get_file_summary` — understand a file without reading it fully',
    '- `get_impact_of_change` — assess blast radius before editing shared files',
    '- Use `/define` → `/plan` lifecycle prompts before writing code',
    '',
    '> If the request is ambiguous or underspecified, ask clarifying questions first.',
    '> Do not improvise requirements or make architectural changes without confirmation.',
  ].join('\n');

  const contextCardPath = path.join(ROOT, '.github', 'COPILOT_CONTEXT.md');
  if (fs.existsSync(contextCardPath)) {
    return fs.readFileSync(contextCardPath, 'utf-8') + SESSION_BOOTSTRAP;
  }
  // Fallback: build a minimal context from available files
  const lines: string[] = [
    '# Session Context',
    '',
    '> COPILOT_CONTEXT.md not found. Run AI OS generation to create it.',
    '',
    '## Quick Context',
    '',
  ];
  const conventions = readAiOsFile('context/conventions.md');
  if (conventions) {
    // Extract just the first section
    const firstSection = conventions.split('\n##')[0];
    lines.push(firstSection.split('\n').slice(0, 15).join('\n'));
  }
  lines.push('');
  lines.push('Call `get_conventions` and `get_repo_memory` for full context.');
  return lines.join('\n') + SESSION_BOOTSTRAP;
}

// ── Tool #20: Recommendations ─────────────────────────────────────────────────

export function getRecommendations(): string {
  const recommendationsPath = path.join(ROOT, '.github', 'ai-os', 'recommendations.md');
  if (fs.existsSync(recommendationsPath)) {
    return fs.readFileSync(recommendationsPath, 'utf-8');
  }
  return 'No recommendations file found. Run AI OS generation with recommendations enabled to create .github/ai-os/recommendations.md.';
}

// ── Tool #21: Suggest Improvements ───────────────────────────────────────────

export function suggestImprovements(): string {
  const suggestions: string[] = [];

  // Check for missing env var documentation
  const envExamplePaths = ['.env.example', '.env.local.example', '.env.sample'];
  const hasEnvExample = envExamplePaths.some(p => fs.existsSync(path.join(ROOT, p)));
  if (!hasEnvExample) {
    suggestions.push('**Missing `.env.example`**: Document required environment variables so `get_env_vars` can surface them.');
  }

  // Check for missing COPILOT_CONTEXT.md
  if (!fs.existsSync(path.join(ROOT, '.github', 'COPILOT_CONTEXT.md'))) {
    suggestions.push('**Missing `COPILOT_CONTEXT.md`**: Re-run the AI OS installer (`npx -y github:marinvch/ai-os --refresh-existing`) to generate the session context card for better session continuity.');
  }

  // Check for missing recommendations.md
  if (!fs.existsSync(path.join(ROOT, '.github', 'ai-os', 'recommendations.md'))) {
    suggestions.push('**Missing `recommendations.md`**: Re-run the AI OS installer (`npx -y github:marinvch/ai-os --refresh-existing`) to generate stack-specific tool recommendations.');
  }

  // Check memory freshness
  const memoryPath = path.join(ROOT, '.github', 'ai-os', 'memory', 'memory.jsonl');
  if (!fs.existsSync(memoryPath)) {
    suggestions.push('**No repository memory found**: Use `remember_repo_fact` to capture key architectural decisions.');
  } else {
    const content = fs.readFileSync(memoryPath, 'utf-8').trim();
    if (!content) {
      suggestions.push('**Empty repository memory**: Use `remember_repo_fact` to capture key architectural decisions and conventions.');
    }
  }

  // Check for architecture doc
  const archPath = path.join(ROOT, '.github', 'ai-os', 'context', 'architecture.md');
  if (!fs.existsSync(archPath)) {
    suggestions.push('**Missing architecture doc**: Re-run the AI OS installer (`npx -y github:marinvch/ai-os --refresh-existing`) to rebuild `.github/ai-os/context/architecture.md`.');
  }

  // Config-based suggestions
  const configPath = path.join(ROOT, '.github', 'ai-os', 'config.json');
  if (fs.existsSync(configPath)) {
    try {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as {
        persistentRules?: string[];
        recommendations?: boolean;
      };
      if (!config.persistentRules || config.persistentRules.length === 0) {
        suggestions.push('**No persistent rules defined**: Add `persistentRules` in `.github/ai-os/config.json` for rules that survive context window resets (e.g. "use shared components from components/ui").');
      }
      if (config.recommendations === false) {
        suggestions.push('**Recommendations disabled**: Set `"recommendations": true` in `.github/ai-os/config.json` to enable stack-specific tool suggestions.');
      }
    } catch {
      // ignore
    }
  }

  if (suggestions.length === 0) {
    return '## Improvement Suggestions\n\nNo actionable improvements found. Your AI OS setup looks healthy!\n\nConsider:\n- Adding more persistent rules in `config.json` for frequently forgotten conventions\n- Calling `remember_repo_fact` after major architectural decisions';
  }

  return [
    '## Improvement Suggestions',
    '',
    ...suggestions.map(s => `- ${s}`),
  ].join('\n');
}
