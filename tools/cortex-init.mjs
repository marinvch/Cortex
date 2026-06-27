#!/usr/bin/env node
/**
 * cortex-init — install a "codebase brain" into the current repo.
 *
 * Zero dependencies. Scans the repo, asks a few questions, then writes a single
 * source-of-truth AGENTS.md plus tiny shims so every AI agent (Claude, Gemini,
 * Copilot, Cursor) reads the same project knowledge — and Claude-only dev-cycle skills.
 *
 * Run from inside a repo:
 *   node path/to/cortex-init.mjs
 *   npx cortex-init            (once published / via github)
 *
 * Writes ONLY inside the current working directory. Backs up existing files to *.bak.
 */

import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { readFileSync, existsSync, mkdirSync, writeFileSync, copyFileSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';

const cwd = process.cwd();
const today = new Date().toISOString().slice(0, 10);

// ── helpers ──────────────────────────────────────────────────────────────────
const read = (p) => { try { return readFileSync(join(cwd, p), 'utf8'); } catch { return null; } };
const readJson = (p) => { const t = read(p); if (!t) return null; try { return JSON.parse(t); } catch { return null; } };
const has = (p) => existsSync(join(cwd, p));

function writeFile(relPath, content) {
  const abs = join(cwd, relPath);
  mkdirSync(join(abs, '..'), { recursive: true });
  if (existsSync(abs)) copyFileSync(abs, abs + '.bak'); // back up before overwrite
  writeFileSync(abs, content, 'utf8');
  console.log('  ✓ ' + relPath + (existsSync(abs + '.bak') ? '  (old → .bak)' : ''));
}

// ── 1. scan the repo ───────────────────────────────────────────────────────────
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

  const pm = has('pnpm-lock.yaml') ? 'pnpm' : has('yarn.lock') ? 'yarn' : has('bun.lockb') ? 'bun' : 'npm';
  const lang = has('tsconfig.json') || d('typescript') ? 'TypeScript' : 'JavaScript';
  const bundler = d('vite') ? 'Vite' : d('webpack') ? 'webpack' : pkg.scripts?.build?.includes('next') ? 'Next' : '';
  const styling = d('tailwindcss') ? 'Tailwind CSS' : d('styled-components') ? 'styled-components' : d('sass') ? 'Sass' : '';
  const testing = d('vitest') ? 'Vitest' : d('jest') ? 'Jest' : d('@playwright/test') ? 'Playwright' : '';

  const s = pkg.scripts || {};
  const runCmd = (name) => (s[name] ? `${pm} run ${name}` : '—');

  // top-level source dirs (ignore noise)
  const ignore = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.cache', 'coverage', '.claude', '.github', '.cursor']);
  let dirs = [];
  try { dirs = readdirSync(cwd, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith('.') && !ignore.has(e.name)).map((e) => e.name); } catch {}

  return {
    name: pkg.name || basename(cwd),
    framework, pm, lang, bundler, styling, testing,
    install: s.install ? `${pm} install` : `${pm} install`,
    dev: runCmd('dev') !== '—' ? runCmd('dev') : runCmd('start'),
    build: runCmd('build'), test: runCmd('test'), lint: runCmd('lint'),
    dirs,
  };
}

// ── 2. ask ───────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n  🧠 cortex-init — give this repo a codebase brain');
  console.log('  repo: ' + cwd + '\n');
  const i = detect();

  console.log('  Detected:');
  console.log(`    name: ${i.name} · ${i.framework} · ${i.lang} · ${i.pm}` +
    (i.styling ? ` · ${i.styling}` : '') + (i.testing ? ` · ${i.testing}` : ''));
  console.log(`    run: dev='${i.dev}' build='${i.build}' test='${i.test}' lint='${i.lint}'`);
  console.log(`    source dirs: ${i.dirs.join(', ') || '(none found)'}\n`);

  const rl = createInterface({ input, output });
  const ask = async (q, def) => ((await rl.question(`  ${q}${def ? ` [${def}]` : ''}: `)).trim() || def || '');

  const name = await ask('Project name', i.name);
  const purpose = await ask('One line — what does this project do?', '');
  const conventions = await ask('Any key rule the AI must follow? (optional)', '');
  const agentsAns = (await ask('Generate shims for which agents? (claude,gemini,copilot,cursor or "all")', 'all')).toLowerCase();
  rl.close();

  const want = (a) => agentsAns === 'all' || agentsAns.includes(a);

  // ── 3. write ─────────────────────────────────────────────────────────────────
  console.log('\n  Writing the brain...');

  writeFile('AGENTS.md', agentsMd({ ...i, name, purpose, conventions }));

  if (want('claude')) writeFile('CLAUDE.md', '@AGENTS.md\n');
  if (want('gemini')) writeFile('GEMINI.md', 'See AGENTS.md at the repo root for all project context, architecture, and conventions.\n');
  if (want('copilot')) writeFile('.github/copilot-instructions.md', 'All project context and conventions live in `AGENTS.md` at the repo root. Read and follow it.\n');
  if (want('cursor')) writeFile('.cursor/rules/project.mdc', '---\nalwaysApply: true\n---\nRead AGENTS.md at the repo root for architecture, conventions, and the development cycle.\n');

  writeFile('.claude/skills/plan-feature/SKILL.md', planFeatureSkill());
  writeFile('.claude/skills/investigate-bug/SKILL.md', investigateBugSkill());
  if (!has('docs/decisions.md')) writeFile('docs/decisions.md', `# Decision Log — ${name}\n\nAppend-only. Newest on top. Record why a technical call was made so it isn't re-litigated.\n`);

  console.log('\n  ✅ Done. This repo now has a brain.');
  console.log('  Next: open it in Claude Code and run /plan-feature when you start work.');
  console.log('  Review AGENTS.md and fix anything I guessed wrong, then commit it.\n');
}

// ── templates ──────────────────────────────────────────────────────────────────
function agentsMd(x) {
  return `# ${x.name} — Project Brain (codebase-scoped)

> AI instructions for THIS repo. Single source of truth — every agent reads it via its own shim.
> Generated by cortex-init on ${today}. Keep it accurate; edit it in pull requests.

## What this is
${x.purpose || '<one line: what this project does and who uses it>'}

## Stack & tooling
- Framework: ${x.framework} · Language: ${x.lang} · Package manager: ${x.pm}${x.bundler ? ` · Bundler: ${x.bundler}` : ''}
${x.styling ? `- Styling: ${x.styling}\n` : ''}${x.testing ? `- Testing: ${x.testing}\n` : ''}
## Run it
- install: \`${x.install}\` · dev: \`${x.dev}\` · build: \`${x.build}\` · test: \`${x.test}\` · lint: \`${x.lint}\`

## Architecture (key directories)
${x.dirs.length ? x.dirs.map((d) => `- \`${d}/\` — <what lives here>`).join('\n') : '- <map the important folders here>'}

## Conventions
- Standard to hold: clear, maintainable, scalable code.
${x.conventions ? `- ${x.conventions}\n` : ''}- <naming, component patterns, import rules — fill from the codebase>

## Development cycle (the hard rule)
1. **Plan before implementing.** No code until there's a written plan (use \`/plan-feature\`).
2. Break the plan into small, reviewable steps.
3. Implement step by step; run tests/lint after each.
4. Self-review against the conventions above before opening a PR.

## Gotchas / tribal knowledge
- <quirks, flaky areas, build traps — grows over time>

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

main().catch((e) => { console.error('\n  cortex-init failed:', e.message); process.exit(1); });
