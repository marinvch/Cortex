import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { META_SKILLS, installMetaSkills } from '../src/skills.mjs';

const repo = () => mkdtempSync(join(tmpdir(), 'cortex-skills-'));

test('installs one SKILL.md per meta-skill', () => {
  const root = repo();
  installMetaSkills(root, [], false);
  for (const name of META_SKILLS) {
    assert.ok(existsSync(join(root, '.claude/skills', name, 'SKILL.md')), `missing ${name}`);
  }
});

test('every meta-skill has valid frontmatter with a matching name', () => {
  const root = repo();
  installMetaSkills(root, [], false);
  for (const name of META_SKILLS) {
    const body = readFileSync(join(root, '.claude/skills', name, 'SKILL.md'), 'utf8');
    assert.match(body, /^---\n/, `${name} must start with frontmatter`);
    assert.match(body, new RegExp(`^name:\\s*${name}$`, 'm'), `${name} frontmatter name must match dir`);
    assert.match(body, /^description:\s*\S/m, `${name} needs a description`);
  }
});

test('each meta-skill tells the agent to register what it creates', () => {
  const root = repo();
  installMetaSkills(root, [], false);
  for (const name of META_SKILLS) {
    const body = readFileSync(join(root, '.claude/skills', name, 'SKILL.md'), 'utf8');
    assert.match(body, /## Project skills/, `${name} must register into the Project skills section`);
  }
});

test('dry run writes nothing but still reports a plan', () => {
  const root = repo();
  const plan = [];
  installMetaSkills(root, plan, true);
  assert.ok(plan.length >= META_SKILLS.length);
  assert.equal(existsSync(join(root, '.claude')), false);
});
