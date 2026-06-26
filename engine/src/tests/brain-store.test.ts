import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SqliteBrainStore, cosineSimilarity } from '../brainstore/sqlite-store.js';
import { nodeToMarkdown } from '../brainstore/vault.js';
import type { BrainNode } from '../brainstore/types.js';

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'brainstore-'));
}

describe('SqliteBrainStore: CRUD + search', () => {
  let store: SqliteBrainStore;

  beforeEach(() => {
    store = new SqliteBrainStore({ dbPath: ':memory:' });
  });
  afterEach(() => {
    store.close();
  });

  it('upserts and retrieves a node by context', async () => {
    const id = await store.upsertNode({
      tenantId: 'local',
      domain: 'project',
      title: 'Build pipeline',
      content: 'Use npm ci then tsc',
      category: 'build',
      tags: ['ci', 'tsc'],
    });
    const ctx = await store.getContext(id, { tenantId: 'local', domain: 'project' });
    expect(ctx).not.toBeNull();
    expect(ctx!.node.title).toBe('Build pipeline');
    expect(ctx!.node.tags).toEqual(['ci', 'tsc']);
  });

  it('upsert is idempotent on (tenant, domain, id) and updates content', async () => {
    await store.upsertNode({ id: 'x', tenantId: 'local', domain: 'project', title: 'T', content: 'v1' });
    await store.upsertNode({ id: 'x', tenantId: 'local', domain: 'project', title: 'T', content: 'v2', updatedAt: '2026-01-01T00:00:00.000Z' });
    const results = await store.search({ text: 'v2' }, { tenantId: 'local', domain: 'project' });
    expect(results).toHaveLength(1);
    expect(results[0].node.content).toBe('v2');
  });

  it('text search ranks title hits above content hits', async () => {
    await store.upsertNode({ id: 'a', tenantId: 'local', domain: 'project', title: 'sqlite index', content: 'about storage' });
    await store.upsertNode({ id: 'b', tenantId: 'local', domain: 'project', title: 'storage notes', content: 'mentions sqlite once' });
    const results = await store.search({ text: 'sqlite' }, { tenantId: 'local', domain: 'project' });
    expect(results[0].node.id).toBe('a');
    expect(results.map((r) => r.node.id)).toContain('b');
  });

  it('filters by category and tags', async () => {
    await store.upsertNode({ id: 'a', tenantId: 'local', domain: 'project', title: 'A', content: '', category: 'build', tags: ['ci'] });
    await store.upsertNode({ id: 'b', tenantId: 'local', domain: 'project', title: 'B', content: '', category: 'testing', tags: ['vitest'] });
    const byCat = await store.search({ category: 'build' }, { tenantId: 'local', domain: 'project' });
    expect(byCat.map((r) => r.node.id)).toEqual(['a']);
    const byTag = await store.search({ tags: ['vitest'] }, { tenantId: 'local', domain: 'project' });
    expect(byTag.map((r) => r.node.id)).toEqual(['b']);
  });

  it('excludes stale nodes unless includeStale', async () => {
    await store.upsertNode({ id: 'live', tenantId: 'local', domain: 'project', title: 'live', content: 'x' });
    await store.upsertNode({ id: 'dead', tenantId: 'local', domain: 'project', title: 'dead', content: 'x', status: 'stale' });
    const active = await store.search({ text: 'x' }, { tenantId: 'local', domain: 'project' });
    expect(active.map((r) => r.node.id).sort()).toEqual(['live']);
    const all = await store.search({ text: 'x', includeStale: true }, { tenantId: 'local', domain: 'project' });
    expect(all.map((r) => r.node.id).sort()).toEqual(['dead', 'live']);
  });
});

