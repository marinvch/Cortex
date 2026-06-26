import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SqliteBrainStore } from '../brainstore/sqlite-store.js';
import { HashingEmbeddingProvider } from '../brainstore/embedding.js';
import { reindexEmbeddings, semanticSearch } from '../brainstore/semantic.js';
import { importJsonlToVault } from '../brainstore/import-jsonl.js';
import type { BrainScope } from '../brainstore/types.js';

const SCOPE: BrainScope = { tenantId: 'local', domain: 'project' };

describe('reindexEmbeddings + semanticSearch', () => {
  let store: SqliteBrainStore;
  const provider = new HashingEmbeddingProvider({ dimensions: 512 });

  beforeEach(() => (store = new SqliteBrainStore({ dbPath: ':memory:' })));
  afterEach(() => store.close());

  it('embeds all nodes in scope and reports stats', async () => {
    await store.upsertNode({ id: 'a', tenantId: 'local', domain: 'project', title: 'CI build pipeline', content: 'npm ci then tsc build' });
    await store.upsertNode({ id: 'b', tenantId: 'local', domain: 'project', title: 'Testing', content: 'vitest unit tests' });
    const stats = await reindexEmbeddings(store, provider, SCOPE);
    expect(stats.embedded).toBe(2);
    expect(stats.dimensions).toBe(512);
    expect(stats.provider).toBe('hashing');
  });

  it('ranks the semantically closest node first', async () => {
    await store.upsertNode({ id: 'build', tenantId: 'local', domain: 'project', title: 'Build pipeline', content: 'run npm ci then tsc to compile typescript' });
    await store.upsertNode({ id: 'cook', tenantId: 'local', domain: 'project', title: 'Banana bread', content: 'a recipe with flour and sugar' });
    await reindexEmbeddings(store, provider, SCOPE);

    const results = await semanticSearch(store, provider, 'how do I compile typescript with tsc', SCOPE);
    expect(results[0].node.id).toBe('build');
  });

  it('falls back to text search when nothing is embedded', async () => {
    await store.upsertNode({ id: 'x', tenantId: 'local', domain: 'project', title: 'Unique marker zzz', content: 'body' });
    // no reindex → no embeddings
    const results = await semanticSearch(store, provider, 'zzz', SCOPE);
    expect(results.map((r) => r.node.id)).toContain('x');
  });

  it('semanticSearch stays within scope', async () => {
    await store.upsertNode({ id: 'p', tenantId: 'local', domain: 'project', title: 'project secret', content: 'tsc build' });
    await store.upsertNode({ id: 'pe', tenantId: 'local', domain: 'personal', title: 'personal secret', content: 'tsc build' });
    await reindexEmbeddings(store, provider, SCOPE);
    await reindexEmbeddings(store, provider, { tenantId: 'local', domain: 'personal' });

    const proj = await semanticSearch(store, provider, 'tsc build', SCOPE);
    expect(proj.every((r) => r.node.domain === 'project')).toBe(true);
    expect(proj.map((r) => r.node.id)).toEqual(['p']);
  });

  it('rejects an incomplete scope', async () => {
    await expect(reindexEmbeddings(store, provider, { tenantId: '', domain: 'project' })).rejects.toThrow();
    await expect(semanticSearch(store, provider, 'q', { tenantId: '', domain: 'project' })).rejects.toThrow();
  });
});

describe('importJsonlToVault with embeddings', () => {
  let dir: string;
  beforeEach(() => (dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-sem-'))));
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('builds embeddings per domain during import and supports semantic search', async () => {
    const jsonl = path.join(dir, 'memory.jsonl');
    const vault = path.join(dir, 'vault');
    const dbPath = path.join(dir, 'index.db');
    fs.writeFileSync(
      jsonl,
      [
        { id: 'p1', title: 'Build', content: 'tsc compile typescript', domain: 'project' },
        { id: 'pe1', title: 'Value', content: 'sovereignty and ownership', domain: 'personal' },
      ]
        .map((e) => JSON.stringify(e))
        .join('\n'),
    );

    const stats = await importJsonlToVault({
      jsonlPath: jsonl,
      vaultPath: vault,
      dbPath,
      tenantId: 'local',
      embedding: { provider: 'hashing', dimensions: 256 },
    });
    expect(stats.reindex).toBeDefined();
    const totalEmbedded = stats.reindex!.reduce((s, r) => s + r.embedded, 0);
    expect(totalEmbedded).toBe(2);

    const store = new SqliteBrainStore({ dbPath });
    const provider = new HashingEmbeddingProvider({ dimensions: 256 });
    const hits = await semanticSearch(store, provider, 'compile typescript', { tenantId: 'local', domain: 'project' });
    expect(hits[0].node.id).toBe('p1');
    store.close();
  });
});
