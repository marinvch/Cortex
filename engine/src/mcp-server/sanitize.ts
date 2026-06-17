/** A flagged potential secret. Warn-only — never blocks. */
export interface SecretHit {
  kind: 'aws-access-key' | 'connection-string' | 'env-secret' | 'generic-api-key';
  match: string;
}

const PATTERNS: Array<{ kind: SecretHit['kind']; re: RegExp }> = [
  { kind: 'aws-access-key', re: /\bAKIA[0-9A-Z]{16}\b/g },
  { kind: 'connection-string', re: /\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:[^\s:@/]+@[^\s/]+/gi },
  { kind: 'env-secret', re: /\b[A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|API[_-]?KEY)[A-Z0-9_]*\s*[=:]\s*\S{8,}/g },
  { kind: 'generic-api-key', re: /\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{12,}\b/g },
];

/**
 * Scan text for likely secrets. Returns all hits (deduped by match). Warn-only: callers
 * surface these as warnings; they MUST NOT block the action on their own.
 */
export function detectSecretPatterns(text: string): SecretHit[] {
  const hits: SecretHit[] = [];
  const seen = new Set<string>();
  for (const { kind, re } of PATTERNS) {
    for (const m of text.matchAll(re)) {
      const key = `${kind}:${m[0]}`;
      if (seen.has(key)) continue;
      seen.add(key);
      hits.push({ kind, match: m[0] });
    }
  }
  return hits;
}
