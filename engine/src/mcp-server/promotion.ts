import fs from 'node:fs';
import path from 'node:path';
import { getPersonalBrainPath, writeTextAtomic } from './shared.js';
import { detectSecretPatterns } from './sanitize.js';

export interface PromoteArgs {
  title: string;
  content: string;
  sanitized_confirmed: boolean;
  category?: string;
  tags?: string;
}

/**
 * Promote a fact into the personal brain. The ONLY sanctioned project -> personal path.
 * - Refuses unless sanitized_confirmed === true.
 * - Refuses when no personal brain path is configured (AI_OS_PERSONAL_ROOT).
 * - Runs a warn-only secret scan (never blocks).
 * - Appends to brain/memory.jsonl (domain: 'personal') and writes an audit line to memory-log.md.
 */
export function promoteToBrain(args: PromoteArgs): string {
  const title = (args.title ?? '').trim();
  const content = (args.content ?? '').trim();
  if (!title || !content) return 'Both title and content are required to promote a fact.';
  if (args.sanitized_confirmed !== true) {
    return 'Refused: promotion requires sanitized_confirmed=true. Review the fact for company/client data first.';
  }

  const root = getPersonalBrainPath();
  if (!root) {
    return 'Refused: no personal brain path configured. Set AI_OS_PERSONAL_ROOT or personalBrainPath in config.';
  }

  const brainDir = path.join(root, 'brain');
  fs.mkdirSync(brainDir, { recursive: true });
  const jsonlPath = path.join(brainDir, 'memory.jsonl');
  const logPath = path.join(brainDir, 'memory-log.md');

  const now = new Date().toISOString();

  const secrets = detectSecretPatterns(`${title} ${content}`);
  const warning = secrets.length
    ? ` ⚠️  Warning: possible secret(s) detected (${secrets.map((s) => s.kind).join(', ')}) — review brain/memory.jsonl.`
    : '';

  // fingerprint and updatedAt are intentionally omitted — memory.ts canonicalizeEntry
  // recomputes fingerprint on read, and a missing updatedAt marks the entry "fresh".
  const entry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: now,
    title,
    content,
    category: (args.category ?? 'promoted').trim() || 'promoted',
    tags: (args.tags ?? '').split(',').map((t) => t.trim()).filter(Boolean),
    status: 'active' as const,
    domain: 'personal' as const,
  };

  const existing = fs.existsSync(jsonlPath) ? fs.readFileSync(jsonlPath, 'utf-8') : '';
  const next = `${existing.replace(/\s*$/, '')}${existing ? '\n' : ''}${JSON.stringify(entry)}\n`;
  writeTextAtomic(jsonlPath, next);

  const auditHeader = fs.existsSync(logPath) ? '' : '# Personal Brain — Promotion Audit Log\n\n';
  const auditLine = `- ${now} — promoted "${title}" (category: ${entry.category})\n`;
  const log = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf-8') : '';
  writeTextAtomic(logPath, `${auditHeader}${log}${auditLine}`);

  return `Promoted "${title}" to personal brain.${warning}`;
}
