/**
 * The Markdown vault — the SOURCE OF TRUTH for the graph brain (issue #282).
 *
 * Each note is a plain Markdown file: YAML-ish frontmatter (open, Obsidian/Foam/
 * Logseq-compatible) + body. `[[wikilinks]]` in the body are edges. The vault has
 * NO app dependency — it is sovereign plain files, git-friendly and human-editable.
 *
 * We deliberately avoid a YAML library (keeps engine deps to mcp-sdk + zod). The
 * frontmatter we emit is a constrained subset (scalars + inline `[a, b]` arrays);
 * the parser also tolerates hand-edited block lists (`- item`).
 */

import fs from 'node:fs';
import path from 'node:path';
import type { BrainNode, Domain, NodeStatus } from './types.js';

export interface ParsedNote {
  /** Raw frontmatter keys (strings or string[]). */
  frontmatter: Record<string, string | string[]>;
  body: string;
  /** `[[wikilink]]` targets found in the body, in order, de-duplicated. */
  links: string[];
  /** Relative path of the note within the vault. */
  relPath: string;
}

const FRONTMATTER_FENCE = '---';
const WIKILINK_RE = /\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]/g;

/** Lowercase, hyphenated, filesystem-safe slug for note filenames. */
export function slugify(input: string): string {
  const slug = input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return slug || 'note';
}

/** Extract de-duplicated `[[wikilink]]` targets (alias/heading suffixes stripped). */
export function extractWikilinks(body: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of body.matchAll(WIKILINK_RE)) {
    const target = m[1].trim();
    if (target && !seen.has(target)) {
      seen.add(target);
      out.push(target);
    }
  }
  return out;
}

function parseScalar(raw: string): string {
  const v = raw.trim();
  if (v.startsWith('"')) {
    // Emitted by escapeScalar via JSON.stringify — decode escapes properly.
    try {
      const parsed: unknown = JSON.parse(v);
      if (typeof parsed === 'string') return parsed;
    } catch {
      /* fall through to naive strip */
    }
    return v.endsWith('"') ? v.slice(1, -1) : v.slice(1);
  }
  if (v.startsWith("'") && v.endsWith("'")) {
    return v.slice(1, -1);
  }
  return v;
}

function parseInlineArray(raw: string): string[] {
  return raw
    .slice(1, -1)
    .split(',')
    .map((s) => parseScalar(s))
    .filter((s) => s.length > 0);
}

/** Parse a note's frontmatter + body. Missing/empty frontmatter → `{}` + full text as body. */
export function parseNote(raw: string, relPath: string): ParsedNote {
  const frontmatter: Record<string, string | string[]> = {};
  let body = raw;

  const normalized = raw.replace(/\r\n/g, '\n');
  if (normalized.startsWith(FRONTMATTER_FENCE + '\n')) {
    const end = normalized.indexOf('\n' + FRONTMATTER_FENCE, FRONTMATTER_FENCE.length);
    if (end !== -1) {
      const fmBlock = normalized.slice(FRONTMATTER_FENCE.length + 1, end);
      body = normalized.slice(end + 1 + FRONTMATTER_FENCE.length + 1);
      const lines = fmBlock.split('\n');
      let pendingKey: string | null = null;
      let pendingList: string[] = [];
      const flush = () => {
        if (pendingKey !== null) {
          frontmatter[pendingKey] = pendingList;
          pendingKey = null;
          pendingList = [];
        }
      };
      for (const line of lines) {
        if (/^\s*-\s+/.test(line) && pendingKey !== null) {
          pendingList.push(parseScalar(line.replace(/^\s*-\s+/, '')));
          continue;
        }
        flush();
        const idx = line.indexOf(':');
        if (idx === -1) continue;
        const key = line.slice(0, idx).trim();
        const valueRaw = line.slice(idx + 1).trim();
        if (!key) continue;
        if (valueRaw === '') {
          // Possible block list following.
          pendingKey = key;
          pendingList = [];
        } else if (valueRaw.startsWith('[') && valueRaw.endsWith(']')) {
          frontmatter[key] = parseInlineArray(valueRaw);
        } else {
          frontmatter[key] = parseScalar(valueRaw);
        }
      }
      flush();
    }
  }

  return { frontmatter, body: body.replace(/^\n+/, ''), links: extractWikilinks(body), relPath };
}

