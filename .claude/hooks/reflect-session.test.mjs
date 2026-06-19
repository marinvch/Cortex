import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractUserTurns } from './reflect-session.mjs';

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
