import { describe, it, expect } from 'vitest';
import {
  slugify,
  extractWikilinks,
  parseNote,
  noteToNode,
  nodeToMarkdown,
  computeFingerprint,
} from '../brainstore/vault.js';
import type { BrainNode } from '../brainstore/types.js';

describe('vault: slugify', () => {
  it('lowercases, hyphenates, strips punctuation', () => {
    expect(slugify('Hello, World! (v2)')).toBe('hello-world-v2');
    expect(slugify('  Trim  Me  ')).toBe('trim-me');
  });
  it('falls back to "note" for empty/symbol-only input', () => {
    expect(slugify('')).toBe('note');
    expect(slugify('!!!')).toBe('note');
  });
});

describe('vault: extractWikilinks', () => {
  it('extracts targets, strips aliases/headings, dedupes', () => {
    const body = 'See [[Alpha]] and [[Beta|the beta]] and [[Gamma#section]] and [[Alpha]] again.';
    expect(extractWikilinks(body)).toEqual(['Alpha', 'Beta', 'Gamma']);
  });
  it('returns empty when there are no links', () => {
    expect(extractWikilinks('plain text [not a link]')).toEqual([]);
  });
});

describe('vault: parseNote', () => {
  it('parses frontmatter scalars + inline arrays + body', () => {
    const raw = [
      '---',
      'id: abc',
      'title: My Note',
      'domain: project',
      'tags: [a, b, c]',
      'status: active',
      '---',
      '',
      'Body links to [[Other]].',
      '',
    ].join('\n');
    const parsed = parseNote(raw, 'project/my-note.md');
    expect(parsed.frontmatter.id).toBe('abc');
    expect(parsed.frontmatter.tags).toEqual(['a', 'b', 'c']);
    expect(parsed.body).toContain('Body links to');
    expect(parsed.links).toEqual(['Other']);
  });

  it('tolerates hand-edited block lists', () => {
    const raw = ['---', 'title: T', 'tags:', '  - x', '  - y', '---', 'body'].join('\n');
    const parsed = parseNote(raw, 't.md');
    expect(parsed.frontmatter.tags).toEqual(['x', 'y']);
  });

  it('treats a file with no frontmatter as pure body', () => {
    const parsed = parseNote('just text', 'x.md');
    expect(parsed.frontmatter).toEqual({});
    expect(parsed.body).toBe('just text');
  });
});

describe('vault: node <-> markdown round-trip', () => {
  it('preserves fields including JSON-escaped scalars', () => {
    const node: BrainNode = {
      id: 'n1',
      tenantId: 'local',
      domain: 'personal',
      title: 'A "tricky" title: with, commas',
      content: 'Some content with a [[Link]] and `code`.',
      category: 'pitfalls',
      tags: ['breaking-change', 'mcp'],
      status: 'active',
      path: 'personal/a-tricky-title.md',
      fingerprint: 'pitfalls::a "tricky" title::some content',
      createdAt: '2026-05-27T06:25:22.347Z',
      updatedAt: '2026-05-27T07:00:00.000Z',
      embedding: null,
    };
    const md = nodeToMarkdown(node);
    const parsed = parseNote(md, node.path);
    const back = noteToNode(parsed, { tenantId: 'fallback', domain: 'project' });

    expect(back.id).toBe(node.id);
    expect(back.title).toBe(node.title);
    expect(back.tenantId).toBe(node.tenantId);
    expect(back.domain).toBe(node.domain);
    expect(back.category).toBe(node.category);
    expect(back.tags).toEqual(node.tags);
    expect(back.status).toBe(node.status);
    expect(back.content).toBe(node.content);
    expect(back.createdAt).toBe(node.createdAt);
    expect(back.updatedAt).toBe(node.updatedAt);
    expect(back.fingerprint).toBe(node.fingerprint);
  });

  it('uses fallback scope/title when frontmatter is missing', () => {
    const parsed = parseNote('just a body', 'project/some-file.md');
    const node = noteToNode(parsed, { tenantId: 'local', domain: 'project' });
    expect(node.tenantId).toBe('local');
    expect(node.domain).toBe('project');
    expect(node.title).toBe('some file');
    expect(node.content).toBe('just a body');
  });
});

describe('vault: computeFingerprint', () => {
  it('is stable and case/space-insensitive', () => {
    const a = computeFingerprint('Conventions', 'Model Routing', 'Use   X');
    const b = computeFingerprint('conventions', 'model routing', 'use x');
    expect(a).toBe(b);
    expect(a).toBe('conventions::model routing::use x');
  });
});
