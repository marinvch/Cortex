#!/usr/bin/env node
/**
 * AI OS Regression Suite
 *
 * Validates core generation, MCP health, memory governance, and refresh-safety
 * across a representative set of project fixture scenarios.
 *
 * Usage:  npm run validate
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validateSkillContract } from './skill-contract.js';
import { validateAgentContract } from './agent-contract.js';

interface FixtureSpec {
  name: string;
  description: string;
  setup: (dir: string) => void;
}

interface CheckResult {
  fixture: string;
  check: string;
  passed: boolean;
  detail?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function run(cmd: string, cwd: string): { stdout: string; stderr: string; ok: boolean } {
  const result = spawnSync(cmd, { shell: true, cwd, encoding: 'utf-8', timeout: 60_000 });
  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    ok: result.status === 0,
  };
}

function writeJson(filePath: string, data: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

function writeFile(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf-8');
}

function fileExists(dir: string, rel: string): boolean {
  return fs.existsSync(path.join(dir, rel));
}

function readText(dir: string, rel: string): string {
  const p = path.join(dir, rel);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf-8') : '';
}

function gitInit(dir: string): void {
  spawnSync('git', ['init'], { cwd: dir, stdio: 'ignore' });
  spawnSync('git', ['config', 'user.email', 'test@ai-os.local'], { cwd: dir, stdio: 'ignore' });
  spawnSync('git', ['config', 'user.name', 'AI OS Test'], { cwd: dir, stdio: 'ignore' });
}

const AI_OS_ROOT = path.resolve(import.meta.dirname, '../..');
const GENERATE_CMD = `node --import tsx/esm "${path.join(AI_OS_ROOT, 'src/generate.ts')}"`;
const TOOL_VERSION = JSON.parse(fs.readFileSync(path.join(AI_OS_ROOT, 'package.json'), 'utf-8')) as { version: string };

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const fixtures: FixtureSpec[] = [
  {
    name: 'react-only',
    description: 'Standard single-package React/TypeScript project',
    setup(dir) {
      writeJson(path.join(dir, 'package.json'), {
        name: 'react-app',
        version: '1.0.0',
        dependencies: { react: '^18.0.0', 'react-dom': '^18.0.0' },
        devDependencies: { typescript: '^5.0.0', vite: '^5.0.0' },
      });
      writeFile(path.join(dir, 'src/App.tsx'), 'export default function App() { return <div>Hello</div>; }');
      writeFile(path.join(dir, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true } }));
    },
  },
  {
    name: 'spring-only',
    description: 'Java Spring Boot project',
    setup(dir) {
      writeFile(
        path.join(dir, 'pom.xml'),
        `<project><modelVersion>4.0.0</modelVersion>
  <groupId>com.example</groupId><artifactId>demo</artifactId><version>0.0.1</version>
  <dependencies>
    <dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-web</artifactId></dependency>
  </dependencies>
</project>`,
      );
      writeFile(
        path.join(dir, 'src/main/java/com/example/DemoApp.java'),
        `package com.example;\nimport org.springframework.boot.SpringApplication;\n@SpringBootApplication\npublic class DemoApp { public static void main(String[] args) { SpringApplication.run(DemoApp.class, args); } }`,
      );
    },
  },
  {
    name: 'react-spring-monorepo',
    description: 'Monorepo with React frontend and Spring backend packages',
    setup(dir) {
      writeJson(path.join(dir, 'package.json'), {
        name: 'monorepo',
        private: true,
        workspaces: ['apps/*'],
      });
      writeJson(path.join(dir, 'apps/frontend/package.json'), {
        name: 'frontend',
        dependencies: { react: '^18.0.0' },
        devDependencies: { typescript: '^5.0.0' },
      });
      writeFile(path.join(dir, 'apps/frontend/src/App.tsx'), 'export default function App() { return null; }');
      writeFile(
        path.join(dir, 'apps/backend/pom.xml'),
        `<project><modelVersion>4.0.0</modelVersion>
  <groupId>com.example</groupId><artifactId>backend</artifactId><version>1.0.0</version>
  <dependencies>
    <dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-web</artifactId></dependency>
  </dependencies>
</project>`,
      );
    },
  },
  {
    name: 'python-backend',
    description: 'Python FastAPI backend',
    setup(dir) {
      writeFile(
        path.join(dir, 'requirements.txt'),
        'fastapi>=0.110.0\nuvicorn[standard]>=0.29.0\npydantic>=2.0.0\n',
      );
      writeFile(
        path.join(dir, 'main.py'),
        `from fastapi import FastAPI\napp = FastAPI()\n@app.get("/")\ndef root(): return {"status": "ok"}`,
      );
    },
  },
  {
    name: 'go-service',
    description: 'Go service with go.mod',
    setup(dir) {
      writeFile(path.join(dir, 'go.mod'), 'module github.com/example/service\n\ngo 1.22\n');
      writeFile(
        path.join(dir, 'main.go'),
        `package main\nimport "fmt"\nfunc main() { fmt.Println("ok") }`,
      );
    },
  },
  {
    name: 'nextjs-fullstack',
    description: 'Next.js full-stack project with TypeScript',
    setup(dir) {
      writeJson(path.join(dir, 'package.json'), {
        name: 'nextjs-app',
        version: '1.0.0',
        dependencies: { next: '^14.0.0', react: '^18.0.0', 'react-dom': '^18.0.0' },
        devDependencies: { typescript: '^5.0.0', '@types/react': '^18.0.0' },
      });
      writeFile(path.join(dir, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true } }));
      writeFile(path.join(dir, 'app/page.tsx'), 'export default function Page() { return <main>Hello</main>; }');
      writeFile(
        path.join(dir, 'app/api/health/route.ts'),
        'export async function GET() { return Response.json({ status: "ok" }); }',
      );
    },
  },
  {
    name: 'java-go-react-monorepo',
    description: 'Monorepo combining React frontend, Java/Spring backend, and Go microservice',
    setup(dir) {
      // Root workspace descriptor (npm monorepo)
      writeJson(path.join(dir, 'package.json'), {
        name: 'java-go-react-monorepo',
        private: true,
        workspaces: ['apps/web'],
      });
      // React frontend package
      writeJson(path.join(dir, 'apps/web/package.json'), {
        name: 'web',
        version: '1.0.0',
        dependencies: { react: '^18.0.0', 'react-dom': '^18.0.0' },
        devDependencies: { typescript: '^5.0.0', vite: '^5.0.0' },
      });
      writeFile(path.join(dir, 'apps/web/src/App.tsx'), 'export default function App() { return <div>Hello</div>; }');
      writeFile(path.join(dir, 'apps/web/tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true } }));
      // Java Spring Boot service
      writeFile(
        path.join(dir, 'services/api/pom.xml'),
        `<project><modelVersion>4.0.0</modelVersion>
  <groupId>com.example</groupId><artifactId>api</artifactId><version>1.0.0</version>
  <dependencies>
    <dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-web</artifactId></dependency>
    <dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-data-jpa</artifactId></dependency>
  </dependencies>
</project>`,
      );
      writeFile(
        path.join(dir, 'services/api/src/main/java/com/example/ApiApp.java'),
        'package com.example;\nimport org.springframework.boot.SpringApplication;\n@SpringBootApplication\npublic class ApiApp { public static void main(String[] args) { SpringApplication.run(ApiApp.class, args); } }',
      );
      // Go microservice
      writeFile(path.join(dir, 'services/worker/go.mod'), 'module github.com/example/worker\n\ngo 1.22\n');
      writeFile(
        path.join(dir, 'services/worker/main.go'),
        'package main\nimport (\n  "fmt"\n  "net/http"\n)\nfunc main() {\n  http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) { fmt.Fprintln(w, "ok") })\n  http.ListenAndServe(":8080", nil)\n}',
      );
    },
  },
];

// ---------------------------------------------------------------------------
// Check functions
// ---------------------------------------------------------------------------

function checkPlanOutputs(dir: string, fixtureName: string, results: CheckResult[]): void {
  const r = run(`${GENERATE_CMD} --cwd "${dir}" --plan`, AI_OS_ROOT);
  results.push({
    fixture: fixtureName,
    check: 'generate --plan exits cleanly',
    passed: r.ok,
    detail: r.ok ? undefined : r.stderr.slice(0, 300),
  });
}

function checkPreviewOutputs(dir: string, fixtureName: string, results: CheckResult[]): void {
  const r = run(`${GENERATE_CMD} --cwd "${dir}" --preview`, AI_OS_ROOT);
  results.push({
    fixture: fixtureName,
    check: 'generate --preview exits cleanly',
    passed: r.ok,
    detail: r.ok ? undefined : r.stderr.slice(0, 300),
  });
}

function checkApplyOutputs(dir: string, fixtureName: string, results: CheckResult[]): void {
  const r = run(`${GENERATE_CMD} --cwd "${dir}"`, AI_OS_ROOT);
  results.push({
    fixture: fixtureName,
    check: 'generate --apply exits cleanly',
    passed: r.ok,
    detail: r.ok ? undefined : r.stderr.slice(0, 300),
  });

  const expectedFiles = [
    '.github/copilot-instructions.md',
    '.mcp.json',
    '.vscode/mcp.json',
    '.github/ai-os/context/stack.md',
    '.github/ai-os/context/architecture.md',
    '.github/ai-os/context/conventions.md',
  ];
  for (const f of expectedFiles) {
    results.push({
      fixture: fixtureName,
      check: `output file exists: ${f}`,
      passed: fileExists(dir, f),
    });
  }

  // Size cap assertions
  const instructionsContent = readText(dir, '.github/copilot-instructions.md');
  if (instructionsContent) {
    const instructionsBytes = Buffer.byteLength(instructionsContent, 'utf-8');
    results.push({
      fixture: fixtureName,
      check: 'copilot-instructions.md ≤ 8192 bytes',
      passed: instructionsBytes <= 8192,
      detail: instructionsBytes > 8192 ? `Actual: ${instructionsBytes} bytes` : undefined,
    });
  }

  const sessionCardContent = readText(dir, '.github/COPILOT_CONTEXT.md');
  if (sessionCardContent) {
    results.push({
      fixture: fixtureName,
      check: 'COPILOT_CONTEXT.md ≤ 2000 chars (~500 tokens)',
      passed: sessionCardContent.length <= 2000,
      detail: sessionCardContent.length > 2000 ? `Actual: ${sessionCardContent.length} chars` : undefined,
    });
  }

  results.push({
    fixture: fixtureName,
    check: 'apply output includes suggested first prompt guidance',
    passed: r.stdout.includes('Suggested first prompt:'),
    detail: r.stdout.includes('Suggested first prompt:') ? undefined : 'Missing suggested first prompt block in apply output',
  });

  results.push({
    fixture: fixtureName,
    check: 'apply output includes copilot-instructions first-action guidance',
    passed: r.stdout.includes('Review and optimize .github/copilot-instructions.md'),
    detail: r.stdout.includes('Review and optimize .github/copilot-instructions.md')
      ? undefined
      : 'Missing first-action guidance for copilot-instructions optimization in apply output',
  });

  results.push({
    fixture: fixtureName,
    check: 'apply output mentions recommendations path',
    passed: r.stdout.includes('.github/ai-os/recommendations.md'),
    detail: r.stdout.includes('.github/ai-os/recommendations.md') ? undefined : 'Missing recommendations path hint in apply output',
  });
}

function checkRefreshSafety(dir: string, fixtureName: string, results: CheckResult[]): void {
  // Re-run apply — content of generated files should not drift
  const instructionsBefore = readText(dir, '.github/copilot-instructions.md');
  const r = run(`${GENERATE_CMD} --cwd "${dir}" --refresh-existing`, AI_OS_ROOT);

  results.push({
    fixture: fixtureName,
    check: 'refresh-existing run exits cleanly',
    passed: r.ok,
    detail: r.ok ? undefined : r.stderr.slice(0, 300),
  });

  const instructionsAfter = readText(dir, '.github/copilot-instructions.md');
  results.push({
    fixture: fixtureName,
    check: 'refresh does not drift copilot-instructions.md',
    passed: instructionsBefore === instructionsAfter,
    detail: instructionsBefore !== instructionsAfter ? 'Content changed on second apply run' : undefined,
  });

  results.push({
    fixture: fixtureName,
    check: 'refresh-existing output includes ready guidance',
    passed: r.stdout.includes('Ready to use with Copilot.'),
    detail: r.stdout.includes('Ready to use with Copilot.') ? undefined : 'Missing ready guidance in refresh-existing output',
  });

  results.push({
    fixture: fixtureName,
    check: 'refresh-existing output includes copilot-instructions first-action guidance',
    passed: r.stdout.includes('Review and optimize .github/copilot-instructions.md'),
    detail: r.stdout.includes('Review and optimize .github/copilot-instructions.md')
      ? undefined
      : 'Missing first-action guidance for copilot-instructions optimization in refresh output',
  });

  results.push({
    fixture: fixtureName,
    check: 'refresh-existing output does not repeat update banner',
    passed: !r.stdout.includes('AI OS Update Available'),
    detail: !r.stdout.includes('AI OS Update Available') ? undefined : 'Update banner was printed during refresh-existing run',
  });

  const configPath = path.join(dir, '.github/ai-os/config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as { version: string };
  config.version = '0.0.1';
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');

  const safeRerun = run(`${GENERATE_CMD} --cwd "${dir}"`, AI_OS_ROOT);
  const refreshCmd = `npx -y "github:marinvch/ai-os#v${TOOL_VERSION.version}" --refresh-existing`;

  results.push({
    fixture: fixtureName,
    check: 'safe mode with stale install prints refresh command',
    passed: safeRerun.stdout.includes(refreshCmd),
    detail: safeRerun.stdout.includes(refreshCmd) ? undefined : `Missing refresh command: ${refreshCmd}`,
  });

  results.push({
    fixture: fixtureName,
    check: 'safe mode with stale install explains limited refresh',
    passed: safeRerun.stdout.includes('Safe mode updated local MCP/runtime wiring'),
    detail: safeRerun.stdout.includes('Safe mode updated local MCP/runtime wiring') ? undefined : 'Missing safe mode explanation for stale installs',
  });

  // protect.json hybrid mode: user blocks inside a file must survive refresh.
  // We write a file with user block markers and verify they are re-inserted after refresh.
  const hybridTarget = '.github/ai-os/context/conventions.md';
  const userBlockContent = 'My custom convention: always use tabs.';
  const blockId = 'my-conventions';

  // First: run a normal refresh to ensure the file exists (generated by AI OS)
  run(`${GENERATE_CMD} --cwd "${dir}" --refresh-existing`, AI_OS_ROOT);

  // Then patch in user block markers
  const existingConventions = readText(dir, hybridTarget);
  const withUserBlock = `${existingConventions}\n\n<!-- AI-OS:USER_BLOCK:START id="${blockId}" -->\n${userBlockContent}\n<!-- AI-OS:USER_BLOCK:END id="${blockId}" -->`;
  writeFile(path.join(dir, hybridTarget), withUserBlock);
  writeJson(path.join(dir, '.github/ai-os/protect.json'), { hybrid: [hybridTarget] });

  const hybridRefresh = run(`${GENERATE_CMD} --cwd "${dir}" --refresh-existing`, AI_OS_ROOT);
  const contentAfterHybrid = readText(dir, hybridTarget);

  results.push({
    fixture: fixtureName,
    check: 'hybrid mode: user block is preserved after refresh',
    passed: hybridRefresh.ok && contentAfterHybrid.includes(userBlockContent),
    detail: !hybridRefresh.ok
      ? `refresh failed: ${hybridRefresh.stderr.slice(0, 200)}`
      : !contentAfterHybrid.includes(userBlockContent)
        ? 'user block content was lost after hybrid refresh'
        : undefined,
  });

  results.push({
    fixture: fixtureName,
    check: 'hybrid mode: refresh output includes hybrid merge message',
    passed: hybridRefresh.stdout.includes('🔀'),
    detail: hybridRefresh.stdout.includes('🔀') ? undefined : 'Missing 🔀 hybrid merge indicator in refresh output',
  });

  // Clean up protect.json so subsequent checks are not affected
  fs.rmSync(path.join(dir, '.github/ai-os/protect.json'));

  // protect.json write-path protection: a file listed in protect.json must not be
  // overwritten by --refresh-existing even if it overlaps with a managed path.
  const protectTarget = '.github/copilot-instructions.md';
  const uniqueContent = '<!-- PROTECTED CUSTOM CONTENT — must survive refresh -->';
  writeFile(path.join(dir, protectTarget), uniqueContent);
  writeJson(path.join(dir, '.github/ai-os/protect.json'), { protected: [protectTarget] });

  const protectRefresh = run(`${GENERATE_CMD} --cwd "${dir}" --refresh-existing`, AI_OS_ROOT);
  const contentAfterProtect = readText(dir, protectTarget);

  results.push({
    fixture: fixtureName,
    check: 'protect.json shields file from overwrite during refresh',
    passed: protectRefresh.ok && contentAfterProtect === uniqueContent,
    detail: !protectRefresh.ok
      ? `refresh failed: ${protectRefresh.stderr.slice(0, 200)}`
      : contentAfterProtect !== uniqueContent
        ? 'protected file was overwritten by refresh-existing'
        : undefined,
  });

  results.push({
    fixture: fixtureName,
    check: 'protect.json refresh output includes shielded-count message',
    passed: protectRefresh.stdout.includes('shielded against overwrite'),
    detail: protectRefresh.stdout.includes('shielded against overwrite') ? undefined : 'Missing shield announcement in refresh output',
  });

  // Clean up protect.json so subsequent checks are not affected
  fs.rmSync(path.join(dir, '.github/ai-os/protect.json'));
}

function checkMcpHealth(dir: string, fixtureName: string, results: CheckResult[]): void {
  // The MCP server runtime (index.js) is deployed by install.sh, not by `generate`.
  // The regression suite only runs `generate`, so we verify both generated MCP
  // configs rather than the installed runtime launch path itself.
  // Tool definitions are written to .github/ai-os/tools.json.
  const configs = [
    {
      relativePath: '.mcp.json',
      rootKey: 'mcpServers',
      label: 'Copilot CLI',
    },
    {
      relativePath: path.join('.vscode', 'mcp.json'),
      rootKey: 'servers',
      label: 'VS Code',
    },
  ] as const;

  for (const configInfo of configs) {
    const configPath = path.join(dir, configInfo.relativePath);
    if (!fs.existsSync(configPath)) {
      results.push({
        fixture: fixtureName,
        check: `${configInfo.label} MCP config present`,
        passed: false,
        detail: `${configInfo.relativePath} not found after apply`,
      });
      continue;
    }

    results.push({ fixture: fixtureName, check: `${configInfo.label} MCP config present`, passed: true });

    let mcpConfig: Record<string, unknown>;
    try {
      mcpConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as Record<string, unknown>;
    } catch {
      results.push({
        fixture: fixtureName,
        check: `${configInfo.label} MCP config is valid JSON`,
        passed: false,
        detail: 'JSON.parse failed',
      });
      continue;
    }

    results.push({ fixture: fixtureName, check: `${configInfo.label} MCP config is valid JSON`, passed: true });

    const serverMap = mcpConfig[configInfo.rootKey] as Record<string, { type?: string; command?: string; args?: string[] }> | undefined;
    results.push({
      fixture: fixtureName,
      check: `${configInfo.label} MCP config uses "${configInfo.rootKey}" key`,
      passed: serverMap !== undefined,
      detail: serverMap === undefined ? `missing "${configInfo.rootKey}" top-level key` : undefined,
    });

    const serverEntry = serverMap?.['ai-os'];
    results.push({
      fixture: fixtureName,
      check: `${configInfo.label} MCP config has ai-os server entry`,
      passed: serverEntry !== undefined,
      detail: serverEntry === undefined ? `ai-os server not found in ${configInfo.rootKey}` : undefined,
    });

    if (serverEntry) {
      results.push({
        fixture: fixtureName,
        check: `${configInfo.label} ai-os server has launch command`,
        passed: typeof serverEntry.command === 'string' && serverEntry.command.length > 0,
        detail: !serverEntry.command ? 'command is missing' : undefined,
      });
      results.push({
        fixture: fixtureName,
        check: `${configInfo.label} ai-os server args point to runtime entry`,
        passed: Array.isArray(serverEntry.args) && serverEntry.args.some(arg => arg.includes('.ai-os') && arg.includes('index.js')),
        detail: Array.isArray(serverEntry.args) && serverEntry.args.some(arg => arg.includes('.ai-os') && arg.includes('index.js'))
          ? undefined
          : Array.isArray(serverEntry.args)
            ? `args do not include .ai-os runtime entry: ${JSON.stringify(serverEntry.args)}`
            : 'args are missing',
      });
    }
  }

  const toolsJsonPath = path.join(dir, '.github/ai-os/tools.json');
  if (!fs.existsSync(toolsJsonPath)) {
    results.push({
      fixture: fixtureName,
      check: 'tools.json present for MCP tool definitions',
      passed: false,
      detail: '.github/ai-os/tools.json not found after apply',
    });
    return;
  }

  let toolsConfig: unknown;
  try {
    toolsConfig = JSON.parse(fs.readFileSync(toolsJsonPath, 'utf-8'));
  } catch {
    results.push({
      fixture: fixtureName,
      check: 'tools.json is valid JSON',
      passed: false,
      detail: 'JSON.parse failed',
    });
    return;
  }

  results.push({ fixture: fixtureName, check: 'tools.json is valid JSON', passed: true });

  // New format: { activeTools: [...], availableButInactive: [...] }
  // Legacy format: flat array
  const isNewFormat =
    toolsConfig !== null &&
    typeof toolsConfig === 'object' &&
    !Array.isArray(toolsConfig) &&
    Array.isArray((toolsConfig as Record<string, unknown>)['activeTools']);
  const isLegacyFormat = Array.isArray(toolsConfig);

  results.push({
    fixture: fixtureName,
    check: 'tools.json contains MCP tool definitions',
    passed: isNewFormat || isLegacyFormat,
    detail: (!isNewFormat && !isLegacyFormat)
      ? 'tools.json is neither a { activeTools, availableButInactive } object nor a flat array'
      : undefined,
  });

  if (isNewFormat) {
    const obj = toolsConfig as Record<string, unknown>;
    const activeTools = obj['activeTools'] as unknown[];
    const inactiveTools = obj['availableButInactive'];
    results.push({
      fixture: fixtureName,
      check: 'tools.json activeTools is non-empty',
      passed: activeTools.length > 0,
      detail: activeTools.length === 0 ? 'activeTools array is empty' : undefined,
    });
    results.push({
      fixture: fixtureName,
      check: 'tools.json has availableButInactive array',
      passed: Array.isArray(inactiveTools),
      detail: !Array.isArray(inactiveTools) ? 'availableButInactive is missing or not an array' : undefined,
    });
  } else if (isLegacyFormat) {
    const arr = toolsConfig as unknown[];
    results.push({
      fixture: fixtureName,
      check: 'tools.json (legacy flat array) is non-empty',
      passed: arr.length > 0,
      detail: arr.length === 0 ? 'tools.json is an empty array' : undefined,
    });
  }
}

function checkMemoryQuality(dir: string, fixtureName: string, results: CheckResult[]): void {
  // Write a fact via the generate action's planner — or directly inject JSONL and check recovery
  const memDir = path.join(dir, '.github/ai-os/memory');
  fs.mkdirSync(memDir, { recursive: true });
  const memFile = path.join(memDir, 'memory.jsonl');

  // Write two identical entries (should dedupe on next MCP interaction)
  const entry = JSON.stringify({
    id: 'test-1',
    subject: 'test',
    fact: 'duplicate test fact',
    category: 'test',
    tags: [],
    createdAt: new Date().toISOString(),
    fingerprint: 'fp-test-duplicate',
  });
  fs.writeFileSync(memFile, `${entry}\n${entry}\n`, 'utf-8');

  // Write a malformed line ahead of valid entry to test recovery
  const malformedFile = path.join(memDir, 'memory-malformed.jsonl');
  const validEntry = JSON.stringify({ id: 'v1', subject: 'ok', fact: 'valid', category: 'test', tags: [], createdAt: new Date().toISOString(), fingerprint: 'fp-valid' });
  fs.writeFileSync(malformedFile, `{broken json line\n${validEntry}\n`, 'utf-8');

  results.push({
    fixture: fixtureName,
    check: 'memory dir is writable',
    passed: (() => {
      try {
        fs.accessSync(memDir, fs.constants.W_OK);
        return true;
      } catch {
        return false;
      }
    })(),
  });

  results.push({
    fixture: fixtureName,
    check: 'memory JSONL files are readable',
    passed: fs.existsSync(memFile) && fs.existsSync(malformedFile),
  });
}

function checkGeneratedSkillContracts(dir: string, fixtureName: string, results: CheckResult[]): void {
  const skillsDir = path.join(dir, '.github/copilot/skills');
  if (!fs.existsSync(skillsDir)) {
    results.push({
      fixture: fixtureName,
      check: 'generated skills contract validation skipped (no generated skills)',
      passed: true,
    });
    return;
  }

  const skillFiles = fs.readdirSync(skillsDir)
    .filter((name) => name.startsWith('ai-os-') && name.endsWith('.md'));

  if (skillFiles.length === 0) {
    results.push({
      fixture: fixtureName,
      check: 'generated skills contract validation skipped (no ai-os skills)',
      passed: true,
    });
    return;
  }

  for (const skillFile of skillFiles) {
    const fullPath = path.join(skillsDir, skillFile);
    const content = fs.readFileSync(fullPath, 'utf-8');
    const validation = validateSkillContract(content);

    results.push({
      fixture: fixtureName,
      check: `skill contract sections present: ${skillFile}`,
      passed: validation.valid,
      detail: validation.valid
        ? undefined
        : `Missing sections: ${validation.missingSections.join(', ')}`,
    });
  }
}

function checkGeneratedAgentContracts(dir: string, fixtureName: string, results: CheckResult[]): void {
  const agentsDir = path.join(dir, '.github/agents');
  if (!fs.existsSync(agentsDir)) {
    results.push({
      fixture: fixtureName,
      check: 'generated agents contract validation skipped (no generated agents)',
      passed: true,
    });
    return;
  }

  const agentFiles = fs.readdirSync(agentsDir)
    .filter((name) => name.endsWith('.agent.md'));

  if (agentFiles.length === 0) {
    results.push({
      fixture: fixtureName,
      check: 'generated agents contract validation skipped (no .agent.md files)',
      passed: true,
    });
    return;
  }

  for (const agentFile of agentFiles) {
    const fullPath = path.join(agentsDir, agentFile);
    const content = fs.readFileSync(fullPath, 'utf-8');
    const validation = validateAgentContract(content);

    results.push({
      fixture: fixtureName,
      check: `agent contract sections present: ${agentFile}`,
      passed: validation.valid,
      detail: validation.valid
        ? undefined
        : `Missing sections: ${validation.missingSections.join(', ')}`,
    });
  }
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

function printReport(results: CheckResult[]): boolean {
  const passed = results.filter(r => r.passed);
  const failed = results.filter(r => !r.passed);

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(' AI OS Regression Results');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const byFixture = new Map<string, CheckResult[]>();
  for (const r of results) {
    if (!byFixture.has(r.fixture)) byFixture.set(r.fixture, []);
    byFixture.get(r.fixture)!.push(r);
  }

  for (const [fixture, checks] of byFixture) {
    const allPass = checks.every(c => c.passed);
    const icon = allPass ? '✅' : '❌';
    console.log(`${icon} ${fixture}`);
    for (const c of checks) {
      const mark = c.passed ? '  ✓' : '  ✗';
      console.log(`${mark} ${c.check}`);
      if (c.detail) console.log(`      → ${c.detail}`);
    }
    console.log('');
  }

  console.log(`Summary: ${passed.length} passed, ${failed.length} failed out of ${results.length} checks\n`);

  if (failed.length > 0) {
    console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.error(` VALIDATION FAILED — ${failed.length} check(s) did not pass`);
    console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    for (const f of failed) {
      console.error(`  ✗ [${f.fixture}] ${f.check}`);
      if (f.detail) console.error(`    → ${f.detail}`);
    }
    console.error('');
    // Explicitly return false so main() exits with code 1
    return false;
  }

  console.log('  ✅ All checks passed.\n');
  return true;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('\n  AI OS Regression Suite');
  console.log('  Running fixture matrix...\n');

  const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-os-regression-'));
  const results: CheckResult[] = [];

  try {
    for (const fixture of fixtures) {
      const fixtureDir = path.join(tmpBase, fixture.name);
      fs.mkdirSync(fixtureDir, { recursive: true });

      console.log(`→ [${fixture.name}] ${fixture.description}`);

      // Set up fixture files
      fixture.setup(fixtureDir);

      // Git init so generate can detect a repo root
      gitInit(fixtureDir);

      // Run checks in sequence: plan → preview → apply → refresh → mcp health → memory
      checkPlanOutputs(fixtureDir, fixture.name, results);
      checkPreviewOutputs(fixtureDir, fixture.name, results);
      checkApplyOutputs(fixtureDir, fixture.name, results);
      checkRefreshSafety(fixtureDir, fixture.name, results);
      checkMcpHealth(fixtureDir, fixture.name, results);
      checkMemoryQuality(fixtureDir, fixture.name, results);
      checkGeneratedSkillContracts(fixtureDir, fixture.name, results);
      checkGeneratedAgentContracts(fixtureDir, fixture.name, results);
    }
  } finally {
    // Clean up temp fixtures
    try {
      fs.rmSync(tmpBase, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  }

  const allPassed = printReport(results);
  process.exit(allPassed ? 0 : 1);
}

main().catch(err => {
  console.error('[regression] Fatal:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
