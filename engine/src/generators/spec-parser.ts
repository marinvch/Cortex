/**
 * spec-parser.ts — Parses spec markdown files and derives stable spec IDs.
 *
 * Part of the Repository Intelligence Index (RII) Phase 2.
 * No external dependencies — regex over file content only.
 */
import fs from 'node:fs';
import path from 'node:path';

export interface ParsedSpec {
  /** Stable ID, e.g. "REPO-INTEL-3". One per H2/H3 heading. */
  specId: string;
  /** Heading text, e.g. "CLI Command: ai-os index". */
  title: string;
  /** Basename of spec file, e.g. "2026-05-25-repo-intelligence-index-design.md". */
  specFile: string;
  /** Total H2/H3 headings in this file (for context display). */
  requirementCount: number;
}

/**
 * Derives the spec ID prefix from a spec filename.
 * "2026-05-25-repo-intelligence-index-design.md" → "REPO-INTEL"
 */
export function deriveSpecPrefix(filename: string): string {
  const base = path.basename(filename, '.md');
  const slug = base
    .replace(/^\d{4}-\d{2}-\d{2}-/, '')  // strip YYYY-MM-DD-
    .replace(/-design$/, '');             // strip trailing -design
  const words = slug.split('-').filter(Boolean);

  // Single-word slugs: use as-is (no truncation)
  if (words.length === 1) return words[0]!.toUpperCase();

  // Multi-word slugs: abbreviate each of the first two words
  return words.slice(0, 2).map(abbreviateWord).join('-').toUpperCase();
}

/**
 * Truncates a word to a compact abbreviation for use in multi-word spec prefixes.
 * Words with 6 or fewer characters are returned unchanged.
 * Longer words are truncated to 5 chars; trailing vowels are stripped unless
 * the preceding consonant is a soft-sound consonant (c/g before e/i).
 */
function abbreviateWord(word: string): string {
  if (word.length <= 6) return word;
  const truncated = word.slice(0, 5);
  const last = truncated[truncated.length - 1]!;
  if (!'aeiou'.includes(last)) return truncated;
  const prev = truncated[truncated.length - 2]!;
  // Preserve soft-sound consonant pairs (ce, ci, ge, gi) to avoid pronunciation shift
  if ('cg'.includes(prev) && 'ei'.includes(last)) return truncated;
  return truncated.slice(0, -1);
}

/**
 * Parses all .md files in specDir and returns one ParsedSpec per H2/H3 heading per file.
 * Returns [] gracefully when specDir does not exist.
 */
export function parseSpecFiles(specDir: string): ParsedSpec[] {
  if (!fs.existsSync(specDir)) return [];

  let files: string[];
  try {
    files = fs.readdirSync(specDir).filter(f => f.endsWith('.md')).sort();
  } catch {
    return [];
  }

  const results: ParsedSpec[] = [];

  for (const file of files) {
    let content: string;
    try {
      content = fs.readFileSync(path.join(specDir, file), 'utf-8');
    } catch {
      continue;
    }

    const prefix = deriveSpecPrefix(file);
    const headings = extractHeadings(content);

    for (let i = 0; i < headings.length; i++) {
      results.push({
        specId: `${prefix}-${i + 1}`,
        title: headings[i] ?? '',
        specFile: file,
        requirementCount: headings.length,
      });
    }
  }

  return results;
}

/** Extracts H2/H3 heading text, ignoring content inside code fences (``` or ~~~). */
/** Extracts H2/H3 heading text, ignoring content inside code fences (``` or ~~~). */
function extractHeadings(content: string): string[] {
  const lines = content.split('\n');
  const headings: string[] = [];
  let inFence = false;
  let fenceChar = '';
  let fenceLen = 0;

  for (const line of lines) {
    const trimmed = line.trimStart();
    if (!inFence) {
      const fenceOpen = /^(`{3,}|~{3,})/.exec(trimmed);
      if (fenceOpen) {
        inFence = true;
        fenceChar = fenceOpen[1]![0]!;
        fenceLen = fenceOpen[1]!.length;
        continue;
      }
      const m = /^#{2,3}\s+(.+)$/.exec(line);
      if (m) {
        const text = m[1]?.trim();
        if (text) headings.push(text);
      }
    } else {
      const closeRe = new RegExp(`^([${fenceChar}]{${fenceLen},})\\s*$`);
      if (closeRe.test(trimmed)) {
        inFence = false;
        fenceChar = '';
        fenceLen = 0;
      }
    }
  }

  return headings;
}
