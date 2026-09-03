import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { META_SKILLS, installMetaSkills } from '../src/skills.mjs';

/**
 * The four meta-skills consolidated into one `cortex-capability` with four branches.
 * SPEC R8 — "the repo can extend itself — author its own skills, agents, hooks and MCP
 * servers" — is unchanged; only the packaging is. So these tests assert the four
 * capabilities are still reachable, not that four files exist.
 */

const SKILL = 'cortex-capability';

/** Every temp dir this file creates, removed at exit. */
const TEMP_DIRS = [];

const repo = () => {
  const dir = mkdtempSync(join(tmpdir(), 'cortex-skills-'));
  TEMP_DIRS.push(dir);
  return dir;
};

process.on('exit', () => {
  for (const dir of TEMP_DIRS) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // a leftover temp dir is not worth failing a run over
    }
  }
});

const skillBody = (root) => readFileSync(join(root, '.claude/skills', SKILL, 'SKILL.md'), 'utf8');

test('there is exactly one meta-skill, and it is cortex-capability', () => {
  // Asserted on the list itself rather than only looped over: every test below iterates
  // META_SKILLS, and an empty list would make all of them pass while installing nothing.
  assert.deepEqual(META_SKILLS, [SKILL]);
});

test('installs a single SKILL.md, not four', () => {
  const root = repo();
  installMetaSkills(root, [], false);

  assert.deepEqual(
    readdirSync(join(root, '.claude/skills')).sort(),
    [SKILL],
    'four meta-skills became one; a leftover directory is a second, competing instruction set',
  );
  assert.ok(existsSync(join(root, '.claude/skills', SKILL, 'SKILL.md')));
});

test('the skill has valid frontmatter whose name matches its directory', () => {
  const root = repo();
  installMetaSkills(root, [], false);
  const body = skillBody(root);

  assert.match(body, /^---\n/, 'must start with frontmatter');
  assert.match(body, new RegExp(`^name:\\s*${SKILL}$`, 'm'), 'frontmatter name must match the directory');
  assert.match(body, /^description:\s*\S/m, 'needs a description — it is all a model sees when deciding to invoke');

  // The block has to close, or every tool reading it sees the whole file as frontmatter.
  const closing = body.indexOf('\n---', 3);
  assert.ok(closing > -1, 'the frontmatter block must be closed');
});

test('all four capability branches survive the consolidation', () => {
  const root = repo();
  installMetaSkills(root, [], false);
  const body = skillBody(root);

  // R8 names all four, and SPEC keeps MCP deliberately — scaffolding a server for the HOST
  // repo is in scope even though Cortex never ships as one. Losing a branch here is losing
  // a capability, which is why each is asserted by name rather than by counting sections.
  for (const [capability, pattern] of [
    ['skill', /\bskill\b/i],
    ['subagent', /\b(subagent|agent)\b/i],
    ['hook', /\bhook\b/i],
    ['MCP server', /\bMCP\b/],
  ]) {
    assert.match(body, pattern, `the ${capability} branch is missing from ${SKILL}`);
  }

  // Not just mentioned in passing: each branch must tell the agent where the artefact goes.
  for (const path of ['.claude/skills/', '.claude/agents/', '.claude/hooks/', '.mcp.json']) {
    assert.ok(body.includes(path), `no branch tells the agent to write ${path}`);
  }
});

test('the skill tells the agent to register what it creates', () => {
  const root = repo();
  installMetaSkills(root, [], false);
  assert.match(
    skillBody(root),
    /## Project skills/,
    'a capability nobody records is a capability the next agent re-creates',
  );
});

test('dry run writes nothing but still reports a plan', () => {
  const root = repo();
  const plan = [];
  installMetaSkills(root, plan, true);

  assert.deepEqual(
    plan.map((s) => s.rel),
    [`.claude/skills/${SKILL}/SKILL.md`],
    'the plan must name the file it would write',
  );
  assert.equal(existsSync(join(root, '.claude')), false);
});
