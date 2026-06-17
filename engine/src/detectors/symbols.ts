/**
 * symbols.ts — Pluggable per-language extractor adapters for the Repository
 * Intelligence Index (RII). Each adapter implements LanguageExtractor and
 * extracts symbols, file purpose, and semantic tags using regex over source text.
 *
 * No AST parsers — fast, zero-dependency, good enough for symbol names + signatures.
 * LSP-quality analysis is deferred to a future phase.
 */
import type { LanguageExtractor, SymbolExtract } from '../types.js';

// ── Shared tag-inference keywords ─────────────────────────────────────────────

const DOMAIN_TAG_MAP: Array<{ pattern: RegExp; tag: string }> = [
  { pattern: /auth|login|logout|session|token|jwt|oauth|password|credential/i, tag: 'auth' },
  { pattern: /database|db|sql|query|migration|schema|table|column|orm|prisma|sequelize/i, tag: 'database' },
  { pattern: /api|rest|graphql|grpc|route|endpoint|controller|handler|router/i, tag: 'api' },
  { pattern: /test|spec|mock|fixture|stub|assert|expect|describe|it\(/i, tag: 'testing' },
  { pattern: /ui|component|render|view|layout|style|css|tailwind|react|vue|angular/i, tag: 'ui' },
  { pattern: /cache|redis|memcache/i, tag: 'cache' },
  { pattern: /payment|billing|stripe|invoice|subscription/i, tag: 'payments' },
  { pattern: /email|mail|smtp|notification|webhook/i, tag: 'notifications' },
  { pattern: /config|env|setting|environment/i, tag: 'config' },
  { pattern: /log|logger|monitor|metric|trace|telemetry/i, tag: 'observability' },
  { pattern: /util|helper|format|parse|convert|transform/i, tag: 'utils' },
  { pattern: /file|upload|storage|s3|blob/i, tag: 'storage' },
  { pattern: /queue|worker|job|task|schedule|cron/i, tag: 'jobs' },
  { pattern: /search|index|elastic|lucene/i, tag: 'search' },
  { pattern: /security|crypto|hash|encrypt|decrypt|sign/i, tag: 'security' },
];

function inferTagsFromText(content: string, filePath: string): string[] {
  const text = `${filePath} ${content.slice(0, 2000)}`;
  const tags: string[] = [];
  for (const { pattern, tag } of DOMAIN_TAG_MAP) {
    if (pattern.test(text) && !tags.includes(tag)) tags.push(tag);
  }
  // Add directory-level tags from the file path
  const parts = filePath.replace(/\\/g, '/').split('/');
  for (const part of parts.slice(0, -1)) {
    for (const { pattern, tag } of DOMAIN_TAG_MAP) {
      if (pattern.test(part) && !tags.includes(tag)) tags.push(tag);
    }
  }
  return tags;
}

function parseSpecIds(lines: string[], lineIndex: number): string[] {
  const ids: string[] = [];
  const preceding = lines.slice(Math.max(0, lineIndex - 3), lineIndex).join('\n');
  const specRe = /@spec:\s*([\w-]+)/g;
  let m: RegExpExecArray | null;
  while ((m = specRe.exec(preceding)) !== null) {
    if (m[1]) ids.push(m[1]);
  }
  return ids;
}

// ── TypeScript / JavaScript Extractor ─────────────────────────────────────────

export const TypeScriptExtractor: LanguageExtractor = {
  language: 'TypeScript',
  extensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'],

  extractSymbols(content: string, _filePath: string): SymbolExtract[] {
    const lines = content.split('\n');
    const symbols: SymbolExtract[] = [];
    const seen = new Set<string>();

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? '';

      // export function / export async function / export default function
      let m = /^export\s+(?:default\s+)?(?:async\s+)?function\s*\*?\s*(\w+)\s*(\([^)]*\))/.exec(line);
      if (m && m[1] && !seen.has(m[1])) {
        seen.add(m[1]);
        symbols.push({ name: m[1], kind: 'function', line: i + 1, signature: `${m[1]}${m[2] ?? '()'}`, specIds: parseSpecIds(lines, i) });
        continue;
      }

      // export const name = (args) => / export const name = async (
      m = /^export\s+const\s+(\w+)\s*=\s*(?:async\s+)?\(/.exec(line);
      if (m && m[1] && !seen.has(m[1])) {
        seen.add(m[1]);
        symbols.push({ name: m[1], kind: 'function', line: i + 1, signature: m[1], specIds: parseSpecIds(lines, i) });
        continue;
      }

      // export class / export abstract class / export default class
      m = /^export\s+(?:default\s+)?(?:abstract\s+)?class\s+(\w+)/.exec(line);
      if (m && m[1] && !seen.has(m[1])) {
        seen.add(m[1]);
        symbols.push({ name: m[1], kind: 'class', line: i + 1, signature: m[1], specIds: parseSpecIds(lines, i) });
        continue;
      }

      // export interface
      m = /^export\s+interface\s+(\w+)/.exec(line);
      if (m && m[1] && !seen.has(m[1])) {
        seen.add(m[1]);
        symbols.push({ name: m[1], kind: 'interface', line: i + 1, signature: m[1], specIds: parseSpecIds(lines, i) });
        continue;
      }

      // export type
      m = /^export\s+type\s+(\w+)/.exec(line);
      if (m && m[1] && !seen.has(m[1])) {
        seen.add(m[1]);
        symbols.push({ name: m[1], kind: 'type', line: i + 1, signature: m[1], specIds: parseSpecIds(lines, i) });
        continue;
      }

      // export enum
      m = /^export\s+(?:const\s+)?enum\s+(\w+)/.exec(line);
      if (m && m[1] && !seen.has(m[1])) {
        seen.add(m[1]);
        symbols.push({ name: m[1], kind: 'enum', line: i + 1, signature: m[1], specIds: parseSpecIds(lines, i) });
        continue;
      }

      // export const / let / var (non-function)
      m = /^export\s+(?:const|let|var)\s+(\w+)/.exec(line);
      if (m && m[1] && !seen.has(m[1])) {
        seen.add(m[1]);
        symbols.push({ name: m[1], kind: 'variable', line: i + 1, signature: m[1], specIds: parseSpecIds(lines, i) });
      }
    }

    return symbols;
  },

  extractPurpose(content: string): string | null {
    // First /** ... */ block
    const jsdoc = /\/\*\*\s*([\s\S]*?)\s*\*\//.exec(content);
    if (jsdoc?.[1]) {
      const text = jsdoc[1].replace(/^\s*\*\s?/gm, '').trim().split('\n')[0]?.trim() ?? '';
      if (text.length > 0) return text.slice(0, 120);
    }
    // First //  comment block at top of file
    const lineComment = /^(?:\s*\/\/\s*(.+)\n)+/.exec(content);
    if (lineComment) {
      const text = lineComment[0].split('\n')
        .map(l => l.replace(/^\s*\/\/\s*/, '').trim())
        .filter(l => l.length > 0 && !l.startsWith('!') && !l.startsWith('=') && !/^-+$/.test(l))
        [0] ?? '';
      if (text.length > 5) return text.slice(0, 120);
    }
    return null;
  },

  extractTags(content: string, filePath: string): string[] {
    return inferTagsFromText(content, filePath);
  },
};

