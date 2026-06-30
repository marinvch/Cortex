#!/usr/bin/env node
/**
 * cortex-init — install a "codebase brain" into the current repo.
 *
 * Zero dependencies. Scans the repo (stack, scripts, tsconfig, lint/CI, route dirs), then writes a
 * single source-of-truth AGENTS.md plus tiny shims so every AI agent (Claude, Gemini, Copilot,
 * Cursor) reads the same project knowledge — and Claude-only dev-cycle skills. For a deep,
 * AI-driven pass that fills prose from the actual code, run the /install-project skill in Claude.
 *
 * Run from inside a repo — any shell (bash, zsh, gitbash, PowerShell), any JS runtime:
 *   node  path/to/cortex-init.mjs
 *   bun   path/to/cortex-init.mjs
 *   npx   github:marinvch/ai-os
 *   bunx  github:marinvch/ai-os
 *
 * Interactive in a real terminal; non-interactive via flags, piped stdin, or --yes:
 *   printf 'Name\nWhat it does\nKey rule\nall\n' | node path/to/cortex-init.mjs
 *   node path/to/cortex-init.mjs --yes
 *   node path/to/cortex-init.mjs --name=App --agents=claude,gemini --register-to-vault ~/vault
 *
 * Writes ONLY inside the current working directory (backs up existing files to *.bak), except the
 * opt-in --register-to-vault, which writes one metadata-only stub into the vault. Run --help for all.
 */

import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { readFileSync, existsSync, mkdirSync, writeFileSync, copyFileSync, readdirSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';

const cwd = process.cwd();
const now = new Date();
const today = now.toISOString().slice(0, 10);
const stamp = now.toISOString().replace(/[:.]/g, '-'); // filesystem-safe, for non-clobbering backups

// ── helpers ──────────────────────────────────────────────────────────────────
const read = (p) => { try { return readFileSync(join(cwd, p), 'utf8'); } catch { return null; } };
const readAbs = (p) => { try { return readFileSync(p, 'utf8'); } catch { return null; } };
const has = (p) => existsSync(join(cwd, p));

function stripJsonComments(t) {
  // tsconfig allows // and /* */ comments + trailing commas; strip them so JSON.parse works.
  return t
    .replace(/"(?:\\.|[^"\\])*"|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (m) => (m[0] === '"' ? m : ''))
    .replace(/,(\s*[}\]])/g, '$1');
}
const readJson = (p) => { const t = read(p); if (!t) return null; try { return JSON.parse(stripJsonComments(t)); } catch { return null; } };

// Read all of (non-TTY) stdin once. Works identically under node and bun, and for input piped from
// any shell. readline/promises drops piped input after the first answer, so we don't use it here.
const readStdin = () => new Promise((resolve) => {
  let data = '';
  input.setEncoding('utf8');
  input.on('data', (c) => { data += c; });
  input.on('end', () => resolve(data));
  input.on('error', () => resolve(data));
});

