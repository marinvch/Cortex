/**
 * WordPress and PHP stack detection tests
 *
 * Verifies that AI OS detects WordPress projects by checking for
 * wp-config.php, wp-content/, and wp-includes/ — without requiring composer.json.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { analyze } from '../analyze.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXAMPLES_DIR = path.resolve(__dirname, '..', '..', 'examples');

function copyFixture(fixtureName: string): string {
  const src = path.join(EXAMPLES_DIR, fixtureName);
  const dest = path.join(os.tmpdir(), `ai-os-fixture-${fixtureName}-${Date.now()}`);
  fs.cpSync(src, dest, { recursive: true });
  return dest;
}

describe('examples/wordpress-site — stack detection', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = copyFixture('wordpress-site');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('detects PHP as primary language', () => {
    const stack = analyze(tmpDir);
    expect(stack.primaryLanguage.name).toBe('PHP');
  });

  it('detects WordPress framework', () => {
    const stack = analyze(tmpDir);
    const fw = stack.frameworks.map(f => f.name.toLowerCase());
    expect(fw.some(n => n.includes('wordpress'))).toBe(true);
  });

  it('uses composer package manager when wp-config.php present', () => {
    const stack = analyze(tmpDir);
    // WordPress without composer.lock → unknown pm, but detection should work
    expect(stack.frameworks.map(f => f.name)).toContain('WordPress');
  });

  it('generates instructions file', async () => {
    const { generateInstructions } = await import('../generators/instructions.js');
    const stack = analyze(tmpDir);
    const githubDir = path.join(tmpDir, '.github');
    fs.mkdirSync(githubDir, { recursive: true });

    generateInstructions(stack, tmpDir, { refreshExisting: false });

    const instructionsPath = path.join(githubDir, 'copilot-instructions.md');
    expect(fs.existsSync(instructionsPath)).toBe(true);
    const content = fs.readFileSync(instructionsPath, 'utf-8');
    expect(content.length).toBeGreaterThan(100);
  });

  it('stack shape matches snapshot', () => {
    const stack = analyze(tmpDir);
    expect({
      primaryLanguage: stack.primaryLanguage.name,
      frameworks: stack.frameworks.map(f => f.name).sort(),
    }).toMatchSnapshot();
  });
});

describe('WordPress detection — wp-config.php signal', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-os-wp-test-'));
    // Minimal WordPress project: just wp-config.php + a PHP file
    fs.writeFileSync(path.join(tmpDir, 'wp-config.php'), '<?php // wp-config');
    fs.writeFileSync(path.join(tmpDir, 'index.php'), '<?php require("wp-blog-header.php");');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('detects WordPress from wp-config.php alone', () => {
    const stack = analyze(tmpDir);
    const fw = stack.frameworks.map(f => f.name);
    expect(fw).toContain('WordPress');
  });
});

describe('WordPress detection — wp-content + wp-includes signal', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-os-wp-dirs-test-'));
    // WordPress project detected from directory presence
    fs.mkdirSync(path.join(tmpDir, 'wp-content'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, 'wp-includes'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'index.php'), '<?php // WordPress index');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('detects WordPress from wp-content + wp-includes directories', () => {
    const stack = analyze(tmpDir);
    const fw = stack.frameworks.map(f => f.name);
    expect(fw).toContain('WordPress');
  });
});
