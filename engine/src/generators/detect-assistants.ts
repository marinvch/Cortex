import { existsSync } from 'node:fs';
import { join } from 'node:path';

export type AdapterId = 'copilot' | 'claude' | 'gemini' | 'local' | 'cursor' | 'jetbrains' | 'neovim';

const MARKERS: Array<{ id: AdapterId; paths: string[] }> = [
  { id: 'claude', paths: ['CLAUDE.md', '.claude'] },
  { id: 'cursor', paths: ['.cursor', '.cursorrules'] },
  { id: 'copilot', paths: ['.github/copilot-instructions.md', '.github/copilot'] },
  { id: 'gemini', paths: ['GEMINI.md', '.gemini'] },
  { id: 'jetbrains', paths: ['.idea'] },
];

/** Return the adapter ids whose marker files/dirs exist in `cwd`. */
export function detectAssistants(cwd: string): AdapterId[] {
  const found: AdapterId[] = [];
  for (const m of MARKERS) {
    if (m.paths.some((p) => existsSync(join(cwd, p)))) found.push(m.id);
  }
  return found;
}
