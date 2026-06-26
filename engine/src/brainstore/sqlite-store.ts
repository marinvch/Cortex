/**
 * SqliteBrainStore — the default local BrainStore index (issue #282).
 *
 * Backed by node:sqlite (Node >=22). The vault is authoritative; this index is a
 * disposable cache rebuilt from it. Embeddings are stored as BLOBs and ranked with
 * a JS cosine kNN (the embedding PROVIDER is a later sub-project — until then,
 * embeddings are simply absent and search falls back to text matching).
 *
 * SCOPING INVARIANT: every read statement filters by `tenant_id` + `domain` via the
 * shared SCOPE_WHERE clause. `src/tests/brain-scoping-invariant.test.ts` asserts no
 * SELECT on nodes/edges omits it.
 */

import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import {
  assertScope,
  type BrainContext,
  type BrainContextNeighbor,
  type BrainEdge,
  type BrainNode,
  type BrainNodeInput,
  type BrainScope,
  type BrainStore,
  type NodeStatus,
  type RebuildStats,
  type SearchQuery,
  type SearchResult,
} from './types.js';
import { computeFingerprint, listVaultNotes, noteToNode, parseNote, slugify } from './vault.js';
import fs from 'node:fs';

/** The one and only scope predicate. Every read concatenates this — do not inline a variant. */
const SCOPE_WHERE = 'WHERE tenant_id = ? AND domain = ?';

interface NodeRow {
  id: string;
  tenant_id: string;
  domain: string;
  title: string;
  content: string;
  category: string;
  tags: string;
  status: string;
  path: string;
  fingerprint: string;
  created_at: string;
  updated_at: string | null;
  embedding: Uint8Array | null;
}

function rowToNode(row: NodeRow): BrainNode {
  let tags: string[] = [];
  try {
    const parsed = JSON.parse(row.tags);
    if (Array.isArray(parsed)) tags = parsed.filter((t) => typeof t === 'string');
  } catch {
    tags = [];
  }
  return {
    id: row.id,
    tenantId: row.tenant_id,
    domain: row.domain as BrainNode['domain'],
    title: row.title,
    content: row.content,
    category: row.category,
    tags,
    status: row.status as NodeStatus,
    path: row.path,
    fingerprint: row.fingerprint,
    createdAt: row.created_at,
    updatedAt: row.updated_at ?? undefined,
    embedding: row.embedding ? bytesToFloat32(row.embedding) : null,
  };
}

function float32ToBytes(vec: Float32Array): Uint8Array {
  return new Uint8Array(vec.buffer, vec.byteOffset, vec.byteLength);
}

function bytesToFloat32(bytes: Uint8Array): Float32Array {
  // Copy into an aligned buffer (the BLOB may not be 4-byte aligned).
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Float32Array(copy.buffer);
}

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export interface SqliteBrainStoreOptions {
  /** Path to the SQLite file, or ':memory:'. */
  dbPath: string;
}

export class SqliteBrainStore implements BrainStore {
  private db: DatabaseSync;

