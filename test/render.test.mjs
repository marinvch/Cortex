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

test('the generated block advertises the capability skill and the map', () => {
  const block = renderGeneratedBlock(FACTS);
  assert.match(block, /cortex-capability/, 'the block must tell an agent how to extend the repo');
  assert.match(block, /\.cortex\/map\.md/);

  // The four meta-skills consolidated. A block still advertising them sends agents to
  // slash commands that no longer exist.
  for (const gone of ['cortex-skill', 'cortex-agent', 'cortex-hook', 'cortex-mcp']) {
    assert.doesNotMatch(block, new RegExp(`${gone}\\b`), `the block still advertises the removed /${gone}`);
  }
});

test('the generated block advertises no plugin manifest', () => {
  assert.doesNotMatch(renderGeneratedBlock(FACTS), /plugins\.json|--with-plugins/);
});

test('project skills register OUTSIDE the markers so refresh cannot destroy them', () => {
  const doc = renderAgentsMd(FACTS);
  const startIdx = doc.indexOf(GEN_START);
  const endIdx = doc.indexOf(GEN_END);
  const projectIdx = doc.indexOf('## Project skills');

  // Both markers asserted present first. Without this, a document that emitted no GEN_END
  // gives endIdx === -1 and `projectIdx > endIdx` passes trivially — the ordering check
  // would report green on a file with no generated block to be outside of.
  assert.ok(startIdx > -1, 'expected the generated block to open');
  assert.ok(endIdx > startIdx, 'expected the generated block to close after it opens');
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
