/**
 * Semantic orchestration — glues an EmbeddingProvider to a BrainStore without
 * coupling them (follow-up to #282, part of #272).
 *
 * The store only stores/queries vectors; it never knows which provider produced
 * them. These helpers compute embeddings (the variable-cost step) and feed them in.
 */

import type { BrainScope, BrainStore, SearchResult } from './types.js';
import { assertScope } from './types.js';
import type { EmbeddingProvider } from './embedding.js';

export interface ReindexStats {
  embedded: number;
  dimensions: number;
  provider: string;
}

/**
 * Compute + store embeddings for every node in a scope. Idempotent: re-running
 * recomputes from current content. Scope is mandatory (the reads it does are scoped).
 */
export async function reindexEmbeddings(
  store: BrainStore,
  provider: EmbeddingProvider,
  scope: BrainScope,
  opts?: { includeStale?: boolean },
): Promise<ReindexStats> {
  assertScope(scope);
  const nodes = await store.listNodes(scope, { includeStale: opts?.includeStale });
  if (nodes.length === 0) {
    return { embedded: 0, dimensions: provider.dimensions, provider: provider.id };
  }
  // Embed title + content together — titles carry strong signal.
  const texts = nodes.map((n) => `${n.title}\n\n${n.content}`);
  const vectors = await provider.embed(texts);

  let embedded = 0;
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const vec = vectors[i];
    if (!vec || vec.length !== provider.dimensions) continue;
    await store.upsertNode({
      id: node.id,
      tenantId: node.tenantId,
      domain: node.domain,
      title: node.title,
      content: node.content,
      category: node.category,
      tags: node.tags,
      status: node.status,
      path: node.path,
      fingerprint: node.fingerprint,
      createdAt: node.createdAt,
      updatedAt: node.updatedAt,
      embedding: vec,
    });
    embedded++;
  }
  return { embedded, dimensions: provider.dimensions, provider: provider.id };
}

export interface SemanticSearchOptions {
  limit?: number;
  includeStale?: boolean;
  category?: string;
  tags?: string[];
}

/**
 * Embed the query and run the store's vector kNN within the scope. We pass ONLY the
 * vector (not the text) so kNN ranks across all scoped nodes rather than being
 * pre-narrowed by a lexical LIKE. If nothing is embedded yet, fall back to text search.
 */
export async function semanticSearch(
  store: BrainStore,
  provider: EmbeddingProvider,
  query: string,
  scope: BrainScope,
  opts?: SemanticSearchOptions,
): Promise<SearchResult[]> {
  assertScope(scope);
  const [vector] = await provider.embed([query]);
  const vectorResults = await store.search(
    { vector, limit: opts?.limit, includeStale: opts?.includeStale, category: opts?.category, tags: opts?.tags },
    scope,
  );
  if (vectorResults.length > 0) return vectorResults;
  // No comparable embeddings indexed → graceful lexical fallback.
  return store.search(
    { text: query, limit: opts?.limit, includeStale: opts?.includeStale, category: opts?.category, tags: opts?.tags },
    scope,
  );
}
