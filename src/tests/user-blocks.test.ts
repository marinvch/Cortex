/**
 * Tests for src/user-blocks.ts
 *
 * Covers:
 *  - extractUserBlocks: happy path, multiple blocks, duplicate IDs, empty file
 *  - mergeUserBlocks: strategy-1 (ID match), strategy-2 (anchor), strategy-3 (conflict)
 *  - Edge cases: no user blocks in previous, blocks already gone from generated
 */
import { describe, expect, it } from 'vitest';
import { extractUserBlocks, mergeUserBlocks } from '../user-blocks.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeBlock(id: string, inner: string): string {
  return `<!-- AI-OS:USER_BLOCK:START id="${id}" -->\n${inner}\n<!-- AI-OS:USER_BLOCK:END id="${id}" -->`;
}

// ---------------------------------------------------------------------------
// extractUserBlocks
// ---------------------------------------------------------------------------

describe('extractUserBlocks', () => {
  it('returns an empty map for content with no markers', () => {
    const result = extractUserBlocks('# Hello\nSome content\n');
    expect(result.size).toBe(0);
  });

  it('extracts a single block with its id and inner content', () => {
    const inner = '## My Custom Rules\n- rule 1\n- rule 2';
    const content = `# Header\n\n${makeBlock('my-rules', inner)}\n\n# Footer\n`;
    const blocks = extractUserBlocks(content);

    expect(blocks.size).toBe(1);
    const block = blocks.get('my-rules');
    expect(block).toBeDefined();
    expect(block!.innerContent.trim()).toBe(inner);
    expect(block!.fullMatch).toContain('AI-OS:USER_BLOCK:START');
  });

  it('records the anchor line (line before START marker)', () => {
    const content = `## Section Header\n${makeBlock('b1', 'content')}\n`;
    const blocks = extractUserBlocks(content);
    expect(blocks.get('b1')!.anchorBefore).toBe('## Section Header');
  });

  it('sets anchorBefore to empty string when block is at file start', () => {
    const content = `${makeBlock('b1', 'content')}\nrest of file\n`;
    const blocks = extractUserBlocks(content);
    expect(blocks.get('b1')!.anchorBefore).toBe('');
  });

  it('extracts multiple blocks', () => {
    const content = [
      '# Doc',
      '',
      makeBlock('block-a', 'alpha'),
      '',
      '## Another Section',
      makeBlock('block-b', 'beta'),
      '',
    ].join('\n');

    const blocks = extractUserBlocks(content);
    expect(blocks.size).toBe(2);
    expect(blocks.has('block-a')).toBe(true);
    expect(blocks.has('block-b')).toBe(true);
  });

  it('first occurrence wins on duplicate IDs', () => {
    const content = `${makeBlock('dup', 'first')}\n${makeBlock('dup', 'second')}`;
    const blocks = extractUserBlocks(content);
    expect(blocks.size).toBe(1);
    expect(blocks.get('dup')!.innerContent.trim()).toBe('first');
  });
});

// ---------------------------------------------------------------------------
// mergeUserBlocks — no user blocks in previous
// ---------------------------------------------------------------------------

