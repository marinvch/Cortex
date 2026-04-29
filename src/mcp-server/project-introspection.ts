/**
 * project-introspection.ts — env vars, package info, file summary, impact analysis,
 * dependency chain, API routes, tRPC procedures, and Prisma schema for AI OS MCP server.
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './shared.js';

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
    return 'Dependency graph not found. Re-run the AI OS installer: `npx -y github:marinvch/ai-os --refresh-existing` (or the bootstrap one-liner from the README).';
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
    return 'Dependency graph not found. Re-run the AI OS installer: `npx -y github:marinvch/ai-os --refresh-existing` (or the bootstrap one-liner from the README).';
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