// ── Python Extractor ──────────────────────────────────────────────────────────

export const PythonExtractor: LanguageExtractor = {
  language: 'Python',
  extensions: ['.py'],

  extractSymbols(content: string, _filePath: string): SymbolExtract[] {
    const lines = content.split('\n');
    const symbols: SymbolExtract[] = [];
    const seen = new Set<string>();

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? '';
      // Module-level def (not indented)
      let m = /^def\s+(\w+)\s*\(([^)]*)\)/.exec(line);
      if (m && m[1] && !seen.has(m[1])) {
        seen.add(m[1]);
        symbols.push({ name: m[1], kind: 'function', line: i + 1, signature: `${m[1]}(${m[2] ?? ''})`, specIds: parseSpecIds(lines, i) });
        continue;
      }
      // Module-level class
      m = /^class\s+(\w+)/.exec(line);
      if (m && m[1] && !seen.has(m[1])) {
        seen.add(m[1]);
        symbols.push({ name: m[1], kind: 'class', line: i + 1, signature: m[1], specIds: parseSpecIds(lines, i) });
      }
    }

    return symbols;
  },

  extractPurpose(content: string): string | null {
    // Module docstring: first triple-quoted string
    const dq = /^(?:r|u|b)?"""([\s\S]*?)"""/.exec(content);
    if (dq?.[1]) return dq[1].trim().split('\n')[0]?.trim().slice(0, 120) ?? null;
    const sq = /^(?:r|u|b)?'''([\s\S]*?)'''/.exec(content);
    if (sq?.[1]) return sq[1].trim().split('\n')[0]?.trim().slice(0, 120) ?? null;
    // First # comment line at top
    const comment = /^#\s*(.+)/.exec(content.trimStart());
    if (comment?.[1] && !comment[1].startsWith('!')) return comment[1].trim().slice(0, 120);
    return null;
  },

  extractTags(content: string, filePath: string): string[] {
    return inferTagsFromText(content, filePath);
  },
};

