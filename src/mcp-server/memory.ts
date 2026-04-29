/**
 * memory.ts — repo-memory store and hygiene for AI OS MCP server.
 * Manages .github/ai-os/memory/memory.jsonl.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  ROOT,
  readAiOsFile,
  getMemoryFilePath,
  ensureMemoryStore,
  withMemoryLock,
  writeTextAtomic,
} from './shared.js';

// ── Types ──────────────────────────────────────────────────────────────────────

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

interface MemoryReadResult {
  entries: RepoMemoryEntry[];
  malformedCount: number;
}

export interface MemoryHygieneSummary {
  totalBefore: number;
  activeAfter: number;
  staleMarked: number;
  nearDuplicatesMarked: number;
  pruned: number;
  malformedSkipped: number;
}

// ── Constants ──────────────────────────────────────────────────────────────────

const MEMORY_STALE_DAYS = 180;
const NEAR_DUPLICATE_THRESHOLD = 0.85;

// ── Helper functions ───────────────────────────────────────────────────────────

function normalizeWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function normalizeMemoryText(value: string): string {
  return normalizeWhitespace(value).toLowerCase();
}

/**
 * Read memory-related config values (TTL, near-duplicate threshold) from
 * .github/ai-os/config.json. Falls back to safe defaults if the file is
 * absent or the values are invalid.
 */
function readMemoryConfig(): { ttlDays: number; nearDuplicateThreshold: number } {
  const configPath = path.join(ROOT, '.github', 'ai-os', 'config.json');
  try {
    const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as Record<string, unknown>;
    const ttlDays =
      typeof raw['memoryTtlDays'] === 'number' && raw['memoryTtlDays'] > 0
        ? Math.floor(raw['memoryTtlDays'])
        : MEMORY_STALE_DAYS;
    const nearDuplicateThreshold =
      typeof raw['memoryNearDuplicateThreshold'] === 'number'
        ? Math.max(0.5, Math.min(1.0, raw['memoryNearDuplicateThreshold']))
        : NEAR_DUPLICATE_THRESHOLD;
    return { ttlDays, nearDuplicateThreshold };
  } catch {
    return { ttlDays: MEMORY_STALE_DAYS, nearDuplicateThreshold: NEAR_DUPLICATE_THRESHOLD };
  }
}

/**
 * Compute Jaccard similarity between two strings based on their word-sets.
 * Returns a value in [0, 1] where 1 means identical word sets.
 * Returns 0 when either string produces an empty word set (empty/whitespace-only
 * inputs should never be treated as duplicates of each other).
 */
function jaccardSimilarity(a: string, b: string): number {
  const wordsA = new Set(a.toLowerCase().split(/\W+/).filter(Boolean));
  const wordsB = new Set(b.toLowerCase().split(/\W+/).filter(Boolean));
  if (wordsA.size === 0 || wordsB.size === 0) return 0;
  let intersection = 0;
  for (const word of wordsA) {
    if (wordsB.has(word)) intersection += 1;
  }
  const union = wordsA.size + wordsB.size - intersection;
  return intersection / union;
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

function applyStalePolicy(entries: RepoMemoryEntry[], ttlDays?: number): RepoMemoryEntry[] {
  const effectiveTtl = ttlDays ?? MEMORY_STALE_DAYS;
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
    if (ageInDays(entry.updatedAt ?? entry.createdAt) > effectiveTtl) {
      entry.status = 'stale';
      entry.staleReason = entry.staleReason ?? `auto-stale-${effectiveTtl}d`;
      entry.updatedAt = toIsoDate(entry.updatedAt);
    }
  }

  return entries;
}

/**
 * Detect near-duplicate entries: same title+category key, different fingerprint,
 * but content similarity above the configured threshold. The older entry is
 * marked stale with reason 'near-duplicate'.
 *
 * Returns the number of entries newly marked as near-duplicates.
 */
function markNearDuplicates(entries: RepoMemoryEntry[], threshold: number): number {
  const byKey = new Map<string, RepoMemoryEntry[]>();
  for (const entry of entries) {
    const key = buildMemoryKey(entry);
    const list = byKey.get(key) ?? [];
    list.push(entry);
    byKey.set(key, list);
  }

  let marked = 0;
  for (const [, list] of byKey) {
    const active = list
      .filter((e) => e.status !== 'stale')
      .sort(sortByRecencyDesc);

    for (let i = 0; i < active.length; i++) {
      for (let j = i + 1; j < active.length; j++) {
        const newer = active[i];
        const older = active[j];
        if (
          (newer.fingerprint ?? buildFingerprint(newer)) !==
          (older.fingerprint ?? buildFingerprint(older)) &&
          jaccardSimilarity(newer.content, older.content) >= threshold
        ) {
          older.status = 'stale';
          older.staleReason = 'near-duplicate';
          older.updatedAt = toIsoDate(older.updatedAt);
          marked += 1;
        }
      }
    }
  }

  return marked;
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
  writeTextAtomic(getMemoryFilePath(), serializeEntries(entries));
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

  const { ttlDays, nearDuplicateThreshold } = readMemoryConfig();
  const deduped = dedupeEntries(entries);
  markNearDuplicates(deduped, nearDuplicateThreshold);

  return {
    entries: applyStalePolicy(deduped, ttlDays),
    malformedCount,
  };
}