  constructor(opts: SqliteBrainStoreOptions) {
    if (opts.dbPath !== ':memory:') {
      fs.mkdirSync(path.dirname(opts.dbPath), { recursive: true });
    }
    this.db = new DatabaseSync(opts.dbPath);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS nodes (
        id TEXT NOT NULL,
        tenant_id TEXT NOT NULL,
        domain TEXT NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        category TEXT NOT NULL,
        tags TEXT NOT NULL,
        status TEXT NOT NULL,
        path TEXT NOT NULL,
        fingerprint TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT,
        embedding BLOB,
        PRIMARY KEY (tenant_id, domain, id)
      );
      CREATE INDEX IF NOT EXISTS idx_nodes_scope ON nodes(tenant_id, domain, status);
      CREATE INDEX IF NOT EXISTS idx_nodes_category ON nodes(tenant_id, domain, category);

      CREATE TABLE IF NOT EXISTS edges (
        src_id TEXT NOT NULL,
        dst_id TEXT NOT NULL,
        type TEXT NOT NULL,
        tenant_id TEXT NOT NULL,
        domain TEXT NOT NULL,
        PRIMARY KEY (tenant_id, domain, src_id, dst_id, type)
      );
      CREATE INDEX IF NOT EXISTS idx_edges_src ON edges(tenant_id, domain, src_id);
      CREATE INDEX IF NOT EXISTS idx_edges_dst ON edges(tenant_id, domain, dst_id);
    `);
  }

  async upsertNode(input: BrainNodeInput): Promise<string> {
    if (!input.tenantId || typeof input.tenantId !== 'string') {
      throw new Error('BrainStore.upsertNode: tenantId is required');
    }
    if (input.domain !== 'project' && input.domain !== 'personal' && input.domain !== 'shared') {
      throw new Error('BrainStore.upsertNode: valid domain is required');
    }
    const title = input.title?.trim() || 'Untitled';
    const content = input.content ?? '';
    const category = input.category?.trim() || 'general';
    const id = input.id?.trim() || slugify(title);
    const fingerprint = input.fingerprint || computeFingerprint(category, title, content);
    const tags = JSON.stringify(input.tags ?? []);
    const status: NodeStatus = input.status === 'stale' ? 'stale' : 'active';
    const createdAt = input.createdAt || new Date(0).toISOString();
    const notePath = input.path || `${slugify(title)}.md`;
    const embedding = input.embedding ? float32ToBytes(input.embedding) : null;

    this.db
      .prepare(
        `INSERT INTO nodes (id, tenant_id, domain, title, content, category, tags, status, path, fingerprint, created_at, updated_at, embedding)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(tenant_id, domain, id) DO UPDATE SET
           title=excluded.title, content=excluded.content, category=excluded.category,
           tags=excluded.tags, status=excluded.status, path=excluded.path,
           fingerprint=excluded.fingerprint, updated_at=excluded.updated_at, embedding=excluded.embedding`,
      )
      .run(
        id,
        input.tenantId,
        input.domain,
        title,
        content,
        category,
        tags,
        status,
        notePath,
        fingerprint,
        createdAt,
        input.updatedAt ?? null,
        embedding,
      );
    return id;
  }

  async addEdge(edge: BrainEdge): Promise<void> {
    if (!edge.tenantId || (edge.domain !== 'project' && edge.domain !== 'personal' && edge.domain !== 'shared')) {
      throw new Error('BrainStore.addEdge: tenantId and valid domain are required');
    }
    this.db
      .prepare(
        `INSERT INTO edges (src_id, dst_id, type, tenant_id, domain) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(tenant_id, domain, src_id, dst_id, type) DO NOTHING`,
      )
      .run(edge.srcId, edge.dstId, edge.type, edge.tenantId, edge.domain);
  }

  async listNodes(scope: BrainScope, opts?: { includeStale?: boolean }): Promise<BrainNode[]> {
    assertScope(scope);
    let sql = `SELECT * FROM nodes ${SCOPE_WHERE}`;
    if (!opts?.includeStale) sql += ` AND status = 'active'`;
    const rows = this.db.prepare(sql).all(scope.tenantId, scope.domain) as unknown as NodeRow[];
    return rows.map(rowToNode);
  }

  async search(query: SearchQuery, scope: BrainScope): Promise<SearchResult[]> {
    assertScope(scope);
    const limit = query.limit && query.limit > 0 ? query.limit : 20;
    const params: Array<string> = [scope.tenantId, scope.domain];
    let sql = `SELECT * FROM nodes ${SCOPE_WHERE}`;
    if (!query.includeStale) sql += ` AND status = 'active'`;
    if (query.category) {
      sql += ` AND category = ?`;
      params.push(query.category);
    }
    if (query.text) {
      sql += ` AND (title LIKE ? OR content LIKE ? OR tags LIKE ? OR category LIKE ?)`;
      const like = `%${query.text}%`;
      params.push(like, like, like, like);
    }
    const rows = this.db.prepare(sql).all(...params) as unknown as NodeRow[];
    let nodes = rows.map(rowToNode);

    if (query.tags && query.tags.length > 0) {
      const want = new Set(query.tags.map((t) => t.toLowerCase()));
      nodes = nodes.filter((n) => n.tags.some((t) => want.has(t.toLowerCase())));
    }

    // Vector kNN when a query embedding is supplied and nodes carry embeddings.
    if (query.vector && query.vector.length > 0) {
      const scored = nodes
        .filter((n) => n.embedding && n.embedding.length === query.vector!.length)
        .map((n) => ({ node: n, score: cosineSimilarity(query.vector!, n.embedding as Float32Array) }))
        .sort((a, b) => b.score - a.score);
      return scored.slice(0, limit);
    }

    // Text relevance heuristic.
    const term = query.text?.toLowerCase();
    const scored = nodes.map((n) => ({ node: n, score: term ? textScore(n, term) : 1 }));
    scored.sort((a, b) => b.score - a.score || b.node.createdAt.localeCompare(a.node.createdAt));
    return scored.slice(0, limit);
  }

  async getContext(
    nodeId: string,
    scope: BrainScope,
    opts?: { limit?: number },
  ): Promise<BrainContext | null> {
    assertScope(scope);
    const row = this.db
      .prepare(`SELECT * FROM nodes ${SCOPE_WHERE} AND id = ?`)
      .get(scope.tenantId, scope.domain, nodeId) as unknown as NodeRow | undefined;
    if (!row) return null;
    const node = rowToNode(row);
    const limit = opts?.limit && opts.limit > 0 ? opts.limit : 50;

    const outEdges = this.db
      .prepare(`SELECT * FROM edges ${SCOPE_WHERE} AND src_id = ? LIMIT ?`)
      .all(scope.tenantId, scope.domain, nodeId, limit) as unknown as BrainEdgeRow[];
    const inEdges = this.db
      .prepare(`SELECT * FROM edges ${SCOPE_WHERE} AND dst_id = ? LIMIT ?`)
      .all(scope.tenantId, scope.domain, nodeId, limit) as unknown as BrainEdgeRow[];

    const neighbors: BrainContextNeighbor[] = [];
    for (const e of outEdges) {
      const nb = this.getNodeInScope(e.dst_id, scope);
      if (nb) neighbors.push({ node: nb, edge: edgeRowToEdge(e), direction: 'out' });
    }
    for (const e of inEdges) {
      const nb = this.getNodeInScope(e.src_id, scope);
      if (nb) neighbors.push({ node: nb, edge: edgeRowToEdge(e), direction: 'in' });
    }
    return { node, neighbors };
  }

  private getNodeInScope(id: string, scope: BrainScope): BrainNode | null {
    const row = this.db
      .prepare(`SELECT * FROM nodes ${SCOPE_WHERE} AND id = ?`)
      .get(scope.tenantId, scope.domain, id) as unknown as NodeRow | undefined;
    return row ? rowToNode(row) : null;
  }

  async rebuild(vaultPath: string): Promise<RebuildStats> {
    const stats: RebuildStats = { notesParsed: 0, nodesUpserted: 0, edgesUpserted: 0, danglingLinks: 0, malformed: 0 };
    // The index is a disposable cache — clear it and repopulate from the authoritative vault.
    this.db.exec('DELETE FROM edges; DELETE FROM nodes;');

    const relPaths = listVaultNotes(vaultPath);
    // First pass: nodes + a title/path -> id map (scoped) for wikilink resolution.
    const titleToId = new Map<string, { id: string; tenantId: string; domain: string }>();
    const pending: Array<{ node: Omit<BrainNode, 'embedding'>; links: string[] }> = [];

    for (const rel of relPaths) {
      let raw: string;
      try {
        raw = fs.readFileSync(path.join(vaultPath, rel), 'utf8');
      } catch {
        stats.malformed++;
        continue;
      }
      const parsed = parseNote(raw, rel);
      const node = noteToNode(parsed, inferDefaultsFromPath(rel));
      stats.notesParsed++;
      await this.upsertNode(node);
      stats.nodesUpserted++;
      titleToId.set(scopedKey(node.tenantId, node.domain, node.title), { id: node.id, tenantId: node.tenantId, domain: node.domain });
      titleToId.set(scopedKey(node.tenantId, node.domain, node.id), { id: node.id, tenantId: node.tenantId, domain: node.domain });
      pending.push({ node, links: parsed.links });
    }

    // Second pass: resolve `[[wikilinks]]` to edges within the same scope.
    for (const { node, links } of pending) {
      for (const target of links) {
        const resolved = titleToId.get(scopedKey(node.tenantId, node.domain, target));
        if (!resolved) {
          stats.danglingLinks++;
          continue;
        }
        await this.addEdge({ srcId: node.id, dstId: resolved.id, type: 'wikilink', tenantId: node.tenantId, domain: node.domain });
        stats.edgesUpserted++;
      }
    }
    return stats;
  }

  async deleteTenant(tenantId: string): Promise<number> {
    if (!tenantId) throw new Error('BrainStore.deleteTenant: tenantId is required');
    const before = (this.db.prepare('SELECT COUNT(*) AS c FROM nodes WHERE tenant_id = ?').get(tenantId) as { c: number }).c;
    this.db.prepare('DELETE FROM edges WHERE tenant_id = ?').run(tenantId);
    this.db.prepare('DELETE FROM nodes WHERE tenant_id = ?').run(tenantId);
    return before;
  }

  close(): void {
    this.db.close();
  }
}

interface BrainEdgeRow {
  src_id: string;
  dst_id: string;
  type: string;
  tenant_id: string;
  domain: string;
}

function edgeRowToEdge(row: BrainEdgeRow): BrainEdge {
  return { srcId: row.src_id, dstId: row.dst_id, type: row.type, tenantId: row.tenant_id, domain: row.domain as BrainEdge['domain'] };
}

function scopedKey(tenantId: string, domain: string, name: string): string {
  return `${tenantId}::${domain}::${name.trim().toLowerCase()}`;
}

function textScore(node: BrainNode, term: string): number {
  let score = 0;
  if (node.title.toLowerCase().includes(term)) score += 3;
  if (node.category.toLowerCase().includes(term)) score += 2;
  if (node.tags.some((t) => t.toLowerCase().includes(term))) score += 2;
  if (node.content.toLowerCase().includes(term)) score += 1;
  return score;
}

/** Infer default scope from a vault layout like `<domain>/<tenant>/note.md` (best-effort). */
function inferDefaultsFromPath(rel: string): { tenantId: string; domain: BrainNode['domain'] } {
  const parts = rel.split('/');
  const domainCandidate = parts[0];
  const domain: BrainNode['domain'] =
    domainCandidate === 'personal' || domainCandidate === 'project' || domainCandidate === 'shared'
      ? domainCandidate
      : 'personal';
  return { tenantId: 'local', domain };
}