// Best-effort git (returns trimmed stdout, or null if git missing / not a repo).
function git(args) {
  try { return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch { return null; }
}

// Which of `paths` are gitignored here? [] = none, null = can't tell (no git / not a repo).
function checkIgnored(paths) {
  if (!paths.length) return [];
  try {
    const out = execFileSync('git', ['check-ignore', ...paths], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return out.split(/\r?\n/).filter(Boolean);
  } catch (e) {
    if (e && e.status === 1) return []; // git ran, nothing ignored
    return null;                        // git unavailable / not a repo
  }
}

// Detect a pre-existing OLD engine-based AI OS (the retired `.ai-os/` MCP system). Returns a list
// of human-readable markers, or [] if none. cortex-init never touches the engine — it only advises
// running the AI-driven `/migrate-engine` ritual, which harvests the engine's memory before removal.
function detectOldEngine() {
  const markers = [];
  if (has('.ai-os')) markers.push('.ai-os/ (engine MCP server)');
  if (has('.github/ai-os')) markers.push('.github/ai-os/ (engine context + memory store)');
  if (has('.github/agents')) markers.push('.github/agents/ (engine-generated agents)');
  if (has('.github/COPILOT_CONTEXT.md')) markers.push('.github/COPILOT_CONTEXT.md');
  for (const f of ['.mcp.json', '.vscode/mcp.json']) {
    const t = read(f);
    if (t && /ai-os|AI_OS_ROOT/.test(t)) markers.push(`${f} (ai-os MCP entry)`);
  }
  const ci = read('.github/copilot-instructions.md');
  if (ci && /get_session_context|AI OS/i.test(ci)) markers.push('.github/copilot-instructions.md (engine-style)');
  return markers;
}

// Print a prominent notice + recommendation if an old engine is present. Returns true if found.
function warnOldEngine() {
  const found = detectOldEngine();
  if (!found.length) return false;
  console.log('\n  ⚠ Old engine-based AI OS detected in this repo:');
  found.forEach((m) => console.log('     - ' + m));
  console.log('    This repo predates the plain-files brain. To avoid LOSING the engine\'s');
  console.log('    accumulated memory, migrate it before relying on the new AGENTS.md:');
  console.log('      → Open this repo in Claude Code / Cowork and run  /migrate-engine');
  console.log('    It harvests the engine\'s memory store into AGENTS.md, logs the change in');
  console.log('    docs/decisions.md, backs everything up, then removes the old files.');
  console.log('    (cortex-init does not touch the old engine itself.)');
  return true;
}

const written = [];   // repo-relative paths actually written (for the gitignore check)
let madeBackups = false;

function writeAt(abs, content, label, track = true) {
  mkdirSync(dirname(abs), { recursive: true });
  let note = '';
  if (existsSync(abs)) {
    const bak = existsSync(abs + '.bak') ? `${abs}.bak.${stamp}` : `${abs}.bak`; // never clobber a prior .bak
    copyFileSync(abs, bak);
    madeBackups = true;
    note = `  (old → ${basename(bak)})`;
  }
  writeFileSync(abs, content, 'utf8');
  const shown = label || abs;
  if (track) written.push(shown);
  console.log('  ✓ ' + shown + note);
}
const writeFile = (relPath, content) => writeAt(join(cwd, relPath), content, relPath);

// AGENTS.md: if an existing file is curated (not ours), never clobber it — write *.generated.* to diff.
function writeSmart(relPath, content, isOurs) {
  const abs = join(cwd, relPath);
  if (existsSync(abs)) {
    if (!isOurs(readFileSync(abs, 'utf8'))) {
      const alt = relPath.replace(/(\.[^.\\/]+)$/, '.generated$1');
      writeFile(alt, content);
      console.log(`  • kept your curated ${relPath}; wrote ${alt} for you to diff & merge.`);
      return;
    }
  }
  writeFile(relPath, content);
}

// Shims are tiny pointers: if an existing one is curated, leave it untouched (no .generated noise).
function writeShim(relPath, content, isOurs) {
  const abs = join(cwd, relPath);
  if (existsSync(abs) && !isOurs(readFileSync(abs, 'utf8'))) {
    console.log(`  • kept your curated ${relPath} — left it untouched.`);
    return;
  }
  writeFile(relPath, content);
}

// ── arg parsing ────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const out = {};
  const BOOL = new Set(['yes', 'additive', 'skip-instructions', 'non-interactive', 'help']);
  for (let k = 0; k < argv.length; k++) {
    const a = argv[k];
    if (a === '-y') { out.yes = true; continue; }
    if (a === '-h') { out.help = true; continue; }
    if (!a.startsWith('--')) continue;
    const body = a.slice(2);
    const eq = body.indexOf('=');
    if (eq !== -1) { out[body.slice(0, eq)] = body.slice(eq + 1); continue; }
    if (BOOL.has(body)) { out[body] = true; continue; }
    const next = argv[k + 1];
    if (next === undefined || next.startsWith('-')) { out[body] = true; }
    else { out[body] = next; k++; }
  }
  return out;
}

// ── 1. scan the repo ───────────────────────────────────────────────────────────
const KNOWN_DIRS = {
  src: 'Application source',
  'src/app': 'App Router routes & layouts',
  app: 'App Router routes & layouts',
  'src/pages': 'Pages Router routes',
  pages: 'Pages Router / routes',
  'src/routes': 'SvelteKit routes',
  'app/routes': 'Remix routes',
  'src/components': 'Reusable UI components',
  components: 'Reusable UI components',
  'src/lib': 'Shared utilities & helpers',
  lib: 'Shared utilities & helpers',
  'src/hooks': 'React hooks',
  'src/utils': 'Utility functions',
  utils: 'Utility functions',
  'src/server': 'Server-side code',
  'src/api': 'API client / handlers',
  api: 'API routes / handlers',
  server: 'Server-side code',
  prisma: 'Prisma schema & migrations',
  public: 'Static assets served as-is',
  styles: 'Global styles',
  tests: 'Test suites',
  test: 'Test suites',
  __tests__: 'Test suites',
  e2e: 'End-to-end tests',
  docs: 'Documentation',
  scripts: 'Dev / build scripts',
  config: 'Configuration',
  packages: 'Monorepo packages',
  apps: 'Monorepo apps',
};

function detect() {
  const pkg = readJson('package.json') || {};
  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  const d = (n) => Object.prototype.hasOwnProperty.call(deps, n);

  let framework = 'Unknown';
  if (d('next')) framework = 'Next.js (React)';
  else if (d('@remix-run/react')) framework = 'Remix (React)';
  else if (d('react')) framework = 'React';
  else if (d('nuxt')) framework = 'Nuxt (Vue)';
  else if (d('vue')) framework = 'Vue';
  else if (d('svelte') || d('@sveltejs/kit')) framework = 'Svelte';
  else if (d('@angular/core')) framework = 'Angular';
  else if (d('express') || d('fastify') || d('koa')) framework = 'Node backend';

  const pm = has('pnpm-lock.yaml') ? 'pnpm' : has('yarn.lock') ? 'yarn'
    : (has('bun.lockb') || has('bun.lock')) ? 'bun' : 'npm';
  const lang = has('tsconfig.json') || d('typescript') ? 'TypeScript' : 'JavaScript';
  const bundler = d('vite') ? 'Vite' : d('webpack') ? 'webpack' : pkg.scripts?.build?.includes('next') ? 'Next' : '';
  const styling = d('tailwindcss') ? 'Tailwind CSS' : d('styled-components') ? 'styled-components' : d('sass') ? 'Sass' : '';
  const testing = d('vitest') ? 'Vitest' : d('jest') ? 'Jest' : d('@playwright/test') ? 'Playwright' : '';

  const s = pkg.scripts || {};
  const runCmd = (name) => (s[name] ? `${pm} run ${name}` : '—');

  // tsconfig signals: strict mode + first path alias
  const ts = readJson('tsconfig.json') || {};
  const co = ts.compilerOptions || {};
  const tsStrict = co.strict === true ? true : co.strict === false ? false : null;
  let alias = '';
  if (co.paths && typeof co.paths === 'object') {
    const key = Object.keys(co.paths)[0];
    if (key) { const v = Array.isArray(co.paths[key]) ? co.paths[key][0] : co.paths[key]; alias = `${key} → ${v}`; }
  }

  // tooling configs
  const eslint = ['.eslintrc', '.eslintrc.js', '.eslintrc.cjs', '.eslintrc.json', '.eslintrc.yml',
    'eslint.config.js', 'eslint.config.mjs', 'eslint.config.cjs'].some(has) || Boolean(pkg.eslintConfig);
  const prettier = ['.prettierrc', '.prettierrc.json', '.prettierrc.js', '.prettierrc.cjs',
    'prettier.config.js', 'prettier.config.cjs'].some(has) || Boolean(pkg.prettier);
  const ci = has('.github/workflows');

  // README's first meaningful line → default "what is this"
  const readme = read('README.md') || read('readme.md') || read('README') || '';
  const readmeLine = readme.split(/\r?\n/).map((l) => l.trim())
    .find((l) => l && !/^[#>!<|`-]/.test(l)) || '';

  // architecture: real notes for known dirs (top-level + probed nested route/source dirs)
  const ignore = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.cache', 'coverage',
    '.claude', '.github', '.cursor', '.vscode', '.idea']);
  let topDirs = [];
  try {
    topDirs = readdirSync(cwd, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith('.') && !ignore.has(e.name)).map((e) => e.name);
  } catch {}
  const probes = ['src/app', 'app', 'src/pages', 'pages', 'src/routes', 'app/routes', 'src/components',
    'components', 'src/lib', 'lib', 'src/hooks', 'src/utils', 'src/server', 'src/api', 'prisma'];
  const archMap = new Map();
  for (const dir of topDirs) archMap.set(dir + '/', KNOWN_DIRS[dir] || '<what lives here>');
  for (const p of probes) if (has(p) && !archMap.has(p + '/')) archMap.set(p + '/', KNOWN_DIRS[p] || '<what lives here>');
  const arch = [...archMap.entries()].map(([dir, note]) => ({ dir, note }));

  return {
    name: pkg.name || basename(cwd),
    framework, pm, lang, bundler, styling, testing,
    install: `${pm} install`,
    dev: runCmd('dev') !== '—' ? runCmd('dev') : runCmd('start'),
    build: runCmd('build'), test: runCmd('test'), lint: runCmd('lint'),
    tsStrict, alias, eslint, prettier, ci, readmeLine, arch,
    repoUrl: git(['remote', 'get-url', 'origin']) || '',
  };
}

// ── 2. run ─────────────────────────────────────────────────────────────────────
async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { printHelp(); return; }

  console.log('\n  🧠 cortex-init — give this repo a codebase brain');
  console.log('  repo: ' + cwd + '\n');
  const i = detect();

  console.log('  Detected:');
  console.log(`    name: ${i.name} · ${i.framework} · ${i.lang} · ${i.pm}` +
    (i.styling ? ` · ${i.styling}` : '') + (i.testing ? ` · ${i.testing}` : ''));
  console.log(`    run: dev='${i.dev}' build='${i.build}' test='${i.test}' lint='${i.lint}'`);
  const tooling = [i.tsStrict ? 'strict TS' : '', i.alias ? `alias ${i.alias}` : '',
    i.eslint ? 'ESLint' : '', i.prettier ? 'Prettier' : '', i.ci ? 'CI' : ''].filter(Boolean);
  if (tooling.length) console.log(`    tooling: ${tooling.join(' · ')}`);
  console.log(`    dirs: ${i.arch.map((a) => a.dir).join(', ') || '(none found)'}\n`);

  const hasOldEngine = warnOldEngine();

  const yes = Boolean(args.yes);
  const additive = Boolean(args.additive || args['skip-instructions']);
  const registerTo = typeof args['register-to-vault'] === 'string' ? args['register-to-vault'] : null;
  const flag = (k) => (typeof args[k] === 'string' ? args[k] : undefined);
  const haveAll = ['name', 'purpose', 'rule', 'agents'].every((k) => flag(k) !== undefined);
  const interactive = Boolean(input.isTTY) && !yes && !haveAll;

  let name, purpose, conventions, agentsAns;
  if (interactive) {
    const rl = createInterface({ input, output });
    const ask = async (q, def) => ((await rl.question(`  ${q}${def ? ` [${def}]` : ''}: `)).trim() || def || '');
    name = flag('name') ?? await ask('Project name', i.name);
    purpose = flag('purpose') ?? await ask('One line — what does this project do?', i.readmeLine);
    conventions = flag('rule') ?? await ask('Any key rule the AI must follow? (optional)', '');
    agentsAns = (flag('agents') ?? await ask('Generate shims for which agents? (claude,gemini,copilot,cursor or "all")', 'all')).toLowerCase();
    rl.close();
  } else {
    // Non-interactive: flags win; otherwise read piped answers (one per line); blanks → defaults.
    const lines = (yes || haveAll) ? [] : (await readStdin()).split(/\r?\n/);
    const pick = (idx, def) => { const v = (lines[idx] ?? '').trim(); return v === '' ? (def ?? '') : v; };
    name = flag('name') ?? pick(0, i.name);
    purpose = flag('purpose') ?? pick(1, i.readmeLine);
    conventions = flag('rule') ?? pick(2, '');
    agentsAns = (flag('agents') ?? pick(3, 'all')).toLowerCase();
    console.log('  ' + (yes ? 'Non-interactive (--yes): using detected defaults.'
      : haveAll ? 'Non-interactive: using provided --flags.'
      : 'Non-interactive: reading answers from stdin.') + '\n');
  }

  const KNOWN_AGENTS = ['claude', 'gemini', 'copilot', 'cursor'];
  if (agentsAns !== 'all' && !KNOWN_AGENTS.some((a) => agentsAns.includes(a))) {
    console.log(`  (couldn't match any agent in "${agentsAns}" — defaulting to all)`);
    agentsAns = 'all';
  }
  const want = (a) => agentsAns === 'all' || agentsAns.includes(a);

  // ── 3. write ─────────────────────────────────────────────────────────────────
  console.log('  Writing the brain...');

  if (!additive) {
    writeSmart('AGENTS.md', agentsMd({ ...i, name, purpose, conventions }), (c) => /Generated by cortex-init/.test(c));
    const shimOurs = (c) => /AGENTS\.md/.test(c) && c.length < 320;
    if (want('claude')) writeShim('CLAUDE.md', '@AGENTS.md\n', (c) => c.trim() === '@AGENTS.md');
    if (want('gemini')) writeShim('GEMINI.md', GEMINI_SHIM, shimOurs);
    if (want('copilot')) writeShim('.github/copilot-instructions.md', COPILOT_SHIM, shimOurs);
    if (want('cursor')) writeShim('.cursor/rules/project.mdc', CURSOR_SHIM, shimOurs);
  } else {
    console.log('  (--additive: leaving AGENTS.md + agent shims untouched; refreshing skills only)');
  }

  writeFile('.claude/skills/plan-feature/SKILL.md', planFeatureSkill());
  writeFile('.claude/skills/investigate-bug/SKILL.md', investigateBugSkill());
  if (!has('docs/decisions.md')) {
    writeFile('docs/decisions.md', `# Decision Log — ${name}\n\nAppend-only. Newest on top. Record why a technical call was made so it isn't re-litigated.\n`);
  }

  // ── 4. gitignore awareness (#302) ──────────────────────────────────────────────
  const ignored = checkIgnored(written);
  if (ignored && ignored.length) {
    console.log("\n  ⚠ These generated files are gitignored here — teammates won't get them on clone:");
    ignored.forEach((p) => console.log('     - ' + p));
    console.log('     Remove the ignore rule, or commit them with `git add -f`.');
  }
  if (madeBackups) {
    const bakIgnored = checkIgnored(['_cortex_sample_.bak']);
    if (bakIgnored && bakIgnored.length === 0) {
      console.log('\n  Tip: add `*.bak` to .gitignore so cortex-init backups are not committed.');
    }
  }

  // ── 5. optional: register to the personal vault (#301, opt-in, metadata only) ───
  if (registerTo) registerToVault(registerTo, { name, purpose, i });

  console.log('\n  ✅ Done. This repo now has a brain.');
  console.log('  That was a fast stack scan + scaffold. For a deep, AI-driven pass that fills');
  console.log('  Architecture / Conventions / Gotchas from the actual code, open this repo in');
  console.log('  Claude Code and run /install-project — then review AGENTS.md and commit it.');
  if (hasOldEngine) {
    console.log('\n  ⚠ Reminder: an old engine-based AI OS is still in this repo. Run');
    console.log('    /migrate-engine in Claude Code to rescue its memory into AGENTS.md before');
    console.log('    removing it — otherwise that accumulated knowledge is lost.');
  }
  console.log('');
}

