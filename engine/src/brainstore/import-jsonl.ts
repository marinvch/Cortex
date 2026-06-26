/**
 * Importer: existing `memory.jsonl` → Markdown vault notes (+ optional index rebuild).
 *
 * The legacy JSONL (mcp-server/memory.ts RepoMemoryEntry) is migrated into the
 * authoritative vault. The SQLite index, if requested, is then REBUILT from the
 * vault — never written directly — so the vault stays the single source of truth.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { BrainNode, Domain, NodeStatus } from './types.js';
import { computeFingerprint, nodeToMarkdown, slugify } from './vault.js';
import { SqliteBrainStore } from './sqlite-store.js';
import type { RebuildStats } from './types.js';

interface JsonlEntry {
  id?: string;
  createdAt?: string;
  updatedAt?: string;
  title?: string;
  content?: string;
  category?: string;
  tags?: unknown;
  status?: string;
  domain?: string;
  fingerprint?: string;
}

export interface ImportOptions {
  jsonlPath: string;
  vaultPath: string;
  /** If set, build/refresh the SQLite index from the vault after writing notes. */
  dbPath?: string;
  /** Tenant assigned to entries that don't carry one (single-user local = 'local'). */
  tenantId?: string;
  /** Domain to assume when an entry omits one. */
  defaultDomain?: Domain;
}

export interface ImportStats {
  read: number;
  written: number;
  malformed: number;
  skipped: number;
  rebuild?: RebuildStats;
}

const VALID_DOMAINS: Domain[] = ['project', 'personal', 'shared'];

function toTags(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.filter((t): t is string => typeof t === 'string');
  return [];
}

/** Migrate a JSONL memory file into vault notes, then (optionally) rebuild the index. */
export async function importJsonlToVault(opts: ImportOptions): Promise<ImportStats> {
  const tenantId = opts.tenantId || 'local';
  const defaultDomain = opts.defaultDomain || 'project';
  const stats: ImportStats = { read: 0, written: 0, malformed: 0, skipped: 0 };

  if (!fs.existsSync(opts.jsonlPath)) {
    return stats;
  }

  const raw = fs.readFileSync(opts.jsonlPath, 'utf8');
  const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);
  const usedPaths = new Set<string>();

  for (const line of lines) {
    let entry: JsonlEntry;
    try {
      entry = JSON.parse(line) as JsonlEntry;
    } catch {
      stats.malformed++;
      continue;
    }
    stats.read++;

    const title = (entry.title ?? '').trim();
    const content = (entry.content ?? '').trim();
    if (!title && !content) {
      stats.skipped++;
      continue;
    }

    const domain: Domain = VALID_DOMAINS.includes(entry.domain as Domain)
      ? (entry.domain as Domain)
      : defaultDomain;
    const category = (entry.category ?? 'general').trim() || 'general';
    const status: NodeStatus = entry.status === 'stale' ? 'stale' : 'active';
    const effectiveTitle = title || `Note ${entry.id ?? ''}`.trim();

    const node: Omit<BrainNode, 'embedding'> = {
      id: (entry.id ?? '').trim() || slugify(effectiveTitle),
      tenantId,
      domain,
      title: effectiveTitle,
      content,
      category,
      tags: toTags(entry.tags),
      status,
      path: '',
      fingerprint: entry.fingerprint || computeFingerprint(category, effectiveTitle, content),
      createdAt: entry.createdAt || new Date(0).toISOString(),
      updatedAt: entry.updatedAt,
    };

    const relPath = uniquePath(domain, effectiveTitle, usedPaths);
    usedPaths.add(relPath);
    const full = path.join(opts.vaultPath, relPath);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, nodeToMarkdown({ ...node, path: relPath }), 'utf8');
    stats.written++;
  }

  if (opts.dbPath) {
    const store = new SqliteBrainStore({ dbPath: opts.dbPath });
    try {
      stats.rebuild = await store.rebuild(opts.vaultPath);
    } finally {
      store.close();
    }
  }

  return stats;
}

function uniquePath(domain: Domain, title: string, used: Set<string>): string {
  const base = `${domain}/${slugify(title)}`;
  let candidate = `${base}.md`;
  let n = 2;
  while (used.has(candidate)) {
    candidate = `${base}-${n}.md`;
    n++;
  }
  return candidate;
}