// ── Go Extractor ──────────────────────────────────────────────────────────────

export const GoExtractor: LanguageExtractor = {
  language: 'Go',
  extensions: ['.go'],

  extractSymbols(content: string, _filePath: string): SymbolExtract[] {
    const lines = content.split('\n');
    const symbols: SymbolExtract[] = [];
    const seen = new Set<string>();

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? '';
      // Exported function (uppercase first letter)
      let m = /^func\s+(?:\(\w+\s+\*?\w+\)\s+)?([A-Z]\w*)\s*\(([^)]*)\)/.exec(line);
      if (m && m[1] && !seen.has(m[1])) {
        seen.add(m[1]);
        symbols.push({ name: m[1], kind: 'function', line: i + 1, signature: `${m[1]}(${m[2] ?? ''})`, specIds: parseSpecIds(lines, i) });
        continue;
      }
      // Exported type (struct, interface, alias)
      m = /^type\s+([A-Z]\w*)\s+(struct|interface|=)/.exec(line);
      if (m && m[1] && !seen.has(m[1])) {
        seen.add(m[1]);
        const kind = m[2] === 'interface' ? 'interface' : 'type';
        symbols.push({ name: m[1], kind, line: i + 1, signature: m[1], specIds: parseSpecIds(lines, i) });
      }
    }

    return symbols;
  },

  extractPurpose(content: string): string | null {
    // Package doc: "// Package <name> <description>" pattern
    const pkgDoc = /^\/\/\s*Package\s+\w+\s+(.+)/m.exec(content);
    if (pkgDoc?.[1]) return pkgDoc[1].trim().slice(0, 120);
    // First comment line
    const comment = /^\/\/\s*(.+)/m.exec(content);
    if (comment?.[1]) return comment[1].trim().slice(0, 120);
    return null;
  },

  extractTags(content: string, filePath: string): string[] {
    return inferTagsFromText(content, filePath);
  },
};

// ── Java Extractor ────────────────────────────────────────────────────────────

export const JavaExtractor: LanguageExtractor = {
  language: 'Java',
  extensions: ['.java'],

  extractSymbols(content: string, _filePath: string): SymbolExtract[] {
    const lines = content.split('\n');
    const symbols: SymbolExtract[] = [];
    const seen = new Set<string>();

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? '';
      // Public class / interface / enum
      let m = /^\s*public\s+(?:abstract\s+|final\s+)?(?:class|interface|enum)\s+(\w+)/.exec(line);
      if (m && m[1] && !seen.has(m[1])) {
        seen.add(m[1]);
        const kind = line.includes('interface') ? 'interface' : line.includes('enum') ? 'enum' : 'class';
        symbols.push({ name: m[1], kind, line: i + 1, signature: m[1], specIds: parseSpecIds(lines, i) });
        continue;
      }
      // Public/protected methods (not constructors — avoid overlap with class name)
      m = /^\s*(?:public|protected)\s+(?:static\s+)?(?:final\s+)?(?:[\w<>\[\]]+)\s+(\w+)\s*\(/.exec(line);
      if (m && m[1] && !seen.has(m[1]) && m[1] !== 'class') {
        seen.add(m[1]);
        symbols.push({ name: m[1], kind: 'method', line: i + 1, signature: m[1], specIds: parseSpecIds(lines, i) });
      }
    }

    return symbols;
  },

  extractPurpose(content: string): string | null {
    // First /** ... */ javadoc block (before class declaration)
    const javadoc = /\/\*\*\s*([\s\S]*?)\*\//.exec(content);
    if (javadoc?.[1]) {
      const text = javadoc[1]
        .replace(/^\s*\*\s?/gm, '').trim()
        .split('\n').find(l => l.trim().length > 5 && !l.trim().startsWith('@')) ?? '';
      if (text) return text.trim().slice(0, 120);
    }
    return null;
  },

  extractTags(content: string, filePath: string): string[] {
    return inferTagsFromText(content, filePath);
  },
};