// ── vault bridge (#301) ──────────────────────────────────────────────────────────
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'project';

function registerToVault(vaultPath, { name, purpose, i }) {
  const home = process.env.HOME || process.env.USERPROFILE || '';
  const root = vaultPath.replace(/^~(?=$|[/\\])/, home);
  if (!existsSync(root)) {
    console.log(`\n  ⚠ --register-to-vault: vault not found at ${root} (skipped).`);
    return;
  }
  const stackBits = [i.framework, i.lang, i.pm, i.styling, i.testing].filter((x) => x && x !== 'Unknown');
  const file = join(root, 'projects', `${slug(name)}.md`);
  const body = `---
type: project
title: ${name}
status: active
domain: business
created: ${today}
tags: [project, codebase]
---

# ${name}

> Metadata-only stub registered by cortex-init on ${today}. No code, secrets, or client data —
> the codebase brain stays in the repo; the vault only learns this project exists.

- **Local path:** \`${cwd}\`
${i.repoUrl ? `- **Repo:** ${i.repoUrl}\n` : ''}- **Stack:** ${stackBits.join(' · ') || 'unknown'}
- **Brain installed:** ${today}

## Outcome
${purpose || '<one sentence: what "done" looks like>'}

## Next actions
- [ ]
`;
  console.log('');
  writeAt(file, body, `projects/${slug(name)}.md  (in vault)`, false);
  flipConnectionsRow(root);
}

