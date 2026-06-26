import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { importJsonlToVault } from '../brainstore/import-jsonl.js';
import { listVaultNotes } from '../brainstore/vault.js';
import { SqliteBrainStore } from '../brainstore/sqlite-store.js';

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-import-'));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

function writeJsonl(file: string, entries: object[]): void {
  fs.writeFileSync(file, entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
}

describe('importJsonlToVault', () => {
  it('migrates memory.jsonl entries into vault notes under their domain', async () => {
    const jsonl = path.join(dir, 'memory.jsonl');
    const vault = path.join(dir, 'vault');
    writeJsonl(jsonl, [
      { id: '1', title: 'Build pipeline', content: 'npm ci then tsc', category: 'build', tags: ['ci'], domain: 'project', createdAt: '2026-01-01T00:00:00.000Z' },
      { id: '2', title: 'My value', content: 'sovereignty', category: 'promoted', tags: [], domain: 'personal', createdAt: '2026-01-02T00:00:00.000Z' },
    ]);

    const stats = await importJsonlToVault({ jsonlPath: jsonl, vaultPath: vault });
    expect(stats.read).toBe(2);
    expect(stats.written).toBe(2);

    const notes = listVaultNotes(vault);
    expect(notes).toContain('project/build-pipeline.md');
    expect(notes).toContain('personal/my-value.md');
    expect(fs.readFileSync(path.join(vault, 'project/build-pipeline.md'), 'utf8')).toContain('domain: project');
  });

  it('builds a queryable, correctly-scoped index when dbPath is given', async () => {
    const jsonl = path.join(dir, 'memory.jsonl');
    const vault = path.join(dir, 'vault');
    const dbPath = path.join(dir, 'index.db');
    writeJsonl(jsonl, [
      { id: 'p1', title: 'Project fact', content: 'about the repo', category: 'general', tags: [], domain: 'project', createdAt: '2026-01-01T00:00:00.000Z' },
      { id: 'pe1', title: 'Personal fact', content: 'about me', category: 'general', tags: [], domain: 'personal', createdAt: '2026-01-01T00:00:00.000Z' },
    ]);

    const stats = await importJsonlToVault({ jsonlPath: jsonl, vaultPath: vault, dbPath, tenantId: 'local' });
    expect(stats.rebuild?.nodesUpserted).toBe(2);

    const store = new SqliteBrainStore({ dbPath });
    const project = await store.search({ text: 'repo' }, { tenantId: 'local', domain: 'project' });
    expect(project.map((r) => r.node.id)).toEqual(['p1']);
    // personal entry must NOT appear in the project scope
    const leak = await store.search({ text: 'about me' }, { tenantId: 'local', domain: 'project' });
    expect(leak).toEqual([]);
    const personal = await store.search({ text: 'about me' }, { tenantId: 'local', domain: 'personal' });
    expect(personal.map((r) => r.node.id)).toEqual(['pe1']);
    store.close();
  });

  it('counts malformed lines and skips empty entries; missing file is a no-op', async () => {
    const jsonl = path.join(dir, 'memory.jsonl');
    const vault = path.join(dir, 'vault');
    fs.writeFileSync(jsonl, ['{ not json', '{"title":"","content":""}', '{"title":"Keep","content":"x","domain":"project"}'].join('\n'));
    const stats = await importJsonlToVault({ jsonlPath: jsonl, vaultPath: vault });
    expect(stats.malformed).toBe(1);
    expect(stats.skipped).toBe(1);
    expect(stats.written).toBe(1);

    const missing = await importJsonlToVault({ jsonlPath: path.join(dir, 'nope.jsonl'), vaultPath: vault });
    expect(missing).toEqual({ read: 0, written: 0, malformed: 0, skipped: 0 });
  });

  it('de-duplicates filenames for entries with the same title', async () => {
    const jsonl = path.join(dir, 'memory.jsonl');
    const vault = path.join(dir, 'vault');
    writeJsonl(jsonl, [
      { id: 'a', title: 'Same Title', content: 'one', domain: 'project' },
      { id: 'b', title: 'Same Title', content: 'two', domain: 'project' },
    ]);
    const stats = await importJsonlToVault({ jsonlPath: jsonl, vaultPath: vault });
    expect(stats.written).toBe(2);
    const notes = listVaultNotes(vault);
    expect(notes).toContain('project/same-title.md');
    expect(notes).toContain('project/same-title-2.md');
  });
});
