import { describe, it, expect } from 'vitest';
import { detectSecretPatterns } from '../mcp-server/sanitize.js';

describe('detectSecretPatterns', () => {
  it('flags AWS access keys', () => {
    const hits = detectSecretPatterns('key is AKIAIOSFODNN7EXAMPLE here');
    expect(hits.some(h => h.kind === 'aws-access-key')).toBe(true);
  });

  it('flags connection strings with credentials', () => {
    const hits = detectSecretPatterns('postgres://user:p4ss@db.example.com:5432/app');
    expect(hits.some(h => h.kind === 'connection-string')).toBe(true);
  });

  it('flags .env-style secret assignments', () => {
    const hits = detectSecretPatterns('API_SECRET=sk_live_abc123def456ghi789');
    expect(hits.some(h => h.kind === 'env-secret')).toBe(true);
  });

  it('returns no hits for clean text', () => {
    expect(detectSecretPatterns('The project uses pnpm and Vitest.')).toEqual([]);
  });
});