function asString(v: string | string[] | undefined, fallback = ''): string {
  if (Array.isArray(v)) return v.join(', ');
  return v ?? fallback;
}

function asArray(v: string | string[] | undefined): string[] {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    return v.split(',').map((s) => s.trim()).filter(Boolean);
  }
  return [];
}

const VALID_DOMAINS: Domain[] = ['project', 'personal', 'shared'];

/**
 * Build a BrainNode (sans embedding) from a parsed note. Frontmatter supplies
 * scope/metadata; the body is the content. Falls back to safe defaults so a
 * hand-written note never crashes a rebuild.
 */
export function noteToNode(
  parsed: ParsedNote,
  defaults: { tenantId: string; domain: Domain },
): Omit<BrainNode, 'embedding'> {
  const fm = parsed.frontmatter;
  const domainRaw = asString(fm.domain) as Domain;
  const domain = VALID_DOMAINS.includes(domainRaw) ? domainRaw : defaults.domain;
  const statusRaw = asString(fm.status);
  const status: NodeStatus = statusRaw === 'stale' ? 'stale' : 'active';
  const title = asString(fm.title) || deriveTitleFromPath(parsed.relPath);
  const content = parsed.body.trim();

  return {
    id: asString(fm.id) || `${slugify(title)}`,
    tenantId: asString(fm.tenant_id) || defaults.tenantId,
    domain,
    title,
    content,
    category: asString(fm.category) || 'general',
    tags: asArray(fm.tags),
    status,
    path: parsed.relPath,
    fingerprint: asString(fm.fingerprint) || computeFingerprint(asString(fm.category) || 'general', title, content),
    createdAt: asString(fm.createdAt) || asString(fm.created_at) || new Date(0).toISOString(),
    updatedAt: asString(fm.updatedAt) || asString(fm.updated_at) || undefined,
  };
}

function deriveTitleFromPath(relPath: string): string {
  const base = path.basename(relPath).replace(/\.md$/i, '');
  return base.replace(/[-_]+/g, ' ').trim() || 'Untitled';
}

/** Stable content fingerprint (mirrors mcp-server/memory.ts: `category::title::content`, lowercased). */
export function computeFingerprint(category: string, title: string, content: string): string {
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
  return `${norm(category)}::${norm(title)}::${norm(content)}`;
}

function escapeScalar(v: string): string {
  if (/^[\w .,/@:+#()-]*$/.test(v) && v.trim() === v) return v;
  return JSON.stringify(v);
}

/** Serialize a node to a Markdown note (frontmatter + body). Round-trips with parseNote. */
export function nodeToMarkdown(node: Omit<BrainNode, 'path' | 'embedding'> & { path?: string }): string {
  const lines: string[] = [FRONTMATTER_FENCE];
  lines.push(`id: ${escapeScalar(node.id)}`);
  lines.push(`title: ${escapeScalar(node.title)}`);
  lines.push(`tenant_id: ${escapeScalar(node.tenantId)}`);
  lines.push(`domain: ${node.domain}`);
  lines.push(`category: ${escapeScalar(node.category)}`);
  lines.push(`tags: [${node.tags.map((t) => escapeScalar(t)).join(', ')}]`);
  lines.push(`status: ${node.status}`);
  lines.push(`createdAt: ${escapeScalar(node.createdAt)}`);
  if (node.updatedAt) lines.push(`updatedAt: ${escapeScalar(node.updatedAt)}`);
  lines.push(`fingerprint: ${escapeScalar(node.fingerprint)}`);
  lines.push(FRONTMATTER_FENCE);
  lines.push('');
  lines.push(node.content.trim());
  lines.push('');
  return lines.join('\n');
}

/** List all `.md` note paths in the vault (recursive), as paths relative to vaultPath. */
export function listVaultNotes(vaultPath: string): string[] {
  if (!fs.existsSync(vaultPath)) return [];
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
        out.push(path.relative(vaultPath, full).split(path.sep).join('/'));
      }
    }
  };
  walk(vaultPath);
  return out.sort();
}