// Flip the "Tasks / projects" row in the vault's connections.md to `local files` once a project lands.
function flipConnectionsRow(root) {
  const cpath = join(root, 'connections.md');
  const txt = readAbs(cpath);
  if (!txt) return;
  let changed = false;
  const out = txt.split(/\r?\n/).map((ln) => {
    if (!/Tasks\s*\/\s*projects/i.test(ln) || !ln.trim().startsWith('|')) return ln;
    const cells = ln.split('|');
    if (cells.length >= 7 && /not connected/i.test(cells[5])) {
      cells[3] = ' Codebase brains ';
      cells[4] = ' local files ';
      cells[5] = ' ✅ live ';
      cells[6] = ` ${today} `;
      changed = true;
      return cells.join('|');
    }
    return ln;
  });
  if (changed) writeAt(cpath, out.join('\n'), 'connections.md  (in vault)', false);
}

// ── templates ────────────────────────────────────────────────────────────────────
const GEMINI_SHIM = 'See AGENTS.md at the repo root for all project context, architecture, and conventions.\n';
const COPILOT_SHIM = 'All project context and conventions live in `AGENTS.md` at the repo root. Read and follow it.\n';
const CURSOR_SHIM = '---\nalwaysApply: true\n---\nRead AGENTS.md at the repo root for architecture, conventions, and the development cycle.\n';

