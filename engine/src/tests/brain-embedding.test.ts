import { describe, it, expect } from 'vitest';
import {
  HashingEmbeddingProvider,
  OllamaEmbeddingProvider,
  resolveEmbeddingProvider,
  availableEmbeddingProviders,
} from '../brainstore/embedding.js';
import { cosineSimilarity } from '../brainstore/sqlite-store.js';

describe('HashingEmbeddingProvider', () => {
  it('produces fixed-dimension, unit-normalized vectors', async () => {
    const p = new HashingEmbeddingProvider({ dimensions: 64 });
    const [v] = await p.embed(['hello world build pipeline']);
    expect(v.length).toBe(64);
    const norm = Math.sqrt(Array.from(v).reduce((s, x) => s + x * x, 0));
    expect(norm).toBeCloseTo(1, 5);
  });

  it('is deterministic', async () => {
    const p = new HashingEmbeddingProvider();
    const [a] = await p.embed(['the quick brown fox']);
    const [b] = await p.embed(['the quick brown fox']);
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it('scores overlapping text more similar than disjoint text', async () => {
    const p = new HashingEmbeddingProvider({ dimensions: 512 });
    const [base, near, far] = await p.embed([
      'sqlite index for the brain store',
      'the brain store sqlite index rebuild',
      'completely unrelated cooking recipe banana',
    ]);
    const simNear = cosineSimilarity(base, near);
    const simFar = cosineSimilarity(base, far);
    expect(simNear).toBeGreaterThan(simFar);
  });

  it('embeds a batch preserving order and count', async () => {
    const p = new HashingEmbeddingProvider();
    const vecs = await p.embed(['a', 'b', 'c']);
    expect(vecs).toHaveLength(3);
  });

  it('handles empty / symbol-only text without NaNs', async () => {
    const p = new HashingEmbeddingProvider({ dimensions: 16 });
    const [v] = await p.embed(['']);
    expect(v.length).toBe(16);
    expect(Array.from(v).every((x) => Number.isFinite(x))).toBe(true);
  });
});

describe('embedding provider registry', () => {
  it('defaults to the zero-dependency hashing provider', () => {
    const p = resolveEmbeddingProvider();
    expect(p.id).toBe('hashing');
  });

  it('falls back to hashing for an unknown provider id', () => {
    const p = resolveEmbeddingProvider({ provider: 'does-not-exist' });
    expect(p.id).toBe('hashing');
  });

  it('resolves the ollama provider when requested', () => {
    const p = resolveEmbeddingProvider({ provider: 'ollama', ollama: { model: 'nomic-embed-text' } });
    expect(p.id).toBe('ollama:nomic-embed-text');
    expect(p).toBeInstanceOf(OllamaEmbeddingProvider);
  });

  it('lists available providers', () => {
    expect(availableEmbeddingProviders()).toEqual(expect.arrayContaining(['hashing', 'ollama']));
  });

  it('respects a custom dimension', () => {
    const p = resolveEmbeddingProvider({ provider: 'hashing', dimensions: 128 });
    expect(p.dimensions).toBe(128);
  });
});

describe('OllamaEmbeddingProvider (offline behavior)', () => {
  it('throws an actionable error when Ollama is unreachable', async () => {
    // Use a port nothing listens on; expect a clear, non-crashing rejection.
    const p = new OllamaEmbeddingProvider({ baseUrl: 'http://127.0.0.1:1', timeoutMs: 500 });
    await expect(p.embed(['hi'])).rejects.toThrow(/Ollama/);
  });
});