function recoverMalformedMemoryIfNeeded(result: MemoryReadResult): void {
  if (result.malformedCount <= 0) return;
  writeMemoryEntriesAtomic(result.entries);
}

// ── Exported functions ─────────────────────────────────────────────────────────

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

/**
 * Compact the memory file by physically removing all stale entries.
 * Runs full hygiene (dedupe, near-duplicate detection, TTL enforcement) first,
 * then rewrites the file with only active entries.
 * Returns a human-readable maintenance summary.
 */
export function pruneMemory(): string {
  try {
    return withMemoryLock(() => {
      ensureMemoryStore();
      const file = getMemoryFilePath();
      const content = fs.readFileSync(file, 'utf-8');
      const rawLines = content.split('\n').map((line) => line.trim()).filter(Boolean);

      const rawEntries: RepoMemoryEntry[] = [];
      let malformedCount = 0;
      for (const line of rawLines) {
        try {
          const parsed = JSON.parse(line) as Partial<RepoMemoryEntry>;
          const canonical = canonicalizeEntry(parsed);
          if (canonical) rawEntries.push(canonical);
          else malformedCount += 1;
        } catch {
          malformedCount += 1;
        }
      }

      const totalBefore = rawEntries.length;
      const { ttlDays, nearDuplicateThreshold } = readMemoryConfig();

      const deduped = dedupeEntries(rawEntries);
      const nearDuplicatesMarked = markNearDuplicates(deduped, nearDuplicateThreshold);
      const withStalePolicy = applyStalePolicy(deduped, ttlDays);

      const staleCount = withStalePolicy.filter((e) => e.status === 'stale').length;
      const activeEntries = withStalePolicy.filter((e) => e.status !== 'stale');

      writeMemoryEntriesAtomic(activeEntries);

      const summary: MemoryHygieneSummary = {
        totalBefore,
        activeAfter: activeEntries.length,
        staleMarked: staleCount,
        nearDuplicatesMarked,
        pruned: totalBefore - activeEntries.length,
        malformedSkipped: malformedCount,
      };

      const lines = [
        '## Memory Prune Complete',
        '',
        `- Entries before prune: ${summary.totalBefore}`,
        `- Active entries kept:  ${summary.activeAfter}`,
        `- Stale entries removed: ${summary.pruned}`,
        `  - Near-duplicates removed: ${summary.nearDuplicatesMarked}`,
        `  - TTL-expired / superseded: ${summary.staleMarked - summary.nearDuplicatesMarked}`,
      ];

      if (summary.malformedSkipped > 0) {
        lines.push(`- Malformed lines skipped: ${summary.malformedSkipped}`);
      }

      lines.push('', `TTL policy: ${ttlDays} days | Near-duplicate threshold: ${nearDuplicateThreshold}`);

      return lines.join('\n');
    });
  } catch (err) {
    return `Failed to prune memory: ${err instanceof Error ? err.message : String(err)}`;
  }
}

/**
 * Run a non-destructive memory hygiene pass and return a summary without
 * modifying the memory file. Useful for maintenance reports during refresh runs.
 */
export function runMemoryMaintenance(): MemoryHygieneSummary {
  ensureMemoryStore();
  const file = getMemoryFilePath();
  const content = fs.readFileSync(file, 'utf-8');
  const rawLines = content.split('\n').map((line) => line.trim()).filter(Boolean);

  const rawEntries: RepoMemoryEntry[] = [];
  let malformedCount = 0;
  for (const line of rawLines) {
    try {
      const parsed = JSON.parse(line) as Partial<RepoMemoryEntry>;
      const canonical = canonicalizeEntry(parsed);
      if (canonical) rawEntries.push(canonical);
      else malformedCount += 1;
    } catch {
      malformedCount += 1;
    }
  }

  const totalBefore = rawEntries.length;
  const { ttlDays, nearDuplicateThreshold } = readMemoryConfig();

  const deduped = dedupeEntries(rawEntries);
  const nearDuplicatesMarked = markNearDuplicates(deduped, nearDuplicateThreshold);
  const withStalePolicy = applyStalePolicy(deduped, ttlDays);

  const staleCount = withStalePolicy.filter((e) => e.status === 'stale').length;
  const activeCount = withStalePolicy.filter((e) => e.status !== 'stale').length;

  return {
    totalBefore,
    activeAfter: activeCount,
    staleMarked: staleCount,
    nearDuplicatesMarked,
    pruned: 0,
    malformedSkipped: malformedCount,
  };
}


