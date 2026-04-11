import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = process.env['AI_OS_ROOT'] ?? process.cwd();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function getProjectRoot(): string {
  return path.resolve(ROOT);
}

export function readAiOsFile(relPath: string): string {
  try {
    const newPath = path.join(ROOT, '.github', 'ai-os', relPath);
    if (fs.existsSync(newPath)) return fs.readFileSync(newPath, 'utf-8');
    // Legacy fallback
    return fs.readFileSync(path.join(ROOT, '.ai-os', relPath), 'utf-8');
  } catch {
    return '';
  }
}

interface RepoMemoryEntry {
  id: string;
  createdAt: string;
  updatedAt?: string;
  title: string;
  content: string;
  category: string;
  tags: string[];
  fingerprint?: string;
  status?: 'active' | 'stale';
  staleReason?: string;
  supersedesId?: string;
  conflictWithId?: string;
}

interface MemoryReadResult {
  entries: RepoMemoryEntry[];
  malformedCount: number;
}

const MEMORY_STALE_DAYS = 180;
const MEMORY_LOCK_WAIT_MS = 2000;
const MEMORY_LOCK_RETRY_MS = 50;

function getMemoryFilePath(): string {
  const newPath = path.join(ROOT, '.github', 'ai-os', 'memory', 'memory.jsonl');
  const legacyPath = path.join(ROOT, '.ai-os', 'memory', 'memory.jsonl');
  return fs.existsSync(newPath) || !fs.existsSync(legacyPath) ? newPath : legacyPath;
}

function getMemoryDirPath(): string {
  const newPath = path.join(ROOT, '.github', 'ai-os', 'memory');
  const legacyPath = path.join(ROOT, '.ai-os', 'memory');
  return fs.existsSync(newPath) || !fs.existsSync(legacyPath) ? newPath : legacyPath;
}

function getMemoryLockFilePath(): string {
  return path.join(getMemoryDirPath(), '.memory.lock');
}

function ensureMemoryStore(): void {
  const memoryDir = getMemoryDirPath();
  if (!fs.existsSync(memoryDir)) {
    fs.mkdirSync(memoryDir, { recursive: true });
  }

  const memoryFile = getMemoryFilePath();
  if (!fs.existsSync(memoryFile)) {
    fs.writeFileSync(memoryFile, '', 'utf-8');
  }
}

function sleepSync(ms: number): void {
  const shared = new SharedArrayBuffer(4);
  const int32 = new Int32Array(shared);
  Atomics.wait(int32, 0, 0, ms);
}

function withMemoryLock<T>(fn: () => T): T {
  ensureMemoryStore();
  const lockPath = getMemoryLockFilePath();
  const startedAt = Date.now();
  let lockFd: number | null = null;

  while (Date.now() - startedAt < MEMORY_LOCK_WAIT_MS) {
    try {
      lockFd = fs.openSync(lockPath, 'wx');
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw err;
      }
      sleepSync(MEMORY_LOCK_RETRY_MS);
    }
  }

  if (lockFd === null) {
    throw new Error('Timed out waiting for repository memory lock.');
  }

  try {
    return fn();
  } finally {
    try {
      fs.closeSync(lockFd);
    } catch {
      // Best-effort cleanup.
    }

    try {
      fs.unlinkSync(lockPath);
    } catch {
      // Best-effort cleanup.
    }
  }
}

function normalizeWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function normalizeMemoryText(value: string): string {
  return normalizeWhitespace(value).toLowerCase();
}

function normalizeTags(tags: string[]): string[] {
  return [...new Set(tags.map((tag) => normalizeMemoryText(tag)).filter(Boolean))].sort();
}

function buildMemoryKey(entry: Pick<RepoMemoryEntry, 'title' | 'category'>): string {
  return `${normalizeMemoryText(entry.category)}::${normalizeMemoryText(entry.title)}`;
}

function buildFingerprint(entry: Pick<RepoMemoryEntry, 'title' | 'category' | 'content'>): string {
  return `${buildMemoryKey(entry)}::${normalizeMemoryText(entry.content)}`;
}

