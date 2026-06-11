import * as fs from 'node:fs';
import * as path from 'node:path';
import { getPersonalBrainPath, writeTextAtomic } from './shared.js';

export interface Candidate {
  id: string;
  createdAt: string;
  text: string;
  domain: 'personal' | 'project';
  trigger: string;
  needsSanitization: boolean;
}
export interface AppendCandidateArgs {
  text: string;
  domain: 'personal' | 'project';
  trigger: string;
}

function candidatesPath(): string {
  const root = getPersonalBrainPath();
  if (!root) throw new Error('No personal brain path configured (AI_OS_PERSONAL_ROOT).');
  return path.join(root, 'brain', 'candidates.jsonl');
}

/** Append-only. This is the ONLY thing the ambient-capture tool can do — never writes
 *  context/* or brain/memory.jsonl. The /level-up confirmation gate decides storage. */
export function appendCandidate(args: AppendCandidateArgs): Candidate {
  const file = candidatesPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const candidate: Candidate = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    text: args.text.trim(),
    domain: args.domain,
    trigger: args.trigger.trim(),
    needsSanitization: args.domain === 'project',
  };
  const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf-8') : '';
  writeTextAtomic(file, `${existing.replace(/\s*$/, '')}${existing ? '\n' : ''}${JSON.stringify(candidate)}\n`);
  return candidate;
}

export function readCandidates(): Candidate[] {
  const file = candidatesPath();
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf-8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l) as Candidate);
}