// ── Rust Extractor ────────────────────────────────────────────────────────────

export const RustExtractor: LanguageExtractor = {
  language: 'Rust',
  extensions: ['.rs'],

  extractSymbols(content: string, _filePath: string): SymbolExtract[] {
    const lines = content.split('\n');
    const symbols: SymbolExtract[] = [];
    const seen = new Set<string>();

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? '';
      // pub fn
      let m = /^pub(?:\s*\(\w+\))?\s+(?:async\s+)?fn\s+(\w+)\s*(?:<[^>]*>)?\s*\(([^)]*)/.exec(line);
      if (m && m[1] && !seen.has(m[1])) {
        seen.add(m[1]);
        symbols.push({ name: m[1], kind: 'function', line: i + 1, signature: `${m[1]}(${(m[2] ?? '').slice(0, 60)})`, specIds: parseSpecIds(lines, i) });
        continue;
      }
      // pub struct
      m = /^pub(?:\s*\(\w+\))?\s+struct\s+(\w+)/.exec(line);
      if (m && m[1] && !seen.has(m[1])) {
        seen.add(m[1]);
        symbols.push({ name: m[1], kind: 'type', line: i + 1, signature: m[1], specIds: parseSpecIds(lines, i) });
        continue;
      }
      // pub trait
      m = /^pub(?:\s*\(\w+\))?\s+trait\s+(\w+)/.exec(line);
      if (m && m[1] && !seen.has(m[1])) {
        seen.add(m[1]);
        symbols.push({ name: m[1], kind: 'interface', line: i + 1, signature: m[1], specIds: parseSpecIds(lines, i) });
        continue;
      }
      // pub enum
      m = /^pub(?:\s*\(\w+\))?\s+enum\s+(\w+)/.exec(line);
      if (m && m[1] && !seen.has(m[1])) {
        seen.add(m[1]);
        symbols.push({ name: m[1], kind: 'enum', line: i + 1, signature: m[1], specIds: parseSpecIds(lines, i) });
      }
    }

    return symbols;
  },

  extractPurpose(content: string): string | null {
    // //! inner doc comment (module-level description)
    const innerDoc = /^\/\/!\s*(.+)/m.exec(content);
    if (innerDoc?.[1]) return innerDoc[1].trim().slice(0, 120);
    // /// outer doc comment (first item)
    const outerDoc = /^\/\/\/\s*(.+)/m.exec(content);
    if (outerDoc?.[1]) return outerDoc[1].trim().slice(0, 120);
    return null;
  },

  extractTags(content: string, filePath: string): string[] {
    return inferTagsFromText(content, filePath);
  },
};

// ── Ruby Extractor ────────────────────────────────────────────────────────────

