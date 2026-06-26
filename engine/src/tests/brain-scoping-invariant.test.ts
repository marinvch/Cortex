/**
 * The tenant+domain scoping invariant (issue #282 / #272 differentiator):
 *   "Every BrainStore query is scoped by tenant_id + domain, enforced by a test
 *    that fails if any query lacks scope."
 *
 * Two layers:
 *  1. STRUCTURAL — scan the SQLite impl source; every content read (`SELECT *`
 *     from nodes/edges) must carry the shared SCOPE_WHERE (tenant_id AND domain).
 *  2. RUNTIME — reads throw without a valid scope, and no fact crosses a
 *     tenant or domain boundary.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SqliteBrainStore } from '../brainstore/sqlite-store.js';
import { assertScope } from '../brainstore/types.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const storeSource = fs.readFileSync(path.resolve(here, '../brainstore/sqlite-store.ts'), 'utf8');

describe('scoping invariant: structural', () => {
  it('defines a single SCOPE_WHERE predicate filtering tenant_id AND domain', () => {
    const m = storeSource.match(/SCOPE_WHERE\s*=\s*'([^']+)'/);
    expect(m, 'SCOPE_WHERE constant must exist').not.toBeNull();
    const clause = m![1];
    expect(clause).toContain('tenant_id = ?');
    expect(clause).toContain('domain = ?');
  });

  it('every content read (SELECT * FROM nodes/edges) is scoped via SCOPE_WHERE', () => {
    const lines = storeSource.split('\n');
    const offenders: string[] = [];
    for (const line of lines) {
      if (/SELECT \* FROM (nodes|edges)/.test(line)) {
        if (!line.includes('${SCOPE_WHERE}')) {
          offenders.push(line.trim());
        }
      }
    }
    expect(offenders, `unscoped content reads found:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('has at least one scoped content read (guards against the regex silently matching nothing)', () => {
    const count = (storeSource.match(/SELECT \* FROM (nodes|edges) \$\{SCOPE_WHERE\}/g) ?? []).length;
    expect(count).toBeGreaterThanOrEqual(3);
  });
});

describe('scoping invariant: assertScope guard', () => {
  it('throws on missing/empty tenantId', () => {
    expect(() => assertScope(undefined)).toThrow(/tenantId/);
    expect(() => assertScope({ tenantId: '', domain: 'project' })).toThrow(/tenantId/);
    expect(() => assertScope({ tenantId: '   ', domain: 'project' })).toThrow(/tenantId/);
  });
  it('throws on invalid domain', () => {
    // @ts-expect-error intentionally invalid domain
    expect(() => assertScope({ tenantId: 'local', domain: 'bogus' })).toThrow(/domain/);
  });
  it('accepts a complete scope', () => {
    expect(() => assertScope({ tenantId: 'local', domain: 'personal' })).not.toThrow();
  });
});

describe('scoping invariant: runtime isolation', () => {
  let store: SqliteBrainStore;
  beforeEach(() => (store = new SqliteBrainStore({ dbPath: ':memory:' })));
  afterEach(() => store.close());

  it('search rejects an incomplete scope', async () => {
    await expect(store.search({ text: 'x' }, { tenantId: '', domain: 'project' })).rejects.toThrow();
  });
  it('getContext rejects an incomplete scope', async () => {
    await expect(store.getContext('a', { tenantId: '', domain: 'project' })).rejects.toThrow();
  });

  it('does not leak nodes across tenants', async () => {
    await store.upsertNode({ id: 'a', tenantId: 'alice', domain: 'project', title: 'secret', content: 'alice only' });
    const asBob = await store.search({ text: 'secret' }, { tenantId: 'bob', domain: 'project' });
    expect(asBob).toEqual([]);
    const asAlice = await store.search({ text: 'secret' }, { tenantId: 'alice', domain: 'project' });
    expect(asAlice.map((r) => r.node.id)).toEqual(['a']);
  });

  it('does not leak nodes across domains within a tenant', async () => {
    await store.upsertNode({ id: 'p', tenantId: 'local', domain: 'personal', title: 'personal note', content: 'mine' });
    const asProject = await store.search({ text: 'personal note' }, { tenantId: 'local', domain: 'project' });
    expect(asProject).toEqual([]);
    const asPersonal = await store.search({ text: 'personal note' }, { tenantId: 'local', domain: 'personal' });
    expect(asPersonal.map((r) => r.node.id)).toEqual(['p']);
  });

  it('getContext cannot reach a same-id node in another scope', async () => {
    await store.upsertNode({ id: 'dup', tenantId: 'local', domain: 'personal', title: 'P', content: 'personal' });
    await store.upsertNode({ id: 'dup', tenantId: 'local', domain: 'project', title: 'J', content: 'project' });
    const personal = await store.getContext('dup', { tenantId: 'local', domain: 'personal' });
    const project = await store.getContext('dup', { tenantId: 'local', domain: 'project' });
    expect(personal!.node.content).toBe('personal');
    expect(project!.node.content).toBe('project');
  });

  it('deleteTenant removes only that tenant', async () => {
    await store.upsertNode({ id: 'a', tenantId: 'alice', domain: 'project', title: 'A', content: '' });
    await store.upsertNode({ id: 'b', tenantId: 'bob', domain: 'project', title: 'B', content: '' });
    const removed = await store.deleteTenant('alice');
    expect(removed).toBe(1);
    expect(await store.search({ text: 'A' }, { tenantId: 'alice', domain: 'project' })).toEqual([]);
    expect((await store.search({ text: 'B' }, { tenantId: 'bob', domain: 'project' })).length).toBe(1);
  });
});
