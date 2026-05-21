import { describe, it, expect } from 'vitest';
import { buildGenerationSummary, formatGenerationSummary, type GenerationSummary } from '../actions/summary.js';

describe('buildGenerationSummary', () => {
  it('computes total files correctly', () => {
    const s = buildGenerationSummary({
      written: ['a.md', 'b.md'],
      skipped: ['c.md'],
      pruned: ['old.md'],
      preserved: [],
      durationMs: 1200,
    });
    expect(s.totalFiles).toBe(3); // written + skipped (managed files; not pruned)
    expect(s.writtenCount).toBe(2);
    expect(s.skippedCount).toBe(1);
    expect(s.prunedCount).toBe(1);
  });

  it('records duration in ms', () => {
    const s = buildGenerationSummary({
      written: [],
      skipped: [],
      pruned: [],
      preserved: [],
      durationMs: 4500,
    });
    expect(s.durationMs).toBe(4500);
  });

  it('formats duration as seconds in output', () => {
    const s: GenerationSummary = {
      writtenCount: 1,
      skippedCount: 0,
      prunedCount: 0,
      preservedCount: 0,
      totalFiles: 1,
      durationMs: 2500,
    };
    const out = formatGenerationSummary(s);
    expect(out).toContain('2.5s');
  });

  it('formatGenerationSummary shows written count', () => {
    const s = buildGenerationSummary({
      written: ['a.md', 'b.md', 'c.md'],
      skipped: [],
      pruned: [],
      preserved: [],
      durationMs: 100,
    });
    const out = formatGenerationSummary(s);
    expect(out).toContain('3');
  });

  it('formatGenerationSummary omits pruned line when count is zero', () => {
    const s = buildGenerationSummary({
      written: ['a.md'],
      skipped: [],
      pruned: [],
      preserved: [],
      durationMs: 100,
    });
    const out = formatGenerationSummary(s);
    expect(out).not.toContain('Pruned');
  });

  it('preserved count is included in output when non-zero', () => {
    const s = buildGenerationSummary({
      written: [],
      skipped: ['a.md'],
      pruned: [],
      preserved: ['protected.md'],
      durationMs: 100,
    });
    const out = formatGenerationSummary(s);
    expect(out).toContain('Preserved');
  });
});