function toIsoDate(dateValue?: string): string {
  const parsed = dateValue ? new Date(dateValue) : new Date();
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

function ageInDays(isoDate: string): number {
  const dt = new Date(isoDate);
  if (Number.isNaN(dt.getTime())) return 0;
  return Math.floor((Date.now() - dt.getTime()) / (1000 * 60 * 60 * 24));
}

function canonicalizeEntry(raw: Partial<RepoMemoryEntry>): RepoMemoryEntry | null {
  const title = typeof raw.title === 'string' ? normalizeWhitespace(raw.title) : '';
  const content = typeof raw.content === 'string' ? normalizeWhitespace(raw.content) : '';
  if (!title || !content) return null;

  const category = typeof raw.category === 'string' && raw.category.trim()
    ? normalizeMemoryText(raw.category)
    : 'general';

  const createdAt = toIsoDate(raw.createdAt);
  const updatedAt = raw.updatedAt ? toIsoDate(raw.updatedAt) : undefined;
  const id = typeof raw.id === 'string' && raw.id.trim()
    ? raw.id.trim()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const tags = normalizeTags(Array.isArray(raw.tags) ? raw.tags.filter((tag): tag is string => typeof tag === 'string') : []);
  const status = raw.status === 'stale' ? 'stale' : 'active';
  const fingerprint = buildFingerprint({ title, content, category });

  return {
    id,
    createdAt,
    updatedAt,
    title,
    content,
    category,
    tags,
    fingerprint,
    status,
    staleReason: typeof raw.staleReason === 'string' ? raw.staleReason : undefined,
    supersedesId: typeof raw.supersedesId === 'string' ? raw.supersedesId : undefined,
    conflictWithId: typeof raw.conflictWithId === 'string' ? raw.conflictWithId : undefined,
  };
}

function sortByRecencyDesc(a: RepoMemoryEntry, b: RepoMemoryEntry): number {
  const aTime = new Date(a.updatedAt ?? a.createdAt).getTime();
  const bTime = new Date(b.updatedAt ?? b.createdAt).getTime();
  return bTime - aTime;
}

function applyStalePolicy(entries: RepoMemoryEntry[]): RepoMemoryEntry[] {
  const byKey = new Map<string, RepoMemoryEntry[]>();
  for (const entry of entries) {
    const key = buildMemoryKey(entry);
    const list = byKey.get(key) ?? [];
    list.push(entry);
    byKey.set(key, list);
  }

  for (const [, list] of byKey) {
    list.sort(sortByRecencyDesc);
    let activeSeen = false;
    for (const entry of list) {
      if (entry.status === 'stale') continue;

      if (!activeSeen) {
        activeSeen = true;
        continue;
      }

      entry.status = 'stale';
      entry.staleReason = entry.staleReason ?? 'superseded-by-newer-entry';
      entry.updatedAt = toIsoDate(entry.updatedAt);
    }
  }

  for (const entry of entries) {
    if (entry.status === 'stale') continue;
    if (ageInDays(entry.updatedAt ?? entry.createdAt) > MEMORY_STALE_DAYS) {
      entry.status = 'stale';
      entry.staleReason = entry.staleReason ?? `auto-stale-${MEMORY_STALE_DAYS}d`;
      entry.updatedAt = toIsoDate(entry.updatedAt);
    }
  }

  return entries;
}

function dedupeEntries(entries: RepoMemoryEntry[]): RepoMemoryEntry[] {
  const seen = new Map<string, RepoMemoryEntry>();
  const ordered = [...entries].sort(sortByRecencyDesc);

  for (const entry of ordered) {
    const dedupeKey = `${entry.fingerprint ?? buildFingerprint(entry)}::${entry.status ?? 'active'}`;
    if (!seen.has(dedupeKey)) {
      seen.set(dedupeKey, entry);
      continue;
    }

    const kept = seen.get(dedupeKey)!;
    kept.tags = normalizeTags([...kept.tags, ...entry.tags]);
  }

  return [...seen.values()].sort(sortByRecencyDesc);
}

function serializeEntries(entries: RepoMemoryEntry[]): string {
  return entries.map((entry) => JSON.stringify(entry)).join('\n') + (entries.length > 0 ? '\n' : '');
}

function writeMemoryEntriesAtomic(entries: RepoMemoryEntry[]): void {
  const memoryPath = getMemoryFilePath();
  const tempPath = `${memoryPath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tempPath, serializeEntries(entries), 'utf-8');
  fs.renameSync(tempPath, memoryPath);
}

function readMemoryEntries(): MemoryReadResult {
  ensureMemoryStore();
  const file = getMemoryFilePath();
  const content = fs.readFileSync(file, 'utf-8');
  const lines = content.split('\n').map((line) => line.trim()).filter(Boolean);
  const entries: RepoMemoryEntry[] = [];
  let malformedCount = 0;

  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as Partial<RepoMemoryEntry>;
      const canonical = canonicalizeEntry(parsed);
      if (canonical) entries.push(canonical);
      else malformedCount += 1;
    } catch {
      malformedCount += 1;
    }
  }

  return {
    entries: applyStalePolicy(dedupeEntries(entries)),
    malformedCount,
  };
}

function recoverMalformedMemoryIfNeeded(result: MemoryReadResult): void {
  if (result.malformedCount <= 0) return;
  writeMemoryEntriesAtomic(result.entries);
}

export function getMemoryGuidelines(): string {
  const guidelines = readAiOsFile('context/memory.md');
  return guidelines || 'No memory guidelines found. Re-run AI OS generation to create .github/ai-os/context/memory.md.';
}

export function getRepoMemory(query?: string, category?: string, limit?: number): string {
  const { entries, malformedCount } = readMemoryEntries();
  const q = (query ?? '').trim().toLowerCase();
  const c = (category ?? '').trim().toLowerCase();
  const cap = Math.max(1, Math.min(limit ?? 10, 50));

  const filtered = entries
    .filter((entry) => {
      if (c && entry.category.toLowerCase() !== c) return false;
      if (!q) return true;

      const haystack = [entry.title, entry.content, entry.category, ...entry.tags]
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    })
    .slice(-cap)
    .reverse();

  if (filtered.length === 0) {
    return 'No repository memory entries found for the provided filters.';
  }

  const activeCount = entries.filter((entry) => entry.status !== 'stale').length;
  const staleCount = entries.length - activeCount;

  const lines: string[] = [
    '## Repository Memory',
    '',
    `- Total entries: ${entries.length}`,
    `- Active: ${activeCount}`,
    `- Stale: ${staleCount}`,
  ];

  if (malformedCount > 0) {
    lines.push(`- Malformed lines skipped: ${malformedCount} (recovery is applied on next write)`);
  }

  for (const entry of filtered) {
    lines.push('');
    const state = entry.status === 'stale' ? 'stale' : 'active';
    lines.push(`- **${entry.title}** [${entry.category}] (${state})`);
    lines.push(`  - Created: ${entry.createdAt}`);
    lines.push(`  - Updated: ${entry.updatedAt ?? entry.createdAt}`);
    if (entry.tags.length > 0) {
      lines.push(`  - Tags: ${entry.tags.join(', ')}`);
    }
    if (entry.staleReason) {
      lines.push(`  - Stale reason: ${entry.staleReason}`);
    }
    if (entry.conflictWithId) {
      lines.push(`  - Conflict marker: supersedes ${entry.conflictWithId}`);
    }
    lines.push(`  - ${entry.content}`);
  }

  return lines.join('\n');
}

export function rememberRepoFact(title: string, content: string, category?: string, tags?: string): string {
  const trimmedTitle = title.trim();
  const trimmedContent = content.trim();
  if (!trimmedTitle || !trimmedContent) {
    return 'Both title and content are required to store memory.';
  }

  try {
    return withMemoryLock(() => {
      const now = new Date().toISOString();
      const incoming = canonicalizeEntry({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        createdAt: now,
        updatedAt: now,
        title: trimmedTitle,
        content: trimmedContent,
        category: category?.trim() || 'general',
        tags: (tags ?? '').split(',').map((tag) => tag.trim()),
        status: 'active',
      });

      if (!incoming) {
        return 'Invalid memory payload. Title and content are required.';
      }

      const parsed = readMemoryEntries();
      const entries = parsed.entries;
      recoverMalformedMemoryIfNeeded(parsed);

      const key = buildMemoryKey(incoming);
      const sameKey = entries
        .filter((entry) => buildMemoryKey(entry) === key)
        .sort(sortByRecencyDesc);

      const sameFingerprint = sameKey.find((entry) => (entry.fingerprint ?? buildFingerprint(entry)) === incoming.fingerprint);
      if (sameFingerprint) {
        const mergedTags = normalizeTags([...sameFingerprint.tags, ...incoming.tags]);
        const tagsChanged = mergedTags.length !== sameFingerprint.tags.length;

        if (tagsChanged) {
          sameFingerprint.tags = mergedTags;
          sameFingerprint.updatedAt = now;
          writeMemoryEntriesAtomic(dedupeEntries(applyStalePolicy(entries)));
          return `Updated memory tags for existing fact: ${sameFingerprint.title} (${sameFingerprint.category})`;
        }

        return `Skipped duplicate memory fact: ${sameFingerprint.title} (${sameFingerprint.category})`;
      }

      const currentActive = sameKey.find((entry) => entry.status !== 'stale');
      if (currentActive) {
        currentActive.status = 'stale';
        currentActive.staleReason = 'superseded-by-conflicting-update';
        currentActive.updatedAt = now;
        incoming.supersedesId = currentActive.id;
        incoming.conflictWithId = currentActive.id;
      }

      entries.push(incoming);

      const normalized = dedupeEntries(applyStalePolicy(entries));
      writeMemoryEntriesAtomic(normalized);

      if (currentActive) {
        return `Stored memory entry with conflict marker: ${incoming.title} (${incoming.category})`;
      }

      return `Stored memory entry: ${incoming.title} (${incoming.category})`;
    });
  } catch (err) {
    return `Failed to store memory entry: ${err instanceof Error ? err.message : String(err)}`;
  }
}

export function searchFiles(query: string, filePattern?: string, caseSensitive = false): string {
  try {
    const flags = caseSensitive ? '' : '-i';
    const globArg = filePattern ? `-g "${filePattern}"` : '';
    const cmd = `npx --yes ripgrep ${flags} ${globArg} --line-number --max-count=5 "${query}" "${ROOT}"`;
    const result = execSync(cmd, { maxBuffer: 512 * 1024, timeout: 10000 }).toString();
    return result.slice(0, 8000); // Cap output for token efficiency
  } catch (err) {
    if (err instanceof Error && 'stdout' in err) {
      return String((err as NodeJS.ErrnoException & { stdout: Buffer }).stdout ?? 'No results found');
    }
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

export function getPrismaSchema(): string {
  const candidates = ['prisma/schema.prisma', 'schema.prisma', 'db/schema.prisma'];
  for (const rel of candidates) {
    const abs = path.join(ROOT, rel);
    if (fs.existsSync(abs)) {
      return fs.readFileSync(abs, 'utf-8');
    }
  }
  return 'Prisma schema not found';
}

export function getTrpcProcedures(): string {
  const candidates = ['src/trpc/index.ts', 'src/server/trpc.ts', 'server/trpc.ts'];
  for (const rel of candidates) {
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) continue;
    const content = fs.readFileSync(abs, 'utf-8');
    const lines = content.split('\n');
    const procedures: string[] = [];
    for (const line of lines) {
      const m = line.match(/^\s+(\w+):\s+(public|private)Procedure/);
      if (m) procedures.push(`- ${m[1]} (${m[2]})`);
    }
    if (procedures.length > 0) {
      return `**tRPC Procedures** (from ${rel}):\n${procedures.join('\n')}`;
    }
    return `Found router at ${rel} but could not parse procedures. First 50 lines:\n\`\`\`\n${lines.slice(0, 50).join('\n')}\n\`\`\``;
  }
  return 'tRPC router not found';
}

