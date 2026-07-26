import { test } from 'node:test';
import assert from 'node:assert/strict';

import { renderAgentsMd, refreshAgentsMd, renderGeneratedBlock, GEN_START, GEN_END } from '../src/render.mjs';

const FACTS = {
  name: 'acme',
  purpose: 'Storefront',
  languages: ['TypeScript'],
  packageManager: 'pnpm',
  framework: 'Next.js',
  testRunner: 'Vitest',
  scripts: { install: 'pnpm install', dev: 'pnpm run dev', build: null, test: null, lint: null },
  directories: ['src'],
  linters: ['ESLint'],
  ci: 'GitHub Actions',
  tsStrict: true,
};

test('the generated block advertises the built-in meta-skills and the map', () => {
  const block = renderGeneratedBlock(FACTS);
  for (const name of ['cortex-skill', 'cortex-agent', 'cortex-hook', 'cortex-mcp']) {
    assert.match(block, new RegExp(name), `expected the block to mention ${name}`);
  }
  assert.match(block, /\.cortex\/map\.md/);
});

test('project skills register OUTSIDE the markers so refresh cannot destroy them', () => {
  const doc = renderAgentsMd(FACTS);
  const projectIdx = doc.indexOf('## Project skills');
  const endIdx = doc.indexOf(GEN_END);
  assert.ok(projectIdx > -1, 'expected a Project skills section');
  assert.ok(projectIdx > endIdx, 'Project skills must come after the generated block ends');
});

test('refresh preserves a team-created project skill', () => {
  const doc = renderAgentsMd(FACTS).replace(
    '## Project skills',
    '## Project skills\n\n- `/deploy-preview` — created 2026-07-26',
  );
  const { content, refreshed } = refreshAgentsMd(doc, { ...FACTS, testRunner: 'Jest' });
  assert.equal(refreshed, true);
  assert.match(content, /\/deploy-preview/);
  assert.match(content, /\*\*Tests:\*\* Jest/);
});
