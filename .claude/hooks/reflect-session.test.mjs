import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractUserTurns, mineTranscript } from './reflect-session.mjs';

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
