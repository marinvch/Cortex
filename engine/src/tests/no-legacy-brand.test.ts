// engine/src/tests/no-legacy-brand.test.ts
// Guard: fails if any legacy ai-os brand literal returns to engine/src.
// Exemptions:
//   - This guard file itself (excluded from scan).
//   - brand.ts (contains an intentional 'ai-os' developer comment).
//   - Uppercase-hyphen markers (AI-OS:, <!-- AI-OS:... -->) do NOT match our patterns.
//   - External URL marinvch/ai-os (unquoted, does NOT match our quoted-literal patterns).
//   - @ai-os:protect tag — no '[' before 'ai-os', no ' --' after — does not match new patterns.
//   - AI-OS:USER_BLOCK — uppercase, does not match lowercase patterns.
//   - github:marinvch/ai-os — no '[' before, no ' --' after — does not match new patterns.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// engine root = two levels up from src/tests/
const engineRoot = path.resolve(__dirname, '..', '..');

describe('no legacy ai-os brand literals remain in src', () => {
  it('has no AI_OS_ / .github/ai-os / ai-os-brand literals', () => {
    // git grep over src/, excluding:
    //   - this guard file (would self-match on the pattern strings)
    //   - brand.ts (contains an intentional 'ai-os' in a developer comment)
    const result = spawnSync(
      'git',
      [
        'grep', '-nIE',
        'AI_OS_|\\.github/ai-os|\'ai-os\'|"ai-os"',
        '--',
        'src',
        ':!src/tests/no-legacy-brand.test.ts',
        ':!src/brand.ts',
      ],
      { cwd: engineRoot, encoding: 'utf8' },
    );
    // git grep exits 0 if matches found, 1 if no matches, >1 on error.
    // We want no matches (exit 1 from git grep = success for us).
    const out = (result.stdout ?? '').trim();
    expect(out, `Found legacy brand literals:\n${out}`).toBe('');
  });

  it('has no [ai-os log-prefix style literals', () => {
    // Catches patterns like [ai-os:mcp] in console.error/log calls.
    // Does NOT match: @ai-os:protect (no '['), AI-OS:USER_BLOCK (uppercase),
    // github:marinvch/ai-os (no '[' before).
    const result = spawnSync(
      'git',
      [
        'grep', '-nIE',
        '\\[ai-os',
        '--',
        'src',
        ':!src/tests/no-legacy-brand.test.ts',
        ':!src/brand.ts',
      ],
      { cwd: engineRoot, encoding: 'utf8' },
    );
    const out = (result.stdout ?? '').trim();
    expect(out, `Found legacy [ai-os log-prefix literals:\n${out}`).toBe('');
  });

  it('has no ai-os -- CLI-command-in-text style literals', () => {
    // Catches patterns like `ai-os --index` in description strings.
    // Does NOT match: @ai-os:protect (no ' --'), AI-OS:USER_BLOCK (uppercase),
    // github:marinvch/ai-os (no ' --' after).
    const result = spawnSync(
      'git',
      [
        'grep', '-nIE',
        'ai-os --',
        '--',
        'src',
        ':!src/tests/no-legacy-brand.test.ts',
        ':!src/brand.ts',
      ],
      { cwd: engineRoot, encoding: 'utf8' },
    );
    const out = (result.stdout ?? '').trim();
    expect(out, `Found legacy ai-os -- CLI-command-in-text literals:\n${out}`).toBe('');
  });
});