function agentsMd(x) {
  const archLines = x.arch.length
    ? x.arch.map((a) => `- \`${a.dir}\` — ${a.note}`).join('\n')
    : '- <map the important folders here>';

  const conv = ['- Standard to hold: clear, maintainable, scalable code.'];
  if (x.conventions) conv.push(`- ${x.conventions}`);
  if (x.tsStrict) conv.push('- Strict TypeScript (`strict: true` in tsconfig) — keep it type-safe.');
  if (x.alias) conv.push(`- Path alias: \`${x.alias}\` — prefer it over deep relative imports.`);
  if (x.eslint) conv.push(`- Lint with ESLint${x.lint !== '—' ? ` (\`${x.lint}\`)` : ''} before committing.`);
  if (x.prettier) conv.push("- Format with Prettier; don't hand-format.");
  conv.push('- <add naming / component / import conventions as you confirm them in the code>');

  const stackExtra = [x.bundler ? `Bundler: ${x.bundler}` : '', x.styling ? `Styling: ${x.styling}` : '',
    x.testing ? `Testing: ${x.testing}` : ''].filter(Boolean);

  return `# ${x.name} — Project Brain (codebase-scoped)

> AI instructions for THIS repo. Single source of truth — every agent reads it via its own shim.
> Generated by cortex-init on ${today}. Keep it accurate; edit it in pull requests.

## What this is
${x.purpose || '<one line: what this project does and who uses it>'}

## Stack & tooling
- Framework: ${x.framework} · Language: ${x.lang} · Package manager: ${x.pm}
${stackExtra.length ? `- ${stackExtra.join(' · ')}\n` : ''}${x.ci ? '- CI: GitHub Actions (`.github/workflows`)\n' : ''}
## Run it
- install: \`${x.install}\` · dev: \`${x.dev}\` · build: \`${x.build}\` · test: \`${x.test}\` · lint: \`${x.lint}\`

## Architecture (key directories)
${archLines}

## Conventions
${conv.join('\n')}

## Development cycle (the hard rule)
1. **Plan before implementing.** No code until there's a written plan (use \`/plan-feature\`).
2. Break the plan into small, reviewable steps.
3. Implement step by step; run tests/lint after each.
4. Self-review against the conventions above before opening a PR.

## Gotchas / tribal knowledge
- <quirks, flaky areas, build traps — grows over time; or run /install-project to seed from the code>

## Glossary
- <domain terms specific to this codebase>
`;
}

function planFeatureSkill() {
  return `---
name: plan-feature
description: Write an implementation plan for a feature/ticket in THIS repo before any code. Use when a feature or ticket is assigned. Enforces plan-before-implementing.
---
# /plan-feature
Read AGENTS.md for stack + conventions. Then produce a plan ONLY (no code):
1. Restate the requirement + acceptance criteria. Ask for anything missing.
2. List the files/components this touches (search the repo to confirm).
3. Design: data flow, state, UI states (loading/empty/error), edge cases.
4. Break into small ordered steps, each independently testable.
5. Call out risks + a test plan.
End by asking the user to approve the plan before implementation starts.
`;
}

function investigateBugSkill() {
  return `---
name: investigate-bug
description: Systematically investigate a bug in THIS repo. Use when given a bug report or failing behavior. Find root cause before proposing a fix.
---
# /investigate-bug
1. Reproduce: restate expected vs actual; find where it's triggered in the code.
2. Trace the data/render path; form a root-cause hypothesis (don't patch symptoms).
3. Confirm the root cause with evidence (code refs, a failing test if possible).
4. Propose the smallest correct fix + how to verify it. Plan before editing.
`;
}

function printHelp() {
  console.log(`
  cortex-init — install a codebase brain into the current repo.

  Usage:
    cortex-init [options]
    npx github:marinvch/ai-os [options]
    printf 'name\\npurpose\\nrule\\nagents\\n' | cortex-init   # non-interactive

  Options:
    --name <s>               Project name (default: package.json name / folder)
    --purpose <s>            One line: what the project does
    --rule <s>               A key rule the AI must always follow
    --agents <list>          claude,gemini,copilot,cursor  or  all   (default: all)
    --yes, -y                Accept all detected defaults; no prompts, no stdin
    --additive               Refresh skills only; never touch AGENTS.md / shims
    --register-to-vault <p>  Append a metadata-only project stub to <vault>/projects/
    --help, -h               Show this help

  Writes only inside the current repo (existing files backed up to *.bak), except
  --register-to-vault, which writes one metadata-only stub into the vault.
`);
}

main().catch((e) => { console.error('\n  cortex-init failed:', e.message); process.exit(1); });
