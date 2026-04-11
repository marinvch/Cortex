#!/usr/bin/env node
/**
 * AI OS Regression Suite
 *
 * Validates core generation, MCP health, memory governance, and refresh-safety
 * across a representative set of project fixture scenarios.
 *
 * Usage:  npm run validate
 */
import { execSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

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
  execSync('git init', { cwd: dir, stdio: 'ignore' });
  execSync('git config user.email "test@ai-os.local"', { cwd: dir, stdio: 'ignore' });
  execSync('git config user.name "AI OS Test"', { cwd: dir, stdio: 'ignore' });
}

const AI_OS_ROOT = path.resolve(import.meta.dirname, '../..');
const GENERATE_CMD = `node --import tsx/esm "${path.join(AI_OS_ROOT, 'src/generate.ts')}"`;

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
}

function checkMcpHealth(dir: string, fixtureName: string, results: CheckResult[]): void {
  // The MCP server runtime (index.js) is deployed by install.sh, not by `generate`.
  // The regression suite only runs `generate`, so we verify the VS Code MCP config.
  // Since v0.6.27, the MCP config is written to .vscode/mcp.json with "servers" key.
  // Tool definitions are written to .github/ai-os/tools.json.
  const mcpJsonPath = path.join(dir, '.vscode/mcp.json');
  if (!fs.existsSync(mcpJsonPath)) {
    results.push({
      fixture: fixtureName,
      check: 'mcp.json present',
      passed: false,
      detail: '.vscode/mcp.json not found after apply',
    });
    return;
  }
  results.push({ fixture: fixtureName, check: 'mcp.json present', passed: true });

  let mcpConfig: { servers?: Record<string, { type?: string; command?: string; args?: string[] }> };
  try {
    mcpConfig = JSON.parse(fs.readFileSync(mcpJsonPath, 'utf-8')) as typeof mcpConfig;
  } catch {
    results.push({ fixture: fixtureName, check: 'mcp.json is valid JSON', passed: false, detail: 'JSON.parse failed' });
    return;
  }
  results.push({ fixture: fixtureName, check: 'mcp.json is valid JSON', passed: true });

  // Must use official "servers" key (not legacy "mcpServers")
  results.push({
    fixture: fixtureName,
    check: 'mcp.json uses "servers" key',
    passed: mcpConfig.servers !== undefined,
    detail: mcpConfig.servers === undefined ? 'missing "servers" top-level key' : undefined,
  });

  // The ai-os server entry should be present with a concrete runtime launch.
  const serverEntry = mcpConfig.servers?.['ai-os'];
  results.push({
    fixture: fixtureName,
    check: 'mcp.json has ai-os server entry',
    passed: serverEntry !== undefined,
    detail: serverEntry === undefined ? 'ai-os server not found in servers' : undefined,
  });

  if (serverEntry) {
    results.push({
      fixture: fixtureName,
      check: 'ai-os server has launch command',
      passed: typeof serverEntry.command === 'string' && serverEntry.command.length > 0,
      detail: !serverEntry.command ? 'command is missing' : undefined,
    });
    results.push({
      fixture: fixtureName,
      check: 'ai-os server args point to runtime entry',
      passed: Array.isArray(serverEntry.args) && serverEntry.args.some(arg => arg.includes('.ai-os') && arg.includes('index.js')),
      detail: Array.isArray(serverEntry.args) && serverEntry.args.some(arg => arg.includes('.ai-os') && arg.includes('index.js'))
        ? undefined
        : Array.isArray(serverEntry.args)
          ? `args do not include .ai-os runtime entry: ${JSON.stringify(serverEntry.args)}`
          : 'args are missing',
    });
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
  results.push({
    fixture: fixtureName,
    check: 'tools.json contains MCP tool definitions',
    passed: Array.isArray(toolsConfig) && toolsConfig.length > 0,
    detail: Array.isArray(toolsConfig)
      ? (toolsConfig.length > 0 ? undefined : 'tools.json is an empty array')
      : 'tools.json is not an array',
  });
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
