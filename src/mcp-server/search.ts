/**
 * search.ts — searchFiles, buildFileTree, and prompt-intelligence helpers
 * for the AI OS MCP server.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './shared.js';
import type { IntentType, IntentResult, BoostPromptResult, ClarifyingQuestion } from '../types.js';
import { deriveSpecPrefix } from '../generators/spec-parser.js';

export function searchFiles(query: string, filePattern?: string, caseSensitive = false): string {
  try {
    const args = ['--yes', 'ripgrep'];
    if (!caseSensitive) args.push('--ignore-case');
    if (filePattern) args.push('-g', filePattern);
    args.push('--line-number', '--max-count=5', query, ROOT);

    const result = spawnSync('npx', args, { maxBuffer: 512 * 1024, timeout: 10000 });
    if (result.error) return 'No results found';
    const out = result.stdout?.toString() ?? '';
    return out.slice(0, 8000); // Cap output for token efficiency
  } catch {
    return 'No results found';
  }
}

const IGNORE_DIRS = new Set([
  'node_modules', '.git', '.next', '.nuxt', 'dist', 'build', 'out',
  '__pycache__', '.venv', 'venv', 'target', 'vendor', 'coverage',
  '.gradle', 'bin', 'obj', '.vs', 'packages', '.cache',
]);

export function buildFileTree(dir: string, depth = 0, maxDepth = 4): string[] {
  if (depth > maxDepth) return [];
  const prefix = '  '.repeat(depth);
  const lines: string[] = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
      .filter(e => !e.name.startsWith('.') || e.name === '.github')
      .filter(e => !IGNORE_DIRS.has(e.name))
      .sort((a, b) => {
        if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

    for (const entry of entries) {
      if (entry.isDirectory()) {
        lines.push(`${prefix}${entry.name}/`);
        lines.push(...buildFileTree(path.join(dir, entry.name), depth + 1, maxDepth));
      } else {
        lines.push(`${prefix}${entry.name}`);
      }
    }
  } catch { /* ignore permission errors */ }
  return lines;
}

// ── Prompt Intelligence helpers ────────────────────────────────────────────────

const ACTION_VERBS = [
  'create', 'add', 'build', 'implement', 'generate', 'make',
  'update', 'change', 'modify', 'edit', 'refactor', 'rename', 'move',
  'delete', 'remove', 'drop', 'fix', 'repair', 'debug', 'resolve',
  'migrate', 'upgrade', 'bump', 'install', 'configure', 'setup',
  'test', 'write', 'document', 'deploy', 'publish', 'run', 'start',
];

const COMPONENT_TERMS = [
  'file', 'function', 'method', 'class', 'component', 'module', 'service',
  'endpoint', 'route', 'controller', 'model', 'schema', 'table', 'column',
  'field', 'hook', 'util', 'helper', 'type', 'interface', 'store', 'action',
  'page', 'view', 'widget', 'form', 'button', 'modal', 'layout', 'style',
  'workflow', 'pipeline', 'job', 'task', 'queue', 'config', 'env',
];

const DOMAIN_TERMS = [
  'auth', 'authentication', 'authorization', 'login', 'logout', 'session', 'token',
  'database', 'db', 'sql', 'query', 'migration', 'api', 'rest', 'graphql', 'grpc',
  'ui', 'frontend', 'backend', 'testing', 'test', 'ci', 'cd', 'deploy', 'docker',
  'security', 'performance', 'cache', 'cache', 'payment', 'stripe', 'email',
  'notification', 'logging', 'monitoring', 'analytics', 'search', 'upload',
];

