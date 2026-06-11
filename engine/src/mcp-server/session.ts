/**
 * session.ts — active plan, checkpoints, failure ledger, watchdog for AI OS MCP server.
 * Manages .github/ai-os/memory/session/ files.
 */
import fs from 'node:fs';
import {
  getActivePlanPath,
  getCheckpointLogPath,
  getFailureLedgerPath,
  getCompactContextPath,
  getRuntimeStatePath,
  ensureSessionMemoryStore,
  withSessionLock,
  writeTextAtomic,
  readJsonlFile,
  trimJsonlFileToCap,
} from './shared.js';

// ── Types ──────────────────────────────────────────────────────────────────────

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

// ── Constants ──────────────────────────────────────────────────────────────────

const DEFAULT_WATCHDOG_THRESHOLD = 8;
const SESSION_CHECKPOINTS_CAP = 100;
const SESSION_FAILURES_CAP = 50;

// ── Helper functions ───────────────────────────────────────────────────────────

function normalizeFailureText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
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

// ── Exported functions ─────────────────────────────────────────────────────────

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
