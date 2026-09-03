import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { META_SKILLS, SUPERSEDED_SKILLS, installMetaSkills } from '../src/skills.mjs';

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

// ── migrating a repo that installed before the consolidation ────────────────
// Every existing consumer carries the four old SKILL.md files. Left in place they sit in
// the same namespace as cortex-capability describing a shape Cortex no longer ships, and
// an agent reads whichever it matches first.

/** Plant the four pre-consolidation meta-skills, each with distinguishable content. */
function withSupersededSkills(root) {
  for (const name of SUPERSEDED_SKILLS) {
    const dir = join(root, '.claude/skills', name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'SKILL.md'), `---\nname: ${name}\n---\n\n# /${name}\n\nthe old ${name} body\n`);
  }
}

test('the four superseded meta-skills stop competing after a re-run', () => {
  const root = repo();
  withSupersededSkills(root);

  installMetaSkills(root, [], false);

  assert.ok(existsSync(join(root, '.claude/skills', SKILL, 'SKILL.md')), 'the new skill must be installed');
  for (const name of SUPERSEDED_SKILLS) {
    assert.equal(
      existsSync(join(root, '.claude/skills', name, 'SKILL.md')),
      false,
      `${name}/SKILL.md still competes with ${SKILL} in the same namespace`,
    );
  }
});

test('retiring a superseded skill preserves whatever the team had written in it', () => {
  const root = repo();
  withSupersededSkills(root);

  // A team edited one of them to match their conventions. Cortex never recorded a hash for
  // these files, so it cannot tell an edit from a pristine copy and must assume the worst.
  const edited = join(root, '.claude/skills/cortex-hook/SKILL.md');
  const theirs = `${readFileSync(edited, 'utf8')}\n# TEAM RULE: hooks must be reviewed by the platform team.\n`;
  writeFileSync(edited, theirs);

  installMetaSkills(root, [], false);

  // Assert on content, not existence: a .bak written after the delete would exist and still
  // have lost the edit, which is the failure mode worth catching.
  assert.equal(readFileSync(`${edited}.bak`, 'utf8'), theirs, 'the team edit must survive in the .bak');
  for (const name of SUPERSEDED_SKILLS) {
    const bak = join(root, '.claude/skills', name, 'SKILL.md.bak');
    assert.ok(existsSync(bak), `${name} was removed without leaving a backup`);
  }
});

test('a second run reports nothing to retire and creates no further backups', () => {
  const root = repo();
  withSupersededSkills(root);
  installMetaSkills(root, [], false);

  const plan = [];
  installMetaSkills(root, plan, false);

  const retired = plan.filter((s) => /superseded/.test(s.note ?? ''));
  assert.deepEqual(retired, [], `a settled repo must report no migration, got ${JSON.stringify(retired)}`);
  for (const name of SUPERSEDED_SKILLS) {
    assert.equal(
      existsSync(join(root, '.claude/skills', name, 'SKILL.md.bak.bak')),
      false,
      `${name} backed up its own backup on a second run`,
    );
  }
});

test('migration touches only what Cortex installed, never the team’s own skills', () => {
  const root = repo();
  withSupersededSkills(root);

  const ours = join(root, '.claude/skills/deploy-preview');
  mkdirSync(ours, { recursive: true });
  const body = '---\nname: deploy-preview\n---\n\n# /deploy-preview\n';
  writeFileSync(join(ours, 'SKILL.md'), body);

  installMetaSkills(root, [], false);

  assert.equal(readFileSync(join(ours, 'SKILL.md'), 'utf8'), body, 'a team skill must not be touched');
  assert.equal(existsSync(join(ours, 'SKILL.md.bak')), false, 'and must not be backed up either');
});

test('a dry run migrates nothing', () => {
  const root = repo();
  withSupersededSkills(root);
  const before = readFileSync(join(root, '.claude/skills/cortex-hook/SKILL.md'), 'utf8');

  const plan = [];
  installMetaSkills(root, plan, true);

  assert.equal(readFileSync(join(root, '.claude/skills/cortex-hook/SKILL.md'), 'utf8'), before);
  assert.ok(
    plan.some((s) => /superseded/.test(s.note ?? '')),
    'a dry run must still say what it would retire',
  );
});