const INTENT_PATTERNS: Array<{
  keywords: string[];
  intentType: IntentType;
  domains: string[];
  clarifyingQuestion: string | null;
  suggestedSkill: string | null;
}> = [
  {
    keywords: ['spec', 'design', 'feature', 'implement', 'build', 'create', 'add'],
    intentType: 'new-feature',
    domains: [],
    clarifyingQuestion: 'Spec-driven workflow or quick local addition?',
    suggestedSkill: 'brainstorming',
  },
  {
    keywords: ['fix', 'bug', 'error', 'crash', 'broken', 'failing', 'repair', 'resolve'],
    intentType: 'bug-fix',
    domains: [],
    clarifyingQuestion: 'Tracked issue or quick local fix?',
    suggestedSkill: 'systematic-debugging',
  },
  {
    keywords: ['refactor', 'cleanup', 'reorganize', 'extract', 'restructure', 'simplify'],
    intentType: 'refactor',
    domains: [],
    clarifyingQuestion: 'Systematic refactor (needs plan) or focused local improvement?',
    suggestedSkill: 'writing-plans',
  },
  {
    keywords: ['schema', 'table', 'migration', 'column', 'model', 'database', 'migrate'],
    intentType: 'db-change',
    domains: ['database'],
    clarifyingQuestion: 'Spec-driven schema change or one-time local edit?',
    suggestedSkill: 'writing-plans',
  },
  {
    keywords: ['test', 'spec', 'coverage', 'unit test', 'integration test'],
    intentType: 'test-addition',
    domains: ['testing'],
    clarifyingQuestion: null,
    suggestedSkill: 'test-driven-development',
  },
  {
    keywords: ['upgrade', 'update', 'bump', 'dependency', 'version', 'install', 'package'],
    intentType: 'dependency-update',
    domains: [],
    clarifyingQuestion: 'Planned upgrade or quick patch?',
    suggestedSkill: null,
  },
  {
    keywords: ['doc', 'docs', 'document', 'readme', 'comment', 'jsdoc', 'typedoc'],
    intentType: 'docs-update',
    domains: [],
    clarifyingQuestion: null,
    suggestedSkill: null,
  },
  {
    keywords: ['config', 'configure', 'setting', 'env', 'environment', 'ci', 'cd', 'workflow'],
    intentType: 'config-change',
    domains: [],
    clarifyingQuestion: null,
    suggestedSkill: null,
  },
];

const BYPASS_PHRASES = ['just ', 'quickly ', 'only ', 'fix typo', 'rename '];

/**
 * Returns a vagueness score 0–5 for the given prompt.
 * Score ≥ 3 triggers the Prompt Booster clarification flow.
 */
export function scoreVagueness(prompt: string): number {
  const lower = prompt.toLowerCase().trim();
  let score = 0;

  // Short prompt contributes up to +2
  const wordCount = lower.split(/\s+/).filter(Boolean).length;
  if (wordCount < 10) score += 2;

  // No recognisable action verb
  if (!ACTION_VERBS.some((v) => lower.includes(v))) score += 1;

  // No component/file reference
  if (!COMPONENT_TERMS.some((t) => lower.includes(t))) score += 1;

  // No domain keyword
  if (!DOMAIN_TERMS.some((d) => lower.includes(d))) score += 1;

  return Math.min(score, 5);
}

/**
 * Builds up to 3 clarifying questions for a vague prompt.
 * Only returns questions for dimensions that are actually missing.
 */
export function buildClarifyingQuestions(prompt: string): ClarifyingQuestion[] {
  const lower = prompt.toLowerCase().trim();
  const questions: ClarifyingQuestion[] = [];

  const hasWhat = ACTION_VERBS.some((v) => lower.includes(v)) &&
    (COMPONENT_TERMS.some((t) => lower.includes(t)) || lower.length > 30);
  const hasWhere = DOMAIN_TERMS.some((d) => lower.includes(d)) ||
    lower.includes('frontend') || lower.includes('backend') || lower.includes('api');
  const hasHow = lower.includes('new') || lower.includes('change') || lower.includes('exist') ||
    lower.includes('migrat') || lower.includes('add') || lower.includes('replac');

  if (!hasWhat) {
    questions.push({
      id: 'what',
      text: 'What specifically should happen or change?',
      required: true,
    });
  }
  if (!hasWhere && questions.length < 3) {
    questions.push({
      id: 'where',
      text: 'Which layer is affected — database, API, service, or frontend?',
      choices: ['Database / schema', 'API / backend service', 'Frontend / UI', 'Cross-cutting / multiple'],
      required: false,
    });
  }
  if (!hasHow && questions.length < 3) {
    questions.push({
      id: 'how',
      text: 'Is this a new addition, a change to existing code, or a migration?',
      choices: ['New addition', 'Change to existing code', 'Migration / upgrade', 'Not sure yet'],
      required: false,
    });
  }

  return questions.slice(0, 3);
}

/**
 * Classifies the intent of a prompt based on keyword matching.
 * Works without repo-index — falls back to keyword-only classification.
 */
