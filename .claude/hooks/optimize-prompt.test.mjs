import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  wordCount, shouldBypass, scoreVagueness, buildDirective, evaluate, THRESHOLD,
} from './optimize-prompt.mjs';

test('wordCount ignores surrounding and repeated whitespace', () => {
  assert.equal(wordCount('  add   the booking stuff '), 4);
  assert.equal(wordCount(''), 0);
});

test('scoreVagueness scores a vague prompt at or above threshold', () => {
  assert.equal(scoreVagueness('add the booking stuff'), 4); // short +2, no component +1, no domain +1
  assert.equal(scoreVagueness('fix it'), 4);
  assert.equal(scoreVagueness('make it faster'), 5);        // + no action verb
});

test('scoreVagueness scores a grounded prompt below threshold', () => {
  const precise = 'refactor the recall handler in mcp/server.js so the database query is cached';
  assert.ok(scoreVagueness(precise) < THRESHOLD);
});

test('scoreVagueness credits a bare filename with a non-whitelisted extension', () => {
  assert.equal(scoreVagueness('fix the bug in app.py'), 3); // was 4 before this fix
  assert.equal(
    scoreVagueness('refactor the auth handler in server.py so tokens are cached'),
    0,
  );
});

test('scoreVagueness narrowing guards hold: e.g. is not a component reference', () => {
  // e.g. must NOT count as a component reference (stem "e" is only 1 char, guard holds);
  // score matches the plain 'make it faster' case (5): short +2, no action verb +1,
  // no component ref +1, no domain word +1.
  assert.equal(scoreVagueness('make it faster e.g. right now'), 5);
});

test('shouldBypass skips slash commands, steers and explicit opt-outs', () => {
  assert.equal(shouldBypass('/capture buy milk'), true);
  assert.equal(shouldBypass('yes'), true);
  assert.equal(shouldBypass('go ahead'), true);
  assert.equal(shouldBypass('just rename this'), true);
  assert.equal(shouldBypass('fix the null check in tools/cortex.sh:42'), true);
  assert.equal(shouldBypass(`${'word '.repeat(61)}`), true);
  assert.equal(shouldBypass(''), true);
  assert.equal(shouldBypass('add the booking stuff', { CORTEX_NO_OPTIMIZE: '1' }), true);
});

test('shouldBypass lets a genuinely vague prompt through to scoring', () => {
  assert.equal(shouldBypass('add the booking stuff', {}), false);
});

test('buildDirective names the skill and reports the score', () => {
  const d = buildDirective(4);
  assert.match(d, /4\/5/);
  assert.match(d, /skills\/optimize-prompt\/SKILL\.md/);
  assert.match(d, /docs\/prompts\//);
});

test('evaluate returns the hook payload only for vague, non-bypassed prompts', () => {
  const hit = evaluate('add the booking stuff', {});
  assert.equal(hit.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
  assert.match(hit.hookSpecificOutput.additionalContext, /Prompt vagueness score/);

  assert.equal(evaluate('/capture buy milk', {}), null);
  assert.equal(evaluate('refactor the recall handler in mcp/server.js so queries are cached', {}), null);
  assert.equal(evaluate(undefined, {}), null);
});

test('evaluate returns null via the below-threshold scoring path, not just bypass', () => {
  const prompt = 'update the readme.md documentation for skills';
  // Proves this prompt reaches scoring (does not short-circuit via shouldBypass).
  assert.equal(shouldBypass(prompt, {}), false);
  // And that scoring itself lands below THRESHOLD, returning null on that path.
  assert.equal(evaluate(prompt, {}), null);
});
