/**
 * BrainStore — types and the storage-seam interface (issue #282, part of #272).
 *
 * The Markdown vault is the source of truth; a BrainStore is a rebuildable INDEX
 * derived from it (default: node:sqlite). The interface is async so a future cloud
 * impl (Turso/libSQL, Postgres+pgvector) drops in without touching engine logic.
 *
 * INVARIANT: every read (`search`, `getContext`) is scoped by `tenant_id` + `domain`.
 * No fact ever crosses a tenant or domain boundary. Enforced by tests in
 * `src/tests/brain-scoping-invariant.test.ts`.
 */

/** The three-domain data model (mirrors RepoMemoryEntry.domain in mcp-server/memory.ts). */
export type Domain = 'project' | 'personal' | 'shared';

export type NodeStatus = 'active' | 'stale';

/** The mandatory scope on every read. Single-user local = one fixed tenant. */
export interface BrainScope {
  tenantId: string;
  domain: Domain;
}

/** A node in the graph brain = one vault note. */
export interface BrainNode {
  id: string;
  tenantId: string;
  domain: Domain;
  title: string;
  content: string;
  category: string;
  tags: string[];
  status: NodeStatus;
  /** Relative path of the source note in the vault (the authoritative artifact). */
  path: string;
  fingerprint: string;
  createdAt: string;
  updatedAt?: string;
  /** Optional embedding (Float32) for vector kNN. Populated by a later sub-project. */
  embedding?: Float32Array | null;
}

/** Input for upsert — tenant + domain are mandatory; id/derived fields optional. */
export interface BrainNodeInput {
  id?: string;
  tenantId: string;
  domain: Domain;
  title: string;
  content: string;
  category?: string;
  tags?: string[];
  status?: NodeStatus;
  path?: string;
  fingerprint?: string;
  createdAt?: string;
  updatedAt?: string;
  embedding?: Float32Array | null;
}

/** An edge between two nodes (e.g. a `[[wikilink]]`). Carries scope so traversal cannot cross boundaries. */
export interface BrainEdge {
  srcId: string;
  dstId: string;
  type: string;
  tenantId: string;
  domain: Domain;
}

export interface SearchQuery {
  /** Free-text match over title/content/tags/category. */
  text?: string;
  category?: string;
  tags?: string[];
  /** Optional query embedding → JS cosine kNN over stored embeddings. */
  vector?: Float32Array;
  limit?: number;
  /** Include `stale` nodes (default false). */
  includeStale?: boolean;
}

export interface SearchResult {
  node: BrainNode;
  /** Relevance score: text-match heuristic or cosine similarity for vector queries. */
  score: number;
}

export interface BrainContextNeighbor {
  node: BrainNode;
  edge: BrainEdge;
  /** 'out' = this node links to neighbor; 'in' = neighbor links to this node. */
  direction: 'out' | 'in';
}

export interface BrainContext {
  node: BrainNode;
  neighbors: BrainContextNeighbor[];
}

export interface RebuildStats {
  notesParsed: number;
  nodesUpserted: number;
  edgesUpserted: number;
  danglingLinks: number;
  malformed: number;
}

/**
 * The storage seam. Local impl = SqliteBrainStore; cloud impls drop in here.
 * Writes carry their scope in the data; reads take an explicit BrainScope.
 */
export interface BrainStore {
  upsertNode(input: BrainNodeInput): Promise<string>;
  addEdge(edge: BrainEdge): Promise<void>;
  /** All nodes in a scope (scoped read — used by embedding reindex). */
  listNodes(scope: BrainScope, opts?: { includeStale?: boolean }): Promise<BrainNode[]>;
  search(query: SearchQuery, scope: BrainScope): Promise<SearchResult[]>;
  getContext(
    nodeId: string,
    scope: BrainScope,
    opts?: { limit?: number },
  ): Promise<BrainContext | null>;
  /** Reparse the vault and repopulate the index. The vault is authoritative. */
  rebuild(vaultPath: string): Promise<RebuildStats>;
  /** Per-tenant hard delete (GDPR seam — #272). */
  deleteTenant(tenantId: string): Promise<number>;
  close(): void;
}

/** Throws if a read is attempted without a complete tenant + domain scope. */
export function assertScope(scope: BrainScope | undefined): asserts scope is BrainScope {
  if (!scope || typeof scope.tenantId !== 'string' || scope.tenantId.trim() === '') {
    throw new Error('BrainStore: query requires a non-empty scope.tenantId');
  }
  if (scope.domain !== 'project' && scope.domain !== 'personal' && scope.domain !== 'shared') {
    throw new Error(`BrainStore: query requires a valid scope.domain (got ${JSON.stringify(scope.domain)})`);
  }
}