export function classifyIntent(prompt: string): IntentResult {
  const lower = prompt.toLowerCase();

  // Score every pattern; pick the one with the most keyword matches (ties: first in order wins)
  let bestPattern: (typeof INTENT_PATTERNS)[number] | null = null;
  let bestMatchCount = 0;
  let bestMatched: string[] = [];

  for (const pattern of INTENT_PATTERNS) {
    const matched = pattern.keywords.filter((k) => lower.includes(k));
    if (matched.length > bestMatchCount) {
      bestMatchCount = matched.length;
      bestPattern = pattern;
      bestMatched = matched;
    }
  }

  if (bestPattern !== null && bestMatchCount > 0) {
    const confidence: IntentResult['confidence'] =
      bestMatchCount >= 3 ? 'high' : bestMatchCount >= 2 ? 'medium' : 'low';

    const affectedDomain = [
      ...bestPattern.domains,
      ...DOMAIN_TERMS.filter((d) => lower.includes(d)),
    ].filter((v, i, arr) => arr.indexOf(v) === i).slice(0, 4);

    return {
      intentType: bestPattern.intentType,
      confidence,
      affectedDomain,
      suggestedSkill: bestPattern.suggestedSkill,
      clarifyingQuestion: bestPattern.clarifyingQuestion,
      reasoning: `Matched keywords: ${bestMatched.join(', ')}`,
    };
  }

  // Fallback: quick-edit for short, unclassified prompts
  return {
    intentType: 'quick-edit',
    confidence: 'low',
    affectedDomain: DOMAIN_TERMS.filter((d) => lower.includes(d)).slice(0, 4),
    suggestedSkill: null,
    clarifyingQuestion: null,
    reasoning: 'No strong intent pattern matched — treating as quick edit.',
  };
}

/**
 * Runs the full Prompt Booster pipeline:
 * 1. Score vagueness.
 * 2. If score ≥ 3 and not bypassed, surface clarifying questions.
 * 3. Return result; the MCP handler formats the confirmation message.
 *
 * Gracefully degrades when repo-index.jsonl is absent (keyword-only mode).
 */
export function boostPrompt(prompt: string, activeFile?: string): BoostPromptResult {
  const lower = prompt.toLowerCase().trim();

  // Bypass conditions — do not trigger booster
  const bypassed =
    BYPASS_PHRASES.some((p) => lower.startsWith(p) || lower.includes(p)) ||
    /[./\\]/.test(prompt.slice(0, 40)) || // starts with file path
    (activeFile !== undefined && activeFile.length > 0);

  const score = scoreVagueness(prompt);
  const triggered = !bypassed && score >= 3;

  if (!triggered) {
    return {
      vaguenessScore: score,
      triggered: false,
      questions: [],
    };
  }

  const questions = buildClarifyingQuestions(prompt);
  const intent = classifyIntent(prompt);

  return {
    vaguenessScore: score,
    triggered: true,
    questions,
    affectedDomain: intent.affectedDomain,
    suggestedSkill: intent.suggestedSkill ?? undefined,
    confirmationMessage:
      'I need a little more information to help precisely. Please answer the question(s) below, then I\'ll synthesize an optimized prompt for your confirmation before acting.',
  };
}

/** Reads the project repo-index.jsonl if it exists; returns null otherwise. */
export function readRepoIndex(projectRoot: string): string | null {
  const indexPath = path.join(projectRoot, '.github', 'ai-os', 'context', 'repo-index.jsonl');
  try {
    if (fs.existsSync(indexPath)) return fs.readFileSync(indexPath, 'utf-8');
  } catch { /* ignore */ }
  return null;
}

interface IndexEntry { type: string; [key: string]: unknown }

function parseIndexEntries(raw: string): IndexEntry[] {
  return raw.split('\n').filter(Boolean).map(l => {
    try { return JSON.parse(l) as IndexEntry; } catch { return null; }
  }).filter((e): e is IndexEntry => e !== null);
}

export interface SymbolSearchResult {
  name: string;
  kind: string;
  file: string;
  line: number;
  signature: string | null;
  tags: string[];
}

/**
 * Searches symbols in the repo index by name/kind/tag.
 * Falls back gracefully when no index file is present.
 */
export function searchSymbols(
  projectRoot: string,
  query: string,
  kind?: string,
  tag?: string,
): SymbolSearchResult[] | null {
  const raw = readRepoIndex(projectRoot);
  if (!raw) return null; // null = index does not exist yet

  const lower = query.toLowerCase();
  const entries = parseIndexEntries(raw);

  const results: SymbolSearchResult[] = [];
  for (const entry of entries) {
    if (entry.type !== 'symbol') continue;
    const name = (entry['name'] as string | undefined) ?? '';
    const entryKind = (entry['kind'] as string | undefined) ?? '';
    const tags = (entry['tags'] as string[] | undefined) ?? [];

    if (!name.toLowerCase().includes(lower)) continue;
    if (kind && entryKind !== kind) continue;
    if (tag && !tags.includes(tag)) continue;

    results.push({
      name,
      kind: entryKind,
      file: (entry['file'] as string | undefined) ?? '',
      line: (entry['line'] as number | undefined) ?? 0,
      signature: (entry['signature'] as string | null | undefined) ?? null,
      tags,
    });

    if (results.length >= 30) break;
  }

  return results;
}

export interface FilePurposeResult {
  path: string;
  language: string;
  purpose: string | null;
  exports: string[];
  tags: string[];
  size: number;
}

export type FilePurposeNotFound = { notFound: true; noIndex: boolean };