describe('SqliteBrainStore: edges + getContext', () => {
  let store: SqliteBrainStore;
  beforeEach(() => (store = new SqliteBrainStore({ dbPath: ':memory:' })));
  afterEach(() => store.close());

  it('returns in/out neighbors', async () => {
    const scope = { tenantId: 'local', domain: 'project' as const };
    await store.upsertNode({ id: 'a', tenantId: 'local', domain: 'project', title: 'A', content: '' });
    await store.upsertNode({ id: 'b', tenantId: 'local', domain: 'project', title: 'B', content: '' });
    await store.upsertNode({ id: 'c', tenantId: 'local', domain: 'project', title: 'C', content: '' });
    await store.addEdge({ srcId: 'a', dstId: 'b', type: 'wikilink', tenantId: 'local', domain: 'project' });
    await store.addEdge({ srcId: 'c', dstId: 'a', type: 'wikilink', tenantId: 'local', domain: 'project' });

    const ctx = await store.getContext('a', scope);
    expect(ctx).not.toBeNull();
    const out = ctx!.neighbors.filter((n) => n.direction === 'out').map((n) => n.node.id);
    const inc = ctx!.neighbors.filter((n) => n.direction === 'in').map((n) => n.node.id);
    expect(out).toEqual(['b']);
    expect(inc).toEqual(['c']);
  });

  it('getContext returns null for unknown id', async () => {
    expect(await store.getContext('nope', { tenantId: 'local', domain: 'project' })).toBeNull();
  });
});

describe('SqliteBrainStore: vector kNN', () => {
  let store: SqliteBrainStore;
  beforeEach(() => (store = new SqliteBrainStore({ dbPath: ':memory:' })));
  afterEach(() => store.close());

  it('ranks by cosine similarity when a query vector is given', async () => {
    await store.upsertNode({ id: 'near', tenantId: 'local', domain: 'project', title: 'near', content: '', embedding: new Float32Array([1, 0, 0]) });
    await store.upsertNode({ id: 'far', tenantId: 'local', domain: 'project', title: 'far', content: '', embedding: new Float32Array([0, 1, 0]) });
    const results = await store.search({ vector: new Float32Array([0.9, 0.1, 0]) }, { tenantId: 'local', domain: 'project' });
    expect(results[0].node.id).toBe('near');
    expect(results[0].score).toBeGreaterThan(results[1].score);
  });

  it('cosineSimilarity is 1 for identical, 0 for orthogonal', () => {
    expect(cosineSimilarity(new Float32Array([1, 2, 3]), new Float32Array([1, 2, 3]))).toBeCloseTo(1);
    expect(cosineSimilarity(new Float32Array([1, 0]), new Float32Array([0, 1]))).toBeCloseTo(0);
  });
});

describe('SqliteBrainStore: rebuild from vault + persistence', () => {
  let dir: string;
  beforeEach(() => (dir = tmpDir()));
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('rebuilds nodes + wikilink edges from a vault, idempotently', async () => {
    const vault = path.join(dir, 'vault');
    fs.mkdirSync(path.join(vault, 'project'), { recursive: true });
    const mkNode = (id: string, title: string, content: string): BrainNode => ({
      id, tenantId: 'local', domain: 'project', title, content, category: 'general', tags: [],
      status: 'active', path: `project/${id}.md`, fingerprint: `f-${id}`, createdAt: '2026-01-01T00:00:00.000Z', embedding: null,
    });
    fs.writeFileSync(path.join(vault, 'project', 'a.md'), nodeToMarkdown(mkNode('a', 'Alpha', 'links to [[Beta]]')));
    fs.writeFileSync(path.join(vault, 'project', 'b.md'), nodeToMarkdown(mkNode('b', 'Beta', 'no links, but [[Ghost]] dangles')));

    const dbPath = path.join(dir, 'index.db');
    const store = new SqliteBrainStore({ dbPath });
    const stats = await store.rebuild(vault);
    expect(stats.notesParsed).toBe(2);
    expect(stats.nodesUpserted).toBe(2);
    expect(stats.edgesUpserted).toBe(1);
    expect(stats.danglingLinks).toBe(1);

    const ctx = await store.getContext('a', { tenantId: 'local', domain: 'project' });
    expect(ctx!.neighbors.map((n) => n.node.id)).toContain('b');

    // Rebuild again → same counts (disposable cache, vault authoritative).
    const stats2 = await store.rebuild(vault);
    expect(stats2.nodesUpserted).toBe(2);
    store.close();

    // Persisted to disk: a fresh store sees the data.
    const reopened = new SqliteBrainStore({ dbPath });
    const found = await reopened.search({ text: 'Alpha' }, { tenantId: 'local', domain: 'project' });
    expect(found.map((r) => r.node.id)).toContain('a');
    reopened.close();
  });
});
