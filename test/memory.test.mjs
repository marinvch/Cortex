import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  GOTCHAS,
  GITATTRIBUTES,
  MEMORY_MERGE_ATTRIBUTE,
  initMemory,
  appendGotcha,
  appendGotchas,
  ensureMemoryMergeAttribute,
} from '../src/memory.mjs';
import { install } from '../src/install.mjs';

/**
 * SPEC D3/D4. Union merge is line-based, which is the entire reason this file exists:
 * the format is not cosmetic, it is the merge strategy. Every assertion below is about a
 * property `merge=union` needs in order to be safe —
 *
 *   - one line per entry, so two branches interleave cleanly rather than corrupting one
 *   - no blank line between entries, since union merge would keep both copies of it
 *   - a `.gitattributes` in the TARGET repo, because a merge driver in .git/config does
 *     not survive a clone and "clone the repo, inherit the brain" is the whole premise
 *
 * and D4: `decisions.md` is cut. Nothing ever appended to it, so every consumer repo
 * committed a permanently empty file, and a multi-line ADR would have interleaved into
 * garbage under the very merge strategy D3 adopts.
 */

/** Every temp dir this file creates, removed at exit. */
const TEMP_DIRS = [];

function tmpRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'cortex-memory-'));
  TEMP_DIRS.push(dir);
  return dir;
}

process.on('exit', () => {
  for (const dir of TEMP_DIRS) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // a leftover temp dir is not worth failing a run over
    }
  }
});

const read = (root, rel) => readFileSync(join(root, rel), 'utf8');

/** The entry lines of gotchas.md — everything the harvester appended, header excluded. */
const entryLines = (root) =>
  read(root, GOTCHAS)
    .split('\n')
    .filter((l) => /^- \d{4}-\d{2}-\d{2} /.test(l));

// ── D4: decisions.md is gone ────────────────────────────────────────────────

test('install seeds gotchas.md and no longer creates a decisions.md nobody writes to', () => {
  const root = tmpRepo();
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'acme' }));
  install(root);

  assert.ok(existsSync(join(root, GOTCHAS)), 'gotchas.md is the file the brain actually accumulates into');
  assert.equal(
    existsSync(join(root, '.cortex/memory/decisions.md')),
    false,
    'decisions.md had no writer; shipping a permanently empty "append-only decision log" is the noise D4 cuts',
  );
});

test('initMemory touches gotchas.md and nothing else under .cortex/memory', () => {
  const root = tmpRepo();
  const touched = initMemory(root);

  const dir = join(root, '.cortex/memory');
  assert.deepEqual(readdirSync(dir).sort(), ['gotchas.md'], 'memory holds exactly one file now');

  // The plan the installer prints is built from this, so it has to name the real files.
  const rels = touched.map((step) => step.rel).sort();
  assert.deepEqual(rels, [GITATTRIBUTES, GOTCHAS].sort(), `initMemory reported ${JSON.stringify(rels)}`);
});

// ── D3: one line per entry ──────────────────────────────────────────────────

test('every appended entry occupies exactly one line', () => {
  const root = tmpRepo();
  initMemory(root);
  appendGotchas(
    root,
    ['the retry backoff is 3 attempts with jitter', 'the staging DB resets every Sunday at 03:00 UTC'],
    { date: '2026-09-04' },
  );

  const lines = entryLines(root);
  assert.equal(lines.length, 2, `expected 2 entry lines, got ${JSON.stringify(lines)}`);
  for (const line of lines) {
    assert.doesNotMatch(line, /\n/, 'an entry that wraps interleaves with a teammate’s on a union merge');
  }
});

test('a multi-line candidate is collapsed to one line rather than written as several', () => {
  const root = tmpRepo();
  initMemory(root);

  // What a transcript harvester actually hands over: a wrapped observation.
  const res = appendGotcha(root, 'the payments webhook retries\nfor 72 hours,\nthen drops the event', {
    date: '2026-09-04',
  });
  assert.equal(res.written, true);

  const lines = entryLines(root);
  assert.equal(lines.length, 1, `a wrapped entry must become one line, got ${JSON.stringify(lines)}`);
  assert.match(lines[0], /the payments webhook retries for 72 hours, then drops the event/);
});

