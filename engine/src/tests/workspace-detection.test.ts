import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { analyze } from '../analyze.js';

function mkTmp(): string {
  return mkdtempSync(join(tmpdir(), 'workspace-test-'));
}

function rmTmp(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

function writePkg(dir: string, name: string, deps: Record<string, string> = {}): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, dependencies: deps }));
}

describe('workspace detection — pnpm', () => {
  let tmp: string;
  beforeEach(() => { tmp = mkTmp(); });
  afterEach(() => { rmTmp(tmp); });

  it('detects pnpm workspace packages', () => {
    writePkg(tmp, 'root');
    writeFileSync(join(tmp, 'pnpm-workspace.yaml'), 'packages:\n  - "apps/*"\n  - "packages/*"\n');
    writePkg(join(tmp, 'apps', 'web'), '@my/web', { react: '^18' });
    writePkg(join(tmp, 'apps', 'api'), '@my/api', { express: '^4' });

    const stack = analyze(tmp);
    expect(stack.patterns.monorepo).toBe(true);
    expect(stack.packageProfiles).toBeDefined();
    const paths = stack.packageProfiles!.map(p => p.path);
    expect(paths).toContain('apps/web');
    expect(paths).toContain('apps/api');
  });
});

describe('workspace detection — npm workspaces field', () => {
  let tmp: string;
  beforeEach(() => { tmp = mkTmp(); });
  afterEach(() => { rmTmp(tmp); });

  it('detects npm workspaces from package.json workspaces field', () => {
    mkdirSync(tmp, { recursive: true });
    writeFileSync(join(tmp, 'package.json'), JSON.stringify({
      name: 'root',
      workspaces: ['packages/*'],
    }));
    writePkg(join(tmp, 'packages', 'core'), '@my/core');
    writePkg(join(tmp, 'packages', 'utils'), '@my/utils');

    const stack = analyze(tmp);
    expect(stack.patterns.monorepo).toBe(true);
    const paths = stack.packageProfiles!.map(p => p.path);
    expect(paths).toContain('packages/core');
    expect(paths).toContain('packages/utils');
  });
});

describe('workspace detection — Turborepo', () => {
  let tmp: string;
  beforeEach(() => { tmp = mkTmp(); });
  afterEach(() => { rmTmp(tmp); });

  it('detects Turborepo workspaces via turbo.json', () => {
    writePkg(tmp, 'root');
    writeFileSync(join(tmp, 'turbo.json'), JSON.stringify({ pipeline: {} }));
    writePkg(join(tmp, 'apps', 'web'), '@my/web');
    writePkg(join(tmp, 'packages', 'ui'), '@my/ui');

    const stack = analyze(tmp);
    expect(stack.patterns.monorepo).toBe(true);
    const paths = stack.packageProfiles!.map(p => p.path);
    expect(paths).toContain('apps/web');
    expect(paths).toContain('packages/ui');
  });
});

describe('workspace detection — Nx', () => {
  let tmp: string;
  beforeEach(() => { tmp = mkTmp(); });
  afterEach(() => { rmTmp(tmp); });

  it('detects Nx workspace via nx.json', () => {
    writePkg(tmp, 'root');
    writeFileSync(join(tmp, 'nx.json'), JSON.stringify({ version: 2 }));
    writePkg(join(tmp, 'apps', 'frontend'), '@my/frontend');
    writePkg(join(tmp, 'libs', 'shared'), '@my/shared');

    const stack = analyze(tmp);
    expect(stack.patterns.monorepo).toBe(true);
    const paths = stack.packageProfiles!.map(p => p.path);
    expect(paths).toContain('apps/frontend');
    expect(paths).toContain('libs/shared');
  });
});

describe('single-package project', () => {
  let tmp: string;
  beforeEach(() => { tmp = mkTmp(); });
  afterEach(() => { rmTmp(tmp); });

  it('does not set monorepo for a plain project', () => {
    writePkg(tmp, 'my-app', { express: '^4' });

    const stack = analyze(tmp);
    expect(stack.patterns.monorepo).toBe(false);
    expect(stack.packageProfiles).toHaveLength(1);
  });
});
