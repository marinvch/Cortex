import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { computeBoundaryReport } from '../actions/check-boundaries.js';

let cwd: string;
beforeEach(() => {
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'aios-bound-'));
  fs.mkdirSync(path.join(cwd, '.github', 'ai-os', 'memory'), { recursive: true });
});
afterEach(() => fs.rmSync(cwd, { recursive: true, force: true }));

function writeMem(lines: object[]) {
  fs.writeFileSync(
    path.join(cwd, '.github', 'ai-os', 'memory', 'memory.jsonl'),
    lines.map((l) => JSON.stringify(l)).join('\n') + '\n',
  );
}

describe('computeBoundaryReport', () => {
  it('reports clean when all entries are project-domain and gitignore is set', () => {
    writeMem([{ id: '1', title: 'a', content: 'b', domain: 'project' }]);
    fs.writeFileSync(path.join(cwd, '.gitignore'), '.github/ai-os/memory/\n');
    const r = computeBoundaryReport(cwd);
    expect(r.leaks).toEqual([]);
    expect(r.status).toBe('clean');
  });

  it('flags non-project domain entries as leaks', () => {
    writeMem([
      { id: '1', title: 'a', content: 'b', domain: 'project' },
      { id: '2', title: 'leaked', content: 'personal thing', domain: 'personal' },
    ]);
    fs.writeFileSync(path.join(cwd, '.gitignore'), '.github/ai-os/memory/\n');
    const r = computeBoundaryReport(cwd);
    expect(r.leaks.map((l) => l.id)).toContain('2');
    expect(r.status).toBe('leaks-found');
  });

  it('flags a missing gitignore rule for the memory dir', () => {
    writeMem([{ id: '1', title: 'a', content: 'b', domain: 'project' }]);
    fs.writeFileSync(path.join(cwd, '.gitignore'), 'node_modules/\n');
    const r = computeBoundaryReport(cwd);
    expect(r.missingGitignore).toContain('.github/ai-os/memory/');
    expect(r.status).toBe('leaks-found');
  });

  it('treats entries without a domain as project (back-compat, no leak)', () => {
    writeMem([{ id: '1', title: 'a', content: 'b' }]);
    fs.writeFileSync(path.join(cwd, '.gitignore'), '.github/ai-os/memory/\n');
    const r = computeBoundaryReport(cwd);
    expect(r.leaks).toEqual([]);
  });
});