test('entries are not separated by a blank line, which union merge would duplicate', () => {
  const root = tmpRepo();
  initMemory(root);
  appendGotchas(root, ['first thing learned', 'second thing learned', 'third thing learned'], {
    date: '2026-09-04',
  });

  const body = read(root, GOTCHAS);
  const idx = body.indexOf('- 2026-09-04 — first thing learned');
  assert.ok(idx > -1, 'the first entry should be in the file');

  const tail = body.slice(idx);
  assert.doesNotMatch(
    tail,
    /\n\s*\n/,
    `blank line between entries: union merge keeps both copies of it. Tail was:\n${JSON.stringify(tail)}`,
  );
});

test('a file whose last line has no trailing newline gains one instead of joining two entries', () => {
  const root = tmpRepo();
  initMemory(root);
  appendGotcha(root, 'the first entry', { date: '2026-09-04' });

  // A human pruned the file in an editor that does not add a final newline.
  const abs = join(root, GOTCHAS);
  writeFileSync(abs, readFileSync(abs, 'utf8').replace(/\n+$/, ''));
  assert.doesNotMatch(readFileSync(abs, 'utf8'), /\n$/, 'precondition: the file must end mid-line');

  appendGotcha(root, 'the second entry', { date: '2026-09-04' });

  const lines = entryLines(root);
  assert.equal(lines.length, 2, `two entries must stay two lines, got ${JSON.stringify(lines)}`);
  assert.match(lines[0], /the first entry/);
  assert.match(lines[1], /the second entry/);
  assert.doesNotMatch(
    read(root, GOTCHAS),
    /the first entry _\(manual\)_- /,
    'the two entries were joined into one line',
  );
});

test('gotchas.md carries no CR bytes, because it is committed into other repos', () => {
  const root = tmpRepo();
  initMemory(root);
  appendGotcha(root, 'the queue drains fastest with a batch size of 64', { date: '2026-09-04' });

  // Byte-level: counting lines cannot tell LF from CRLF, and a CRLF entry breaks a
  // union merge against an LF one on the other branch.
  const bytes = readFileSync(join(root, GOTCHAS));
  const cr = bytes.indexOf(0x0d);
  assert.equal(cr, -1, `gotchas.md contains CR (0x0D) at byte ${cr}`);
});

// ── D3: the .gitattributes that makes the format mean something ─────────────

test('install stamps merge=union for .cortex/memory into the target repo', () => {
  const root = tmpRepo();
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'acme' }));
  install(root);

  const attrs = read(root, GITATTRIBUTES);
  assert.match(
    attrs,
    /^\.cortex\/memory\/\*\.md\s+merge=union$/m,
    `expected the union-merge rule for .cortex/memory/*.md, got:\n${attrs}`,
  );
});

test('the rule the installer writes is the one the module declares', () => {
  // Pinning the constant against the file keeps a rename from silently writing a rule
  // git will not apply — the attribute is only load-bearing if git parses it.
  assert.match(MEMORY_MERGE_ATTRIBUTE, /^\.cortex\/memory\/\*\.md merge=union$/);

  const root = tmpRepo();
  ensureMemoryMergeAttribute(root);
  assert.ok(read(root, GITATTRIBUTES).includes(MEMORY_MERGE_ATTRIBUTE));
});