describe('mergeUserBlocks — no user blocks in previous', () => {
  it('returns generated content unchanged when previous has no markers', () => {
    const generated = '# Generated\nSome content\n';
    const previous  = '# Old\nNo markers here\n';

    const { content, preserved, conflicts } = mergeUserBlocks(generated, previous);
    expect(content).toBe(generated);
    expect(preserved).toHaveLength(0);
    expect(conflicts).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// mergeUserBlocks — Strategy 1: ID match
// ---------------------------------------------------------------------------

describe('mergeUserBlocks — strategy 1: ID match', () => {
  it('preserves user content when generated file contains the same block markers', () => {
    const userInner   = '## My Custom Override\n- custom rule';
    const userBlock   = makeBlock('rules', userInner);
    const previous    = `# Old Header\n\n${userBlock}\n\n# Footer\n`;

    // The newly generated file scaffolds the same block with default content
    const defaultInner  = '## Generated Rules (replace me)';
    const generatedBlock = makeBlock('rules', defaultInner);
    const generated     = `# New Header\n\n${generatedBlock}\n\n# Footer\n`;

    const { content, preserved, conflicts } = mergeUserBlocks(generated, previous);

    expect(preserved).toContain('rules');
    expect(conflicts).toHaveLength(0);
    expect(content).toContain(userInner);
    expect(content).not.toContain(defaultInner);
  });

  it('preserves all matching blocks in a multi-block file', () => {
    const prev = [
      makeBlock('a', 'user-a'),
      makeBlock('b', 'user-b'),
    ].join('\n\n');

    const gen = [
      makeBlock('a', 'default-a'),
      makeBlock('b', 'default-b'),
    ].join('\n\n');

    const { preserved, conflicts, content } = mergeUserBlocks(gen, prev);
    expect(preserved).toHaveLength(2);
    expect(conflicts).toHaveLength(0);
    expect(content).toContain('user-a');
    expect(content).toContain('user-b');
  });
});

// ---------------------------------------------------------------------------
// mergeUserBlocks — Strategy 2: anchor-based insertion
// ---------------------------------------------------------------------------

describe('mergeUserBlocks — strategy 2: anchor-based insertion', () => {
  it('inserts user block after matching anchor when no ID match exists in generated', () => {
    const anchorLine = '## Custom Section';
    const userBlock  = makeBlock('custom', 'my custom content');
    const previous   = `# Doc\n\n${anchorLine}\n${userBlock}\n\n# End\n`;

    // Generated file has the anchor but no block markers
    const generated  = `# Doc\n\n${anchorLine}\n\n# End\n`;

    const { content, preserved, conflicts } = mergeUserBlocks(generated, previous);

    expect(preserved).toContain('custom');
    expect(conflicts).toHaveLength(0);
    expect(content).toContain(userBlock);
  });
});

// ---------------------------------------------------------------------------
// mergeUserBlocks — Strategy 3: conflict
// ---------------------------------------------------------------------------

describe('mergeUserBlocks — strategy 3: conflict', () => {
  it('emits a ConflictReport when neither ID nor anchor is found', () => {
    const userBlock = makeBlock('orphaned', 'some user content');
    // Previous has the block with an anchor that no longer exists in generated
    const previous  = `## Vanished Anchor\n${userBlock}\n`;
    const generated = `# Completely Different\nNew content here\n`;

    const { content, preserved, conflicts } = mergeUserBlocks(generated, previous);

    expect(preserved).toHaveLength(0);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].blockId).toBe('orphaned');
    // Content should contain the block wrapped in CONFLICT markers
    expect(content).toContain('AI-OS:CONFLICT');
    expect(content).toContain('some user content');
  });

  it('classifies conflict reason correctly when anchor existed but is now gone', () => {
    const block    = makeBlock('b', 'data');
    const previous = `## Some Section\n${block}\n`;
    const generated = `# No Matching Section\nContent\n`;

    const { conflicts } = mergeUserBlocks(generated, previous);
    expect(conflicts[0].reason).toBe('anchor-lost');
  });

  it('classifies reason as block-id-missing when block had no anchor (file start)', () => {
    const block    = makeBlock('b', 'data');
    const previous = `${block}\n# Rest\n`;
    const generated = `# Different start\nContent\n`;

    const { conflicts } = mergeUserBlocks(generated, previous);
    // anchorBefore is '' so it falls to block-id-missing
    expect(conflicts[0].reason).toBe('block-id-missing');
  });

  it('mixed: some blocks preserved, some conflict', () => {
    const prev = [
      makeBlock('ok', 'preserved content'),
      `## Lost Anchor\n${makeBlock('lost', 'lost content')}`,
    ].join('\n\n');

    // Generated has the 'ok' block marker but the anchor for 'lost' is gone
    const gen = [
      makeBlock('ok', 'default ok'),
      `# Different structure`,
    ].join('\n\n');

    const { preserved, conflicts } = mergeUserBlocks(gen, prev);
    expect(preserved).toContain('ok');
    expect(conflicts.some(c => c.blockId === 'lost')).toBe(true);
  });
});
