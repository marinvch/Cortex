import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractUserTurns, mineTranscript, appendCandidates, resolveRoot, runFromPayload } from './reflect-session.mjs';
import { mkdtempSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const lines = [
  JSON.stringify({ type: 'user', isSidechain: false, message: { role: 'user', content: [{ type: 'text', text: 'I prefer tabs over spaces.' }] } }),
  JSON.stringify({ type: 'user', isSidechain: false, message: { role: 'user', content: 'always run the tests first' } }),
  JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'sure' }] } }),
  JSON.stringify({ type: 'user', isSidechain: true, message: { role: 'user', content: [{ type: 'text', text: 'sidechain noise' }] } }),
  JSON.stringify({ type: 'user', isSidechain: false, message: { role: 'user', content: [{ type: 'tool_result', content: 'tool output' }] } }),
  JSON.stringify({ type: 'user', isSidechain: false, message: { role: 'user', content: [{ type: 'text', text: '<command-name>/audit</command-name>' }] } }),
  'not json at all',
].join('\n');

test('extractUserTurns keeps only genuine human prose', () => {
  const turns = extractUserTurns(lines);
  assert.deepEqual(turns, ['I prefer tabs over spaces.', 'always run the tests first']);
});

test('mineTranscript classifies personal vs project signals', () => {
  const drafts = mineTranscript([
    'I prefer concise commit messages.',
    'Always run the full test suite before pushing.',
  ]);
  const personal = drafts.find((d) => d.text.startsWith('I prefer'));
  const project = drafts.find((d) => d.text.startsWith('Always run'));
  assert.equal(personal.domain, 'personal');
  assert.equal(project.domain, 'project');
  assert.match(personal.trigger, /i prefer/i);
});

test('mineTranscript dedups and caps at 5', () => {
  const dup = mineTranscript(['I prefer X.', 'I prefer X.']);
  assert.equal(dup.length, 1);
  const many = mineTranscript(
    Array.from({ length: 8 }, (_, i) => `Always do thing number ${i}.`),
  );
  assert.equal(many.length, 5);
});

test('mineTranscript returns nothing for plain chatter', () => {
  assert.deepEqual(mineTranscript(['can you open the file', 'thanks']), []);
});

test('appendCandidates writes only candidates.jsonl with correct schema', () => {
  const root = mkdtempSync(join(tmpdir(), 'cortex-'));
  const written = appendCandidates(
    [{ text: 'Always run tests.', domain: 'project', trigger: 'always' }],
    root,
  );
  assert.equal(written.length, 1);
  const c = written[0];
  assert.equal(c.text, 'Always run tests.');
  assert.equal(c.domain, 'project');
  assert.equal(c.needsSanitization, true);
  assert.ok(c.id && c.createdAt && c.trigger === 'always');
  // Boundary: brain/ contains ONLY candidates.jsonl; no memory.jsonl / context written.
  assert.deepEqual(readdirSync(join(root, 'brain')), ['candidates.jsonl']);
  const onDisk = readFileSync(join(root, 'brain', 'candidates.jsonl'), 'utf-8').trim().split('\n');
  assert.equal(onDisk.length, 1);
  assert.equal(JSON.parse(onDisk[0]).text, 'Always run tests.');
});

test('appendCandidates dedups against existing file content', () => {
  const root = mkdtempSync(join(tmpdir(), 'cortex-'));
  appendCandidates([{ text: 'Always run tests.', domain: 'project', trigger: 'always' }], root);
  const second = appendCandidates([
    { text: 'Always run tests.', domain: 'project', trigger: 'always' },
    { text: 'I prefer tabs.', domain: 'personal', trigger: 'i prefer' },
  ], root);
  assert.equal(second.length, 1);
  assert.equal(second[0].text, 'I prefer tabs.');
  assert.equal(second[0].needsSanitization, false);
  const onDisk = readFileSync(join(root, 'brain', 'candidates.jsonl'), 'utf-8').trim().split('\n');
  assert.equal(onDisk.length, 2);
});

test('mineTranscript: personal signal wins when a sentence also matches a project signal', () => {
  // "I always" is a PERSONAL signal; "always" is a PROJECT signal — personal must win.
  const drafts = mineTranscript(['I always rebase before pushing.']);
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].domain, 'personal');
});

test('resolveRoot honors precedence: env override beats payload.cwd', () => {
  const prev = process.env.AI_OS_PERSONAL_ROOT;
  try {
    process.env.AI_OS_PERSONAL_ROOT = '/env/root';
    assert.equal(resolveRoot({ cwd: '/payload/cwd' }), '/env/root');
    delete process.env.AI_OS_PERSONAL_ROOT;
    assert.equal(resolveRoot({ cwd: '/payload/cwd' }), '/payload/cwd');
  } finally {
    if (prev === undefined) delete process.env.AI_OS_PERSONAL_ROOT;
    else process.env.AI_OS_PERSONAL_ROOT = prev;
  }
});

test('runFromPayload is a no-op (returns [], no writes) for a missing transcript', () => {
  const root = mkdtempSync(join(tmpdir(), 'cortex-'));
  const out = runFromPayload({ transcript_path: join(root, 'nope.jsonl') }, root);
  assert.deepEqual(out, []);
  assert.equal(existsSync(join(root, 'brain')), false);
});