test('an existing .gitattributes in the target repo is appended to, never clobbered', () => {
  const root = tmpRepo();
  const theirs = '* text=auto eol=lf\n*.png binary\ndocs/** linguist-documentation\n';
  writeFileSync(join(root, GITATTRIBUTES), theirs);

  ensureMemoryMergeAttribute(root);

  const after = read(root, GITATTRIBUTES);
  assert.ok(after.startsWith(theirs), `the team's rules must survive verbatim and in order, got:\n${after}`);
  for (const rule of ['* text=auto eol=lf', '*.png binary', 'docs/** linguist-documentation']) {
    assert.ok(after.includes(rule), `lost an existing rule: ${rule}`);
  }
  assert.match(after, /^\.cortex\/memory\/\*\.md\s+merge=union$/m);
});

test('an existing .gitattributes with no trailing newline does not get its last rule joined', () => {
  const root = tmpRepo();
  // The failure mode this guards: `docs/** linguist-documentation# Cortex memory...`,
  // which silently destroys the team's last rule.
  writeFileSync(join(root, GITATTRIBUTES), '* text=auto eol=lf\ndocs/** linguist-documentation');

  ensureMemoryMergeAttribute(root);

  const lines = read(root, GITATTRIBUTES).split('\n');
  assert.ok(
    lines.includes('docs/** linguist-documentation'),
    `the last pre-existing rule was joined to ours: ${JSON.stringify(lines)}`,
  );
  assert.ok(lines.includes(MEMORY_MERGE_ATTRIBUTE));
});

test('re-running does not add the attribute twice', () => {
  const root = tmpRepo();
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'acme' }));
  install(root);
  install(root);

  const occurrences = read(root, GITATTRIBUTES).split(MEMORY_MERGE_ATTRIBUTE).length - 1;
  assert.equal(occurrences, 1, 'a re-run must leave the attribute exactly once');
});

test('a repo that already declares the rule its own way is left alone', () => {
  const root = tmpRepo();
  const theirs = `# our own convention\n${MEMORY_MERGE_ATTRIBUTE}\n`;
  writeFileSync(join(root, GITATTRIBUTES), theirs);

  const step = ensureMemoryMergeAttribute(root);

  assert.equal(step, null, 'nothing to report when there is nothing to do');
  assert.equal(read(root, GITATTRIBUTES), theirs, 'a file that already has the rule must not be rewritten');
});

test('the .gitattributes it writes carries no CR bytes', () => {
  const root = tmpRepo();
  ensureMemoryMergeAttribute(root);
  const bytes = readFileSync(join(root, GITATTRIBUTES));
  const cr = bytes.indexOf(0x0d);
  assert.equal(cr, -1, `.gitattributes contains CR (0x0D) at byte ${cr}`);
});

// ── the merge itself ────────────────────────────────────────────────────────

test('two branches that each recorded a gotcha produce two lines, not an overlap', () => {
  // Simulate the merge union performs: line-wise concatenation of both tails. If entries
  // were multi-line or blank-separated, this is where they would interleave.
  const root = tmpRepo();
  initMemory(root);
  appendGotcha(root, 'shared base entry', { date: '2026-09-01' });
  const base = read(root, GOTCHAS);

  const theirs = tmpRepo();
  mkdirSync(join(theirs, '.cortex/memory'), { recursive: true });
  writeFileSync(join(theirs, GOTCHAS), base);

  appendGotcha(root, 'ours: the CDN caches 404s for an hour', { date: '2026-09-02' });
  appendGotcha(theirs, 'theirs: the migration must run before the deploy', { date: '2026-09-03' });

  const ourTail = read(root, GOTCHAS).slice(base.length);
  const theirTail = read(theirs, GOTCHAS).slice(base.length);
  const merged = base + ourTail + theirTail;

  const lines = merged.split('\n').filter((l) => /^- \d{4}-\d{2}-\d{2} /.test(l));
  assert.equal(lines.length, 3, `union merge must yield 3 whole entries, got ${JSON.stringify(lines)}`);
  assert.ok(lines.some((l) => l.includes('ours: the CDN caches 404s')));
  assert.ok(lines.some((l) => l.includes('theirs: the migration must run')));
  assert.doesNotMatch(merged, /\n\s*\n\s*\n/, 'stacked blank lines are what a union merge of a padded tail looks like');
});