/**
 * Returns purpose, exports, and tags for a specific file path from the index.
 * Returns `{ notFound: true, noIndex: true }` when no index has been built,
 * `{ notFound: true, noIndex: false }` when the index exists but the file is not in it,
 * or a `FilePurposeResult` on success.
 */
export function getFilePurpose(
  projectRoot: string,
  filePath: string,
): FilePurposeResult | FilePurposeNotFound {
  const raw = readRepoIndex(projectRoot);
  if (!raw) return { notFound: true, noIndex: true };

  const normalised = filePath.replace(/\\/g, '/');
  const entries = parseIndexEntries(raw);

  for (const entry of entries) {
    if (entry.type !== 'file') continue;
    const p = ((entry['path'] as string | undefined) ?? '').replace(/\\/g, '/');
    if (p === normalised || p.endsWith(`/${normalised}`)) {
      return {
        path: p,
        language: (entry['language'] as string | undefined) ?? 'Unknown',
        purpose: (entry['purpose'] as string | null | undefined) ?? null,
        exports: (entry['exports'] as string[] | undefined) ?? [],
        tags: (entry['tags'] as string[] | undefined) ?? [],
        size: (entry['size'] as number | undefined) ?? 0,
      };
    }
  }

  return { notFound: true, noIndex: false };
}

export interface SpecCoverageGroup {
  specPrefix: string;
  specFile: string;
  covered: number;
  total: number;
  ratio: number;
  requirements: Array<{
    specId: string;
    title: string;
    implemented: boolean;
    implementedBy: string[];
  }>;
}

/**
 * Groups SpecIndexEntry records by spec file and computes per-file coverage.
 * Falls back gracefully when no index file exists.
 */
export function validateSpecCoverage(projectRoot: string): SpecCoverageGroup[] {
  const raw = readRepoIndex(projectRoot);
  if (!raw) return [];

  const entries = parseIndexEntries(raw);
  const specEntries = entries.filter(e => e.type === 'spec');
  if (specEntries.length === 0) return [];

  const byFile = new Map<string, typeof specEntries>();
  for (const e of specEntries) {
    const file = (e['specFile'] as string | undefined) ?? 'unknown';
    if (!byFile.has(file)) byFile.set(file, []);
    byFile.get(file)!.push(e);
  }

  const results: SpecCoverageGroup[] = [];
  for (const [specFile, reqs] of byFile) {
    const requirements = reqs.map(e => {
      const rawBy = e['implementedBy'];
      const implementedBy: string[] = Array.isArray(rawBy)
        ? (rawBy as unknown[]).filter((x): x is string => typeof x === 'string')
        : [];
      return {
        specId: (e['specId'] as string | undefined) ?? '',
        title: (e['title'] as string | undefined) ?? '',
        implemented: implementedBy.length > 0,
        implementedBy,
      };
    });
    const covered = requirements.filter(r => r.implemented).length;
    results.push({
      specPrefix: deriveSpecPrefix(specFile),
      specFile,
      covered,
      total: requirements.length,
      ratio: requirements.length > 0 ? covered / requirements.length : 0,
      requirements,
    });
  }

  return results.sort((a, b) => a.specFile.localeCompare(b.specFile));
}

export interface SpecForFileEntry {
  specId: string;
  title: string;
  specFile: string;
}

/**
 * Returns spec requirements implemented by a given file path.
 * Falls back gracefully when no index file exists.
 * Accepts both relative and absolute paths.
 */
export function getSpecForFile(projectRoot: string, filePath: string): SpecForFileEntry[] {
  const raw = readRepoIndex(projectRoot);
  if (!raw) return [];

  // Normalise to forward slashes; strip projectRoot prefix if absolute path supplied
  const root = projectRoot.replace(/\\/g, '/').replace(/\/$/, '');
  let normalised = filePath.replace(/\\/g, '/');
  if (normalised.startsWith(root + '/')) normalised = normalised.slice(root.length + 1);

  const entries = parseIndexEntries(raw);
  const results: SpecForFileEntry[] = [];

  for (const entry of entries) {
    if (entry.type !== 'spec') continue;
    const rawBy = entry['implementedBy'];
    const implementedBy: string[] = Array.isArray(rawBy)
      ? (rawBy as unknown[]).filter((x): x is string => typeof x === 'string')
      : [];
    const isImplemented = implementedBy.some(f => {
      const fn = f.replace(/\\/g, '/');
      return fn === normalised || fn.endsWith(`/${normalised}`);
    });
    if (isImplemented) {
      results.push({
        specId: (entry['specId'] as string | undefined) ?? '',
        title: (entry['title'] as string | undefined) ?? '',
        specFile: (entry['specFile'] as string | undefined) ?? '',
      });
    }
  }

  return results;
}
