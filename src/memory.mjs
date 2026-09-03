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
export const GITATTRIBUTES = '.gitattributes';

/** The one line that makes parallel branches merge instead of conflict (D3). */
export const MEMORY_MERGE_ATTRIBUTE = '.cortex/memory/*.md merge=union';

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

**One entry per line.** \`.gitattributes\` marks this file \`merge=union\`, so two branches that each
recorded a gotcha merge into both lines instead of conflicting. That only holds while every entry
stays on a single line — an entry that wraps will interleave with someone else's on a merge.

`;

const GITATTRIBUTES_BLOCK = `# Cortex memory is append-only and every entry is exactly one line, so a union merge of two
# branches keeps both entries instead of raising a conflict at the tail of the file on every
# parallel branch. Unlike a custom merge driver — which lives in .git/config and does not survive
# a clone — this travels with the repo and needs no per-developer setup.
${MEMORY_MERGE_ATTRIBUTE}
`;

/**
 * Create or extend the target repo's `.gitattributes` so memory merges by union.
 *
 * Never clobbers: an existing file is appended to, and a file that already carries the
 * attribute is left exactly as it is.
 */
export function ensureMemoryMergeAttribute(repoRoot) {
  const abs = resolveInRepo(repoRoot, GITATTRIBUTES);
  if (!existsSync(abs)) {
    writeFileSync(abs, GITATTRIBUTES_BLOCK);
    return { rel: GITATTRIBUTES, note: 'created — merge=union for .cortex/memory' };
  }

  const existing = readFileSync(abs, 'utf8');
  if (existing.includes(MEMORY_MERGE_ATTRIBUTE)) return null;

  // A file whose last line lacks a newline would otherwise swallow our first comment line.
  const lead = existing === '' || existing.endsWith('\n') ? '' : '\n';
  appendFileSync(abs, `${lead}\n${GITATTRIBUTES_BLOCK}`);
  return { rel: GITATTRIBUTES, note: 'appended merge=union for .cortex/memory' };
}

/**
 * Seed the memory files and the merge attribute they depend on.
 *
 * @returns {{rel: string, note: string}[]} what was actually touched, for the install plan.
 */
export function initMemory(repoRoot) {
  const touched = [];
  const abs = resolveInRepo(repoRoot, GOTCHAS);
  if (!existsSync(abs)) {
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, GOTCHAS_HEADER);
    touched.push({ rel: GOTCHAS, note: 'created' });
  }
  const attr = ensureMemoryMergeAttribute(repoRoot);
  if (attr) touched.push(attr);
  return touched;
}

/** Normalize for dedupe: an entry that only differs in casing or spacing is the same entry. */
const fingerprint = (text) => text.toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * What every entry in one batch shares: the repo's `.env` values, and gotchas.md with its
 * dedupe fingerprint. A batch whose candidates all dedupe never reaches the session cap, so
 * reading these per candidate meant re-reading and re-normalizing the whole memory file once
 * per candidate — the case that arises on exactly the repos that have accumulated gotchas.
 * Filled on first use; the fingerprint is recomputed only when an entry is actually appended.
 */
const newBatch = () => ({ envValues: null, existing: null, mark: null });

function appendOne(repoRoot, text, { date, source = 'manual' }, batch) {
  // Collapse to one line before anything else. Union merge is line-based, so a multi-line
  // entry would interleave with a teammate's on the next merge (D3).
  const entry = String(text).replace(/\s+/g, ' ').trim();
  if (!entry) return { written: false, reason: 'empty' };

  batch.envValues ??= collectEnvValues(repoRoot);
  const findings = scan(entry, { envValues: batch.envValues });
  if (!findings.ok) throw new SecretBlockedError(findings.findings);

  const abs = resolveInRepo(repoRoot, GOTCHAS);
  mkdirSync(dirname(abs), { recursive: true });
  if (!existsSync(abs)) {
    writeFileSync(abs, GOTCHAS_HEADER);
    batch.existing = null; // whatever we cached described a file that is no longer there
  }

  if (batch.existing === null) {
    batch.existing = readFileSync(abs, 'utf8');
    batch.mark = fingerprint(batch.existing);
  }
  if (batch.mark.includes(fingerprint(entry))) {
    return { written: false, reason: 'duplicate' };
  }

  const stamp = date ?? new Date().toISOString().slice(0, 10);
  // No blank line between entries, or union merge would keep two copies of it. If a human
  // left the file without a trailing newline, add one first rather than joining two entries.
  const lead = batch.existing === '' || batch.existing.endsWith('\n') ? '' : '\n';
  const line = `${lead}- ${stamp} — ${entry} _(${source})_\n`;
  appendFileSync(abs, line);
  batch.existing += line;
  batch.mark = fingerprint(batch.existing);
  return { written: true };
}

/**
 * Append one gotcha. Throws SecretBlockedError if the guard objects — the caller is
 * expected to surface that, not swallow it.
 *
 * @returns {{written: boolean, reason?: string}}
 */
export function appendGotcha(repoRoot, text, opts = {}) {
  return appendOne(repoRoot, text, opts, newBatch());
}

/**
 * Append a batch, stopping at the session cap. Blocked entries do not abort the batch;
 * they are reported so the human can see what was withheld and why.
 */
export function appendGotchas(repoRoot, entries, opts = {}) {
  const result = { written: [], blocked: [], skipped: [] };
  const batch = newBatch();
  for (const entry of entries) {
    if (result.written.length >= MAX_ENTRIES_PER_SESSION) {
      result.skipped.push({ entry, reason: 'session cap' });
      continue;
    }
    try {
      const res = appendOne(repoRoot, entry, opts, batch);
      if (res.written) result.written.push(entry);
      else result.skipped.push({ entry, reason: res.reason });
    } catch (err) {
      if (err instanceof SecretBlockedError) result.blocked.push({ entry, findings: err.findings });
      else throw err;
    }
  }
  return result;
}
