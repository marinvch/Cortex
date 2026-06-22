// engine/src/tests/no-legacy-brand.test.ts
// Guard: fails if any legacy ai-os brand literal returns to engine/src.
// Exemptions:
//   - This guard file itself (excluded from scan).
//   - brand.ts (contains an intentional 'ai-os' developer comment).
//   - Uppercase-hyphen markers (AI-OS:, <!-- AI-OS:... -->) do NOT match our patterns.
//   - External URL marinvch/ai-os (unquoted, does NOT match our quoted-literal patterns).
//   - @ai-os:protect tag — no '[' before 'ai-os' — does not match new patterns.
//   - AI-OS:USER_BLOCK — uppercase, does not match lowercase patterns.
//   - github:marinvch/ai-os — no '[' before — does not match new patterns.
// NOTE: The former 'ai-os --' pattern was removed because github:marinvch/ai-os --<flag>
//   is a legitimate install-URL form and would false-positive on it.
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

  it('shipped shell scripts have no AI_OS_ or .github/ai-os literals', () => {
    // Scans the live installer scripts (outside src/) for legacy brand patterns.
    // Allowed: github:marinvch/ai-os and raw.githubusercontent.com/marinvch/ai-os
    // URLs — those won't match AI_OS_ or .github/ai-os so no exclusion needed.
    const result = spawnSync(
      'git',
      [
        'grep', '-nIE',
        'AI_OS_|\\.github/ai-os',
        '--',
        'install.sh',
        'bootstrap.sh',
        'scripts',
      ],
      { cwd: engineRoot, encoding: 'utf8' },
    );
    const out = (result.stdout ?? '').trim();
    expect(out, `Found legacy brand literals in shell scripts:\n${out}`).toBe('');
  });

});