export const RubyExtractor: LanguageExtractor = {
  language: 'Ruby',
  extensions: ['.rb'],

  extractSymbols(content: string, _filePath: string): SymbolExtract[] {
    const lines = content.split('\n');
    const symbols: SymbolExtract[] = [];
    const seen = new Set<string>();

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? '';
      // Module-level def (not indented)
      let m = /^def\s+(\w+[\?!]?)\s*(?:\(([^)]*)\))?/.exec(line);
      if (m && m[1] && !seen.has(m[1])) {
        seen.add(m[1]);
        symbols.push({ name: m[1], kind: 'function', line: i + 1, signature: `${m[1]}(${m[2] ?? ''})`, specIds: parseSpecIds(lines, i) });
        continue;
      }
      // class
      m = /^class\s+(\w+)/.exec(line);
      if (m && m[1] && !seen.has(m[1])) {
        seen.add(m[1]);
        symbols.push({ name: m[1], kind: 'class', line: i + 1, signature: m[1], specIds: parseSpecIds(lines, i) });
        continue;
      }
      // module
      m = /^module\s+(\w+)/.exec(line);
      if (m && m[1] && !seen.has(m[1])) {
        seen.add(m[1]);
        symbols.push({ name: m[1], kind: 'type', line: i + 1, signature: m[1], specIds: parseSpecIds(lines, i) });
      }
    }

    return symbols;
  },

  extractPurpose(content: string): string | null {
    const comment = /^#\s*(.+)/.exec(content.trimStart());
    if (comment?.[1] && !comment[1].startsWith('!') && !comment[1].startsWith('frozen')) {
      return comment[1].trim().slice(0, 120);
    }
    return null;
  },

  extractTags(content: string, filePath: string): string[] {
    return inferTagsFromText(content, filePath);
  },
};

// ── PHP Extractor ─────────────────────────────────────────────────────────────

export const PhpExtractor: LanguageExtractor = {
  language: 'PHP',
  extensions: ['.php'],

  extractSymbols(content: string, _filePath: string): SymbolExtract[] {
    const lines = content.split('\n');
    const symbols: SymbolExtract[] = [];
    const seen = new Set<string>();

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? '';
      // Global function or public class method
      let m = /^(?:public\s+(?:static\s+)?)?function\s+(\w+)\s*\(([^)]*)/.exec(line.trim());
      if (m && m[1] && m[1] !== '__construct' && !seen.has(m[1])) {
        seen.add(m[1]);
        symbols.push({ name: m[1], kind: 'function', line: i + 1, signature: `${m[1]}(${(m[2] ?? '').slice(0, 60)})`, specIds: parseSpecIds(lines, i) });
        continue;
      }
      // class
      m = /^class\s+(\w+)/.exec(line.trim());
      if (m && m[1] && !seen.has(m[1])) {
        seen.add(m[1]);
        symbols.push({ name: m[1], kind: 'class', line: i + 1, signature: m[1], specIds: parseSpecIds(lines, i) });
        continue;
      }
      // interface
      m = /^interface\s+(\w+)/.exec(line.trim());
      if (m && m[1] && !seen.has(m[1])) {
        seen.add(m[1]);
        symbols.push({ name: m[1], kind: 'interface', line: i + 1, signature: m[1], specIds: parseSpecIds(lines, i) });
      }
    }

    return symbols;
  },

  extractPurpose(content: string): string | null {
    // PHPDoc @summary or first /** description
    const phpdoc = /\/\*\*\s*([\s\S]*?)\*\//.exec(content);
    if (phpdoc?.[1]) {
      const summary = phpdoc[1]
        .replace(/^\s*\*\s?/gm, '').trim()
        .split('\n').find(l => l.trim().length > 5 && !l.trim().startsWith('@')) ?? '';
      if (summary) return summary.trim().slice(0, 120);
    }
    return null;
  },

  extractTags(content: string, filePath: string): string[] {
    return inferTagsFromText(content, filePath);
  },
};

// ── Extractor registry ────────────────────────────────────────────────────────

const EXTRACTORS: LanguageExtractor[] = [
  TypeScriptExtractor,
  PythonExtractor,
  GoExtractor,
  JavaExtractor,
  RustExtractor,
  RubyExtractor,
  PhpExtractor,
];

/** Returns the extractor for a given file extension, or null if unsupported. */
export function getExtractorForFile(filePath: string): LanguageExtractor | null {
  const ext = `.${filePath.split('.').pop()?.toLowerCase() ?? ''}`;
  return EXTRACTORS.find(e => e.extensions.includes(ext)) ?? null;
}

export { EXTRACTORS };
