import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { RECOMMENDED, writePluginManifest } from '../src/plugins.mjs';

const repo = () => mkdtempSync(join(tmpdir(), 'cortex-plugins-'));

test('writes a manifest describing each recommendation', () => {
  const root = repo();
  writePluginManifest(root, [], {});
  const m = JSON.parse(readFileSync(join(root, '.cortex/plugins.json'), 'utf8'));
  assert.equal(m.version, 1);
  assert.ok(Array.isArray(m.recommended));
  for (const entry of m.recommended) {
    assert.ok(entry.name, 'every entry needs a name');
    assert.ok(entry.why, 'every entry needs a reason a human can read');
    assert.equal(typeof entry.network, 'boolean', 'network access must be stated, not implied');
  }
});

test('anything that touches the network is flagged as such', () => {
  const ctx = RECOMMENDED.find((p) => p.name === 'context7');
  assert.ok(ctx, 'context7 should be listed as an option');
  assert.equal(ctx.network, true);
  const sp = RECOMMENDED.find((p) => p.name === 'superpowers');
  assert.equal(sp.network, false);
});

test('does NOT enable plugins without an explicit opt-in', () => {
  const root = repo();
  writePluginManifest(root, [], {});
  const settingsPath = join(root, '.claude/settings.json');
  if (existsSync(settingsPath)) {
    const s = JSON.parse(readFileSync(settingsPath, 'utf8'));
    assert.equal(s.enabledPlugins, undefined, 'must not provision a developer environment silently');
  }
});

test('enables only the non-network defaults with --with-plugins', () => {
  const root = repo();
  writePluginManifest(root, [], { withPlugins: true });
  const s = JSON.parse(readFileSync(join(root, '.claude/settings.json'), 'utf8'));
  assert.ok(s.enabledPlugins, 'expected enabledPlugins');
  const keys = Object.keys(s.enabledPlugins);
  assert.ok(keys.some((k) => k.startsWith('superpowers@')));
  assert.ok(!keys.some((k) => k.startsWith('context7@')), 'network plugins are never auto-enabled');
});

test('merges into an existing settings.json rather than clobbering it', () => {
  const root = repo();
  mkdirSync(join(root, '.claude'), { recursive: true });
  writeFileSync(join(root, '.claude/settings.json'), JSON.stringify({ hooks: { SessionEnd: [] } }));
  writePluginManifest(root, [], { withPlugins: true });
  const s = JSON.parse(readFileSync(join(root, '.claude/settings.json'), 'utf8'));
  assert.ok(s.hooks, 'existing keys survived');
  assert.ok(s.enabledPlugins);
});

test('dry run writes nothing', () => {
  const root = repo();
  writePluginManifest(root, [], { dryRun: true, withPlugins: true });
  assert.equal(existsSync(join(root, '.cortex/plugins.json')), false);
});