export function getApiRoutes(filter?: string): string {
  const routes = new Set<string>();

  function addRoute(route: string): void {
    const trimmed = route.trim();
    if (!trimmed) return;
    routes.add(trimmed);
  }

  // Next.js app router route handlers
  const apiDir = path.join(ROOT, 'src/app/api');
  function scanNextApiDir(dir: string, prefix = ''): void {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          scanNextApiDir(path.join(dir, entry.name), `${prefix}/${entry.name}`);
          continue;
        }
        if (entry.name !== 'route.ts' && entry.name !== 'route.js') continue;

        const content = fs.readFileSync(path.join(dir, entry.name), 'utf-8');
        const methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].filter((m) =>
          new RegExp(`export\\s+(?:async\\s+)?function\\s+${m}`).test(content),
        );
        if (methods.length === 0) continue;
        const route = prefix.replace(/\/\[([^\]]+)\]/g, '/:$1');
        addRoute(`${methods.join(', ')} ${route}`);
      }
    } catch {
      // ignore
    }
  }
  if (fs.existsSync(apiDir)) {
    scanNextApiDir(apiDir, '/api');
  }

  // Generic regex scan for Python/Java/Go/Rust routing constructs
  const scanPatterns: Array<{ glob: string; patterns: RegExp[] }> = [
    {
      glob: '*.py',
      patterns: [
        /@(app|router)\.(get|post|put|patch|delete)\(['"]([^'"]+)['"]/g,
        /path\(['"]([^'"]+)['"],/g,
      ],
    },
    {
      glob: '*.java',
      patterns: [
        /@(?:Get|Post|Put|Patch|Delete|Request)Mapping\(([^)]*)\)/g,
      ],
    },
    {
      glob: '*.go',
      patterns: [
        /\.(GET|POST|PUT|PATCH|DELETE)\("([^"]+)"/g,
        /HandleFunc\("([^"]+)"/g,
      ],
    },
    {
      glob: '*.rs',
      patterns: [
        /#\[(get|post|put|patch|delete)\("([^"]+)"\)\]/g,
        /route\("([^"]+)",\s*(get|post|put|patch|delete)/g,
      ],
    },
    {
      glob: '*.{ts,js}',
      patterns: [
        /router\.(get|post|put|patch|delete)\(['"]([^'"]+)['"]/g,
        /app\.(get|post|put|patch|delete)\(['"]([^'"]+)['"]/g,
      ],
    },
  ];

  for (const scan of scanPatterns) {
    try {
      const cmd = `npx --yes ripgrep --files -g "${scan.glob}" "${ROOT}"`;
      const files = execSync(cmd, { maxBuffer: 1024 * 1024, timeout: 12000 }).toString().split('\n').filter(Boolean);

      for (const file of files.slice(0, 300)) {
        let content = '';
        try {
          content = fs.readFileSync(file, 'utf-8');
        } catch {
          continue;
        }

        for (const pattern of scan.patterns) {
          const matches = content.matchAll(pattern);
          for (const match of matches) {
            if (scan.glob === '*.java') {
              const mappingArgs = match[1] ?? '';
              const methodMatch = mappingArgs.match(/RequestMethod\.(GET|POST|PUT|PATCH|DELETE)/);
              const method = methodMatch?.[1] ?? (match[0].includes('GetMapping') ? 'GET' : match[0].includes('PostMapping') ? 'POST' : match[0].includes('PutMapping') ? 'PUT' : match[0].includes('PatchMapping') ? 'PATCH' : match[0].includes('DeleteMapping') ? 'DELETE' : 'REQUEST');
              const pathMatch = mappingArgs.match(/['"]([^'"]+)['"]/);
              if (pathMatch) addRoute(`${method} ${pathMatch[1]}`);
              continue;
            }

            const method = (match[2] ?? match[1] ?? '').toString().toUpperCase();
            const routePath = (match[3] ?? match[2] ?? match[1] ?? '').toString();
            if (!routePath.startsWith('/')) continue;

            if (['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
              addRoute(`${method} ${routePath}`);
            } else {
              addRoute(`ROUTE ${routePath}`);
            }
          }
        }
      }
    } catch {
      // ignore scan errors
    }
  }

  const result = [...routes].sort();
  const filtered = filter ? result.filter((route) => route.toLowerCase().includes(filter.toLowerCase())) : result;
  return filtered.length > 0 ? `**API Routes:**\n${filtered.join('\n')}` : 'No API routes found';
}

export function getEnvVars(): string {
  const envExamplePaths = ['.env.example', '.env.local.example', '.env.sample', '.env.template'];
  let envContent = '';

  for (const p of envExamplePaths) {
    if (fs.existsSync(path.join(ROOT, p))) {
      envContent = fs.readFileSync(path.join(ROOT, p), 'utf-8');
      break;
    }
  }

  // Also scan code for env references across supported runtimes
  const codeEnvVars = new Set<string>();
  const extractors: Array<{ regex: RegExp; fileGlob: string }> = [
    { regex: /process\.env\.(\w+)/g, fileGlob: '*.{ts,tsx,js,jsx,mjs,cjs}' },
    { regex: /os\.getenv\(['"]([A-Z0-9_]+)['"]/g, fileGlob: '*.py' },
    { regex: /os\.environ\[['"]([A-Z0-9_]+)['"]\]/g, fileGlob: '*.py' },
    { regex: /System\.getenv\(['"]([A-Z0-9_]+)['"]\)/g, fileGlob: '*.java' },
    { regex: /os\.Getenv\(['"]([A-Z0-9_]+)['"]\)/g, fileGlob: '*.go' },
    { regex: /std::env::var\(['"]([A-Z0-9_]+)['"]\)/g, fileGlob: '*.rs' },
  ];

  for (const extractor of extractors) {
    try {
      const cmd = `npx --yes ripgrep --files -g "${extractor.fileGlob}" "${ROOT}"`;
      const files = execSync(cmd, { maxBuffer: 1024 * 1024, timeout: 10000 }).toString().split('\n').filter(Boolean);
      for (const file of files.slice(0, 400)) {
        let content = '';
        try {
          content = fs.readFileSync(file, 'utf-8');
        } catch {
          continue;
        }

        for (const match of content.matchAll(extractor.regex)) {
          if (match[1]) codeEnvVars.add(match[1]);
        }
      }
    } catch {
      // best-effort extraction
    }
  }

  const lines: string[] = ['**Required Environment Variables:**', ''];

  if (envContent) {
    lines.push('From .env.example:');
    lines.push('```');
    lines.push(envContent.split('\n').filter(l => l.trim() && !l.startsWith('#')).join('\n'));
    lines.push('```');
  }

  if (codeEnvVars.size > 0) {
    lines.push('');
    lines.push('Referenced in code:');
    [...codeEnvVars].sort().forEach(v => lines.push(`- ${v}`));
  }

  return lines.join('\n');
}

export function getPackageInfo(packageName?: string): string {
  const lines: string[] = [];

  // Node
  const pkgPath = path.join(ROOT, 'package.json');
  if (fs.existsSync(pkgPath)) {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as {
      name?: string;
      version?: string;
      engines?: { node?: string };
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };

    if (packageName && allDeps[packageName]) {
      return `**${packageName}:** ${allDeps[packageName]}`;
    }

    lines.push(`**Node Package:** ${pkg.name ?? 'unknown'}@${pkg.version ?? '0.0.0'}`);
    lines.push(`**Node Engine:** ${pkg.engines?.node ?? 'not specified'}`);
    const depPairs = Object.entries(pkg.dependencies ?? {}).slice(0, 40).map(([k, v]) => `  ${k}: ${v}`);
    if (depPairs.length > 0) {
      lines.push('', '**Node Dependencies:**', ...depPairs);
    }
  }

  // Python
  const requirementsPath = path.join(ROOT, 'requirements.txt');
  if (fs.existsSync(requirementsPath)) {
    const reqLines = fs.readFileSync(requirementsPath, 'utf-8').split('\n').map((line) => line.trim()).filter(Boolean).filter((line) => !line.startsWith('#'));
    if (packageName) {
      const found = reqLines.find((line) => line.toLowerCase().startsWith(packageName.toLowerCase()));
      if (found) return `**${packageName}:** ${found}`;
    }
    lines.push('', `**Python Requirements:** ${reqLines.length} entries`);
    lines.push(...reqLines.slice(0, 40).map((line) => `  ${line}`));
  }

  // Java
  const pomPath = path.join(ROOT, 'pom.xml');
  if (fs.existsSync(pomPath)) {
    const pom = fs.readFileSync(pomPath, 'utf-8');
    const artifact = pom.match(/<artifactId>([^<]+)<\/artifactId>/)?.[1] ?? 'unknown';
    const version = pom.match(/<version>([^<]+)<\/version>/)?.[1] ?? 'unknown';
    lines.push('', `**Maven Project:** ${artifact}@${version}`);
  }
  const gradlePath = path.join(ROOT, 'build.gradle');
  const gradleKtsPath = path.join(ROOT, 'build.gradle.kts');
  if (fs.existsSync(gradlePath) || fs.existsSync(gradleKtsPath)) {
    lines.push('', '**Gradle Build:** detected');
  }

  // Go
  const goModPath = path.join(ROOT, 'go.mod');
  if (fs.existsSync(goModPath)) {
    const goMod = fs.readFileSync(goModPath, 'utf-8');
    const moduleName = goMod.match(/^module\s+(\S+)/m)?.[1] ?? 'unknown';
    lines.push('', `**Go Module:** ${moduleName}`);
  }

  // Rust
  const cargoPath = path.join(ROOT, 'Cargo.toml');
  if (fs.existsSync(cargoPath)) {
    const cargo = fs.readFileSync(cargoPath, 'utf-8');
    const name = cargo.match(/^name\s*=\s*"([^"]+)"/m)?.[1] ?? 'unknown';
    const version = cargo.match(/^version\s*=\s*"([^"]+)"/m)?.[1] ?? 'unknown';
    lines.push('', `**Rust Crate:** ${name}@${version}`);
  }

  if (lines.length === 0) {
    return 'No supported package/build manifest found (package.json, requirements.txt, pom.xml/build.gradle, go.mod, Cargo.toml).';
  }

  return lines.join('\n').trim();
}

export function getFileSummary(filePath: string): string {
  const absPath = path.isAbsolute(filePath) ? filePath : path.join(ROOT, filePath);
  try {
    const content = fs.readFileSync(absPath, 'utf-8');
    const lines = content.split('\n');
    const ext = path.extname(filePath).toLowerCase();
    const exports: string[] = [];
    const imports: string[] = [];

    for (const line of lines.slice(0, 200)) {
      // TypeScript/JavaScript exports
      if (/^export\s+(default\s+)?(function|class|const|interface|type|enum)\s+(\w+)/.test(line)) {
        const match = line.match(/^export\s+(?:default\s+)?(?:function|class|const|interface|type|enum)\s+(\w+)/);
        if (match) exports.push(match[1]);
      }
      // Python functions/classes
      if ((ext === '.py') && /^(def|class)\s+(\w+)/.test(line)) {
        const match = line.match(/^(def|class)\s+(\w+)/);
        if (match) exports.push(`${match[1]} ${match[2]}`);
      }
      // Go functions
      if ((ext === '.go') && /^func\s+(\w+)/.test(line)) {
        const match = line.match(/^func\s+(\w+)/);
        if (match) exports.push(`func ${match[1]}`);
      }
      // Imports (first 10)
      if (imports.length < 10 && /^import\s/.test(line)) {
        imports.push(line.trim());
      }
    }

    const summary: string[] = [
      `**File:** \`${filePath}\``,
      `**Size:** ${lines.length} lines`,
      '',
    ];

    if (imports.length > 0) {
      summary.push('**Key Imports:**');
      summary.push(...imports.map(i => `- ${i}`));
      summary.push('');
    }
    if (exports.length > 0) {
      summary.push('**Exports:**');
      summary.push(...exports.map(e => `- ${e}`));
      summary.push('');
    }

    // First 30 lines as preview
    summary.push('**Preview (first 30 lines):**');
    summary.push('```');
    summary.push(...lines.slice(0, 30));
    summary.push('```');

    return summary.join('\n');
  } catch {
    return `Could not read file: ${filePath}`;
  }
}

export function getImpactOfChange(filePath: string): string {
  const newGraphPath = path.join(ROOT, '.github', 'ai-os', 'context', 'dependency-graph.json');
  const legacyGraphPath = path.join(ROOT, '.ai-os', 'context', 'dependency-graph.json');
  const graphPath = fs.existsSync(newGraphPath) ? newGraphPath : legacyGraphPath;
  if (!fs.existsSync(graphPath)) {
    return 'Dependency graph not found. Re-run the AI OS installer: `bash install.sh --refresh-existing` (or the bootstrap one-liner from the README).';
  }

  let graph: { nodes: Record<string, { imports: string[]; importedBy: string[]; exports: string[] }> };
  try {
    graph = JSON.parse(fs.readFileSync(graphPath, 'utf-8'));
  } catch {
    return 'Could not parse dependency graph.';
  }

  // Normalize the input path to forward slashes, strip leading ./
  const normalized = filePath.replace(/\\/g, '/').replace(/^\.\//, '');

  const node = graph.nodes[normalized];
  if (!node) {
    // Try partial match
    const candidates = Object.keys(graph.nodes).filter(k => k.includes(normalized));
    if (candidates.length === 0) {
      return `File "${normalized}" not found in dependency graph. It may not be a tracked source file.`;
    }
    if (candidates.length > 1) {
      return `Ambiguous path "${normalized}" — did you mean one of:\n${candidates.map(c => `- ${c}`).join('\n')}`;
    }
    return getImpactOfChange(candidates[0]!);
  }

  // BFS to collect transitive dependents
  const visited = new Set<string>();
  const queue: string[] = [...node.importedBy];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);
    const n = graph.nodes[current];
    if (n) queue.push(...n.importedBy);
  }

  const direct = node.importedBy;
  const transitive = [...visited].filter(f => !direct.includes(f));

  const lines: string[] = [
    `## Impact Analysis: \`${normalized}\``,
    '',
    `**Exports:** ${node.exports.length > 0 ? node.exports.join(', ') : '_none detected_'}`,
    '',
    `**Imports (${node.imports.length} direct dependencies):**`,
    ...node.imports.map(f => `- ${f}`),
    '',
    `**Directly imported by (${direct.length} files):**`,
    ...(direct.length > 0 ? direct.map(f => `- ${f}`) : ['- _nothing imports this file_']),
    '',
    `**Transitively affected (${transitive.length} files):**`,
    ...(transitive.length > 0 ? transitive.map(f => `- ${f}`) : ['- _no transitive dependents_']),
  ];

  return lines.join('\n');
}

export function getDependencyChain(filePath: string): string {
  const newGraphPath = path.join(ROOT, '.github', 'ai-os', 'context', 'dependency-graph.json');
  const legacyGraphPath = path.join(ROOT, '.ai-os', 'context', 'dependency-graph.json');
  const graphPath = fs.existsSync(newGraphPath) ? newGraphPath : legacyGraphPath;
  if (!fs.existsSync(graphPath)) {
    return 'Dependency graph not found. Re-run the AI OS installer: `bash install.sh --refresh-existing` (or the bootstrap one-liner from the README).';
  }

  let graph: { nodes: Record<string, { imports: string[]; importedBy: string[]; exports: string[] }> };
  try {
    graph = JSON.parse(fs.readFileSync(graphPath, 'utf-8'));
  } catch {
    return 'Could not parse dependency graph.';
  }

  const normalized = filePath.replace(/\\/g, '/').replace(/^\.\//, '');
  const node = graph.nodes[normalized];
  if (!node) {
    return `File "${normalized}" not found in dependency graph.`;
  }

  const lines: string[] = [
    `## Dependency Chain: \`${normalized}\``,
    '',
    '### This file imports:',
  ];

  if (node.imports.length === 0) {
    lines.push('- _no local imports_');
  } else {
    for (const imp of node.imports) {
      const impNode = graph.nodes[imp];
      const exports = impNode?.exports.slice(0, 5).join(', ') ?? '';
      lines.push(`- **${imp}**${exports ? ` → exports: \`${exports}\`` : ''}`);
    }
  }

  lines.push('');
  lines.push('### This file is imported by:');

  if (node.importedBy.length === 0) {
    lines.push('- _nothing imports this file_');
  } else {
    for (const parent of node.importedBy) {
      const parentNode = graph.nodes[parent];
      const grandparents = parentNode?.importedBy.slice(0, 3).join(', ') ?? '';
      lines.push(`- **${parent}**${grandparents ? ` (used by: ${grandparents})` : ''}`);
    }
  }

  return lines.join('\n');
}

export function checkForUpdates(): string {
  const newConfigPath = path.join(ROOT, '.github', 'ai-os', 'config.json');
  const legacyConfigPath = path.join(ROOT, '.ai-os', 'config.json');
  const configPath = fs.existsSync(newConfigPath) ? newConfigPath : legacyConfigPath;
  if (!fs.existsSync(configPath)) {
    return 'AI OS is not installed in this repository. Run the bootstrap installer: `curl -fsSL https://raw.githubusercontent.com/marinvch/ai-os/master/bootstrap.sh | bash`';
  }

  let installedVersion = '0.0.0';
  let installedAt = 'unknown';
  try {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as {
      version?: string;
      installedAt?: string;
    };
    installedVersion = config.version ?? '0.0.0';
    installedAt = config.installedAt ?? 'unknown';
  } catch {
    return 'Could not read .github/ai-os/config.json';
  }

  let toolVersion = '0.0.0';
  try {
    const toolPkg = JSON.parse(
      fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf-8'),
    ) as { version?: string };
    toolVersion = toolPkg.version ?? '0.0.0';
  } catch { /* tool package.json not found */ }

  const parse = (v: string): number[] => v.replace(/^v/, '').split('.').map(Number);
  const [cMaj = 0, cMin = 0, cPat = 0] = parse(toolVersion);
  const [iMaj = 0, iMin = 0, iPat = 0] = parse(installedVersion);
  const updateAvailable =
    cMaj > iMaj ||
    (cMaj === iMaj && cMin > iMin) ||
    (cMaj === iMaj && cMin === iMin && cPat > iPat);

  if (updateAvailable) {
    return [
      `## AI OS Update Available`,
      ``,
      `- **Installed:** v${installedVersion} (generated ${installedAt})`,
      `- **Latest:**    v${toolVersion}`,
      ``,
      `Run the following to update all AI OS artifacts in-place:`,
      `\`\`\`bash`,
      `bash install.sh --refresh-existing`,
      `\`\`\``,
      `Or use the bootstrap one-liner: \`curl -fsSL https://raw.githubusercontent.com/marinvch/ai-os/master/bootstrap.sh | bash\``,
      `This refreshes context docs, agents, skills, MCP tools, and the dependency graph without deleting your existing files.`,
    ].join('\n');
  }

  return `AI OS is up-to-date (v${installedVersion}). Last generated: ${installedAt}`;
}

// ── Tool #19: Session Context ─────────────────────────────────────────────────

export function getSessionContext(): string {
  const contextCardPath = path.join(ROOT, '.github', 'COPILOT_CONTEXT.md');
  if (fs.existsSync(contextCardPath)) {
    return fs.readFileSync(contextCardPath, 'utf-8');
  }
  // Fallback: build a minimal context from available files
  const lines: string[] = [
    '# Session Context',
    '',
    '> COPILOT_CONTEXT.md not found. Run AI OS generation to create it.',
    '',
    '## Quick Context',
    '',
  ];
  const conventions = readAiOsFile('context/conventions.md');
  if (conventions) {
    // Extract just the first section
    const firstSection = conventions.split('\n##')[0];
    lines.push(firstSection.split('\n').slice(0, 15).join('\n'));
  }
  lines.push('');
  lines.push('Call `get_conventions` and `get_repo_memory` for full context.');
  return lines.join('\n');
}

// ── Tool #20: Recommendations ─────────────────────────────────────────────────

export function getRecommendations(): string {
  const recommendationsPath = path.join(ROOT, '.github', 'ai-os', 'recommendations.md');
  if (fs.existsSync(recommendationsPath)) {
    return fs.readFileSync(recommendationsPath, 'utf-8');
  }
  return 'No recommendations file found. Run AI OS generation with recommendations enabled to create .github/ai-os/recommendations.md.';
}

// ── Tool #21: Suggest Improvements ───────────────────────────────────────────

export function suggestImprovements(): string {
  const suggestions: string[] = [];

  // Check for missing env var documentation
  const envExamplePaths = ['.env.example', '.env.local.example', '.env.sample'];
  const hasEnvExample = envExamplePaths.some(p => fs.existsSync(path.join(ROOT, p)));
  if (!hasEnvExample) {
    suggestions.push('**Missing `.env.example`**: Document required environment variables so `get_env_vars` can surface them.');
  }

  // Check for missing COPILOT_CONTEXT.md
  if (!fs.existsSync(path.join(ROOT, '.github', 'COPILOT_CONTEXT.md'))) {
    suggestions.push('**Missing `COPILOT_CONTEXT.md`**: Re-run the AI OS installer (`bash install.sh --refresh-existing`) to generate the session context card for better session continuity.');
  }

  // Check for missing recommendations.md
  if (!fs.existsSync(path.join(ROOT, '.github', 'ai-os', 'recommendations.md'))) {
    suggestions.push('**Missing `recommendations.md`**: Re-run the AI OS installer (`bash install.sh --refresh-existing`) to generate stack-specific tool recommendations.');
  }

  // Check memory freshness
  const memoryPath = path.join(ROOT, '.github', 'ai-os', 'memory', 'memory.jsonl');
  if (!fs.existsSync(memoryPath)) {
    suggestions.push('**No repository memory found**: Use `remember_repo_fact` to capture key architectural decisions.');
  } else {
    const content = fs.readFileSync(memoryPath, 'utf-8').trim();
    if (!content) {
      suggestions.push('**Empty repository memory**: Use `remember_repo_fact` to capture key architectural decisions and conventions.');
    }
  }

  // Check for architecture doc
  const archPath = path.join(ROOT, '.github', 'ai-os', 'context', 'architecture.md');
  if (!fs.existsSync(archPath)) {
    suggestions.push('**Missing architecture doc**: Re-run the AI OS installer (`bash install.sh --refresh-existing`) to rebuild `.github/ai-os/context/architecture.md`.');
  }

  // Config-based suggestions
  const configPath = path.join(ROOT, '.github', 'ai-os', 'config.json');
  if (fs.existsSync(configPath)) {
    try {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as {
        persistentRules?: string[];
        recommendations?: boolean;
      };
      if (!config.persistentRules || config.persistentRules.length === 0) {
        suggestions.push('**No persistent rules defined**: Add `persistentRules` in `.github/ai-os/config.json` for rules that survive context window resets (e.g. "use shared components from components/ui").');
      }
      if (config.recommendations === false) {
        suggestions.push('**Recommendations disabled**: Set `"recommendations": true` in `.github/ai-os/config.json` to enable stack-specific tool suggestions.');
      }
    } catch {
      // ignore
    }
  }

  if (suggestions.length === 0) {
    return '## Improvement Suggestions\n\nNo actionable improvements found. Your AI OS setup looks healthy!\n\nConsider:\n- Adding more persistent rules in `config.json` for frequently forgotten conventions\n- Calling `remember_repo_fact` after major architectural decisions';
  }

  return [
    '## Improvement Suggestions',
    '',
    ...suggestions.map(s => `- ${s}`),
  ].join('\n');
}
