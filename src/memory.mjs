import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { resolveInRepo } from './paths.mjs';
import { scan, collectEnvValues } from './guard.mjs';

/**
 * Every write into `.cortex/memory/` goes through here, and every write through here
 * is scanned first. This is the choke point the spec describes: memory is committed
 * and ungated, so there is no second chance further down the line.
 */

export const GOTCHAS = '.cortex/memory/gotchas.md';
export const DECISIONS = '.cortex/memory/decisions.md';

/** Entries appended per session, so an over-eager agent cannot bury the file. */
export const MAX_ENTRIES_PER_SESSION = 5;

export class SecretBlockedError extends Error {
  constructor(findings) {
    const summary = findings
      .map((f) => `  line ${f.lineNo}: ${f.rule} — ${f.detail}`)
      .join('\n');
    super(`refusing to write: possible secret detected\n${summary}`);
    this.name = 'SecretBlockedError';
    this.code = 'secret_blocked';
    this.findings = findings;
  }
}

const GOTCHAS_HEADER = `# Gotchas — tribal knowledge

Accumulated as work happens and committed, so the team inherits it instead of relearning it.
Every entry passed the secret guard before it was written. Prune freely; this file is for humans too.
`;

const DECISIONS_HEADER = `# Decision log

Append-only. Newest at the bottom. Why a technical call was made, so it is not re-litigated.
`;

export function initMemory(repoRoot) {
  const written = [];
  for (const [rel, header] of [[GOTCHAS, GOTCHAS_HEADER], [DECISIONS, DECISIONS_HEADER]]) {
    const abs = resolveInRepo(repoRoot, rel);
    if (existsSync(abs)) continue;
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, header);
    written.push(rel);
  }
  return written;
}

/** Normalize for dedupe: an entry that only differs in casing or spacing is the same entry. */
const fingerprint = (text) => text.toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * Append one gotcha. Throws SecretBlockedError if the guard objects — the caller is
 * expected to surface that, not swallow it.
 *
 * @returns {{written: boolean, reason?: string}}
 */
export function appendGotcha(repoRoot, text, { date, source = 'manual' } = {}) {
  const entry = String(text).trim();
  if (!entry) return { written: false, reason: 'empty' };

  const findings = scan(entry, { envValues: collectEnvValues(repoRoot) });
  if (!findings.ok) throw new SecretBlockedError(findings.findings);

  const abs = resolveInRepo(repoRoot, GOTCHAS);
  mkdirSync(dirname(abs), { recursive: true });
  if (!existsSync(abs)) writeFileSync(abs, GOTCHAS_HEADER);

  const existing = readFileSync(abs, 'utf8');
  if (fingerprint(existing).includes(fingerprint(entry))) {
    return { written: false, reason: 'duplicate' };
  }

  const stamp = date ?? new Date().toISOString().slice(0, 10);
  appendFileSync(abs, `\n- ${stamp} — ${entry} _(${source})_\n`);
  return { written: true };
}

/**
 * Append a batch, stopping at the session cap. Blocked entries do not abort the batch;
 * they are reported so the human can see what was withheld and why.
 */
export function appendGotchas(repoRoot, entries, opts = {}) {
  const result = { written: [], blocked: [], skipped: [] };
  for (const entry of entries) {
    if (result.written.length >= MAX_ENTRIES_PER_SESSION) {
      result.skipped.push({ entry, reason: 'session cap' });
      continue;
    }
    try {
      const res = appendGotcha(repoRoot, entry, opts);
      if (res.written) result.written.push(entry);
      else result.skipped.push({ entry, reason: res.reason });
    } catch (err) {
      if (err instanceof SecretBlockedError) result.blocked.push({ entry, findings: err.findings });
      else throw err;
    }
  }
  return result;
}
