import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

let brain: string;
beforeEach(() => {
  brain = fs.mkdtempSync(path.join(os.tmpdir(), 'aios-brain-'));
  process.env['CORTEX_PERSONAL_ROOT'] = brain;
});
afterEach(() => {
  delete process.env['CORTEX_PERSONAL_ROOT'];
  fs.rmSync(brain, { recursive: true, force: true });
});

describe('promoteToBrain', () => {
  it('refuses unless sanitized_confirmed is true', async () => {
    const { promoteToBrain } = await import('../mcp-server/promotion.js');
    const out = promoteToBrain({ title: 'X', content: 'Y', sanitized_confirmed: false });
    expect(out).toMatch(/sanitiz/i);
    expect(fs.existsSync(path.join(brain, 'brain', 'memory.jsonl'))).toBe(false);
  });

  it('appends to brain/memory.jsonl and writes an audit log when confirmed', async () => {
    const { promoteToBrain } = await import('../mcp-server/promotion.js');
    const out = promoteToBrain({ title: 'Prefers tabs', content: 'User prefers tabs.', sanitized_confirmed: true });
    expect(out).toMatch(/promoted/i);
    const jsonl = fs.readFileSync(path.join(brain, 'brain', 'memory.jsonl'), 'utf-8').trim();
    const entry = JSON.parse(jsonl.split('\n').pop()!);
    expect(entry.domain).toBe('personal');
    expect(entry.title).toBe('Prefers tabs');
    const log = fs.readFileSync(path.join(brain, 'brain', 'memory-log.md'), 'utf-8');
    expect(log).toMatch(/Prefers tabs/);
  });

  it('refuses when no personal brain path is configured', async () => {
    delete process.env['CORTEX_PERSONAL_ROOT'];
    const { promoteToBrain } = await import('../mcp-server/promotion.js');
    const out = promoteToBrain({ title: 'X', content: 'Y', sanitized_confirmed: true });
    expect(out).toMatch(/no personal brain/i);
  });

  it('includes a secret warning in the result but still promotes (warn-only)', async () => {
    const { promoteToBrain } = await import('../mcp-server/promotion.js');
    const out = promoteToBrain({ title: 'Key', content: 'AKIAIOSFODNN7EXAMPLE', sanitized_confirmed: true });
    expect(out).toMatch(/warning/i);
    expect(out).toMatch(/promoted/i);
  });

  it('appends a second entry as a new line without corrupting the first', async () => {
    const { promoteToBrain } = await import('../mcp-server/promotion.js');
    promoteToBrain({ title: 'First', content: 'First fact.', sanitized_confirmed: true });
    promoteToBrain({ title: 'Second', content: 'Second fact.', sanitized_confirmed: true });
    const lines = fs.readFileSync(path.join(brain, 'brain', 'memory.jsonl'), 'utf-8')
      .split('\n').filter(Boolean);
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).title).toBe('First');
    expect(JSON.parse(lines[1]).title).toBe('Second');
  });

  it('promotes using config.personalBrainPath when env var is unset', async () => {
    delete process.env['CORTEX_PERSONAL_ROOT'];
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aios-cfgbrain-'));
    process.env['CORTEX_ROOT'] = root;
    fs.mkdirSync(path.join(root, '.github', 'ai-os'), { recursive: true });
    const cfgBrain = path.join(root, 'mybrain');
    fs.writeFileSync(
      path.join(root, '.github', 'ai-os', 'config.json'),
      JSON.stringify({ personalBrainPath: cfgBrain }),
    );
    vi.resetModules();
    const { promoteToBrain } = await import('../mcp-server/promotion.js');
    const out = promoteToBrain({ title: 'X', content: 'Y', sanitized_confirmed: true });
    expect(out).toMatch(/promoted/i);
    expect(fs.existsSync(path.join(cfgBrain, 'brain', 'memory.jsonl'))).toBe(true);
    delete process.env['CORTEX_ROOT'];
    fs.rmSync(root, { recursive: true, force: true });
  });
});
