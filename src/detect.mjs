import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';

/**
 * Read the repo and report what it actually is. Nothing here guesses — every field
 * is either read from a file or left null, so `AGENTS.md` never states a stack fact
 * the repository does not support.
 */

const read = (root, rel) => {
  try {
    return readFileSync(join(root, rel), 'utf8');
  } catch {
    return null;
  }
};

const readJson = (root, rel) => {
  const raw = read(root, rel);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

const has = (root, rel) => existsSync(join(root, rel));

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * A non-empty string, or null.
 *
 * `package.json` is a committed file in a repo we do not control, so its fields are input
 * on every run — the rule D11 states for `.manifest.json`, one file over. A `name` that is
 * an object used to reach the `AGENTS.md` heading as `[object Object]`, and a `description`
 * that is an array became the project's stated purpose. Neither is a fact the repo supports,
 * so neither is reported: the fallback runs instead, and where there is no fallback the
 * field is null and the renderer omits it.
 */
const str = (v) => {
  if (typeof v !== 'string') return null;
  const trimmed = v.trim();
  return trimmed || null;
};

const FRAMEWORKS = [
  ['Next.js', 'next'],
  ['Nuxt', 'nuxt'],
  ['Remix', '@remix-run/react'],
  ['Astro', 'astro'],
  ['SvelteKit', '@sveltejs/kit'],
  ['Angular', '@angular/core'],
  ['Vue', 'vue'],
  ['Svelte', 'svelte'],
  ['React', 'react'],
  ['NestJS', '@nestjs/core'],
  ['Express', 'express'],
  ['Fastify', 'fastify'],
  ['Hono', 'hono'],
];

const TEST_RUNNERS = [
  ['Vitest', 'vitest'],
  ['Jest', 'jest'],
  ['Playwright', '@playwright/test'],
  ['Mocha', 'mocha'],
  ['node:test', 'node:test'],
];

const NOTABLE_DIRS = [
  'src', 'app', 'pages', 'lib', 'components', 'server', 'api',
  'routes', 'services', 'packages', 'apps', 'cmd', 'internal', 'tests', 'test',
];

function detectPackageManager(root) {
  if (has(root, 'pnpm-lock.yaml')) return 'pnpm';
  if (has(root, 'yarn.lock')) return 'yarn';
  if (has(root, 'bun.lockb') || has(root, 'bun.lock')) return 'bun';
  if (has(root, 'package-lock.json')) return 'npm';
  return null;
}

function detectLanguages(root) {
  const langs = [];
  if (has(root, 'tsconfig.json')) langs.push('TypeScript');
  else if (has(root, 'package.json')) langs.push('JavaScript');
  if (has(root, 'pyproject.toml') || has(root, 'requirements.txt')) langs.push('Python');
  if (has(root, 'go.mod')) langs.push('Go');
  if (has(root, 'Cargo.toml')) langs.push('Rust');
  if (has(root, 'pom.xml') || has(root, 'build.gradle') || has(root, 'build.gradle.kts')) langs.push('Java');
  if (has(root, 'Gemfile')) langs.push('Ruby');
  if (has(root, 'composer.json')) langs.push('PHP');
  if (has(root, 'go.work')) langs.push('Go (workspace)');
  return langs;
}

function allDeps(pkg) {
  if (!pkg) return {};
  // Only an object is a dependency map. Spreading a string here produced `{"0":"n",…}`,
  // whose keys are not package names — harmless by luck rather than by design.
  return {
    ...(isPlainObject(pkg.dependencies) ? pkg.dependencies : {}),
    ...(isPlainObject(pkg.devDependencies) ? pkg.devDependencies : {}),
  };
}

function detectDirectories(root) {
  let entries;
  try {
    entries = readdirSync(root);
  } catch {
    return [];
  }
  return NOTABLE_DIRS.filter((d) => {
    if (!entries.includes(d)) return false;
    try {
      return statSync(join(root, d)).isDirectory();
    } catch {
      return false;
    }
  });
}

function detectLinters(root, deps) {
  const found = [];
  if (
    has(root, 'eslint.config.js') || has(root, 'eslint.config.mjs') ||
    has(root, '.eslintrc') || has(root, '.eslintrc.json') || has(root, '.eslintrc.js') ||
    'eslint' in deps
  ) found.push('ESLint');
  if (
    has(root, '.prettierrc') || has(root, '.prettierrc.json') ||
    has(root, 'prettier.config.js') || 'prettier' in deps
  ) found.push('Prettier');
  if (has(root, 'biome.json') || '@biomejs/biome' in deps) found.push('Biome');
  if (has(root, 'ruff.toml') || has(root, '.ruff.toml')) found.push('Ruff');
  return found;
}

/**
 * Strip the two things that make `tsconfig.json` JSONC rather than JSON: comments, and a
 * trailing comma before a closing brace. Both are legal there and `tsc --init` emits a file
 * that is mostly commented-out options.
 *
 * String-aware, because `//` is also how every `"$schema": "https://…"` value begins — the
 * same hazard `src/map.mjs` documents at its own comment strip, except that a truncated URL
 * there loses an import while here it would break the parse of the whole file.
 *
 * Known limit, and it degrades the honest way: a comment sitting *between* a trailing comma
 * and its closing brace leaves the comma in place, the parse fails, and the caller reports
 * null rather than a guess.
 */
function stripJsonc(text) {
  let out = '';
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      out += c;
      if (c === '\\') out += text[++i] ?? '';
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') {
      inString = true;
      out += c;
      continue;
    }
    if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      out += '\n';
      continue;
    }
    if (c === '/' && text[i + 1] === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i++;
      continue;
    }
    if (c === ',') {
      let j = i + 1;
      while (j < text.length && /\s/.test(text[j])) j++;
      if (text[j] === '}' || text[j] === ']') continue;
    }
    out += c;
  }
  return out;
}

/**
 * Whether TypeScript strict mode is actually in force: true, false, or null for "we cannot
 * tell". Null and false render identically — `src/render.mjs` speaks up only for true — so
 * the distinction costs the document nothing and keeps the fact honest.
 *
 * Read as parsed configuration rather than as text. The old regex searched the raw file for
 * `"strict": true`, so a line someone had commented out still reported the mode as on, and
 * `AGENTS.md` told every agent to "keep it on" in a repo where it was off. Same class of
 * defect as 46daf53, where the map reported commented-out code as structure.
 *
 * Absent is null, not false: `strict` may be arriving through `extends`, which we do not
 * follow, and reporting a setting we did not read is the fabrication this file exists to
 * avoid.
 */
function detectTsStrict(root) {
  const raw = read(root, 'tsconfig.json');
  if (raw === null) return null;

  let parsed;
  try {
    parsed = JSON.parse(stripJsonc(raw));
  } catch {
    return null;
  }
  if (!isPlainObject(parsed) || !isPlainObject(parsed.compilerOptions)) return null;

  const { strict } = parsed.compilerOptions;
  return typeof strict === 'boolean' ? strict : null;
}

function detectCI(root) {
  if (has(root, '.github/workflows')) return 'GitHub Actions';
  if (has(root, '.gitlab-ci.yml')) return 'GitLab CI';
  if (has(root, '.circleci/config.yml')) return 'CircleCI';
  return null;
}

/**
 * Image and badge markup: `![alt](src)`, and the linked form `[![alt](src)](href)` that a
 * CI or coverage badge almost always takes.
 *
 * The linked form is why the old `startsWith('![')` check was not enough — a badge wrapped
 * in a link starts with `[`, so the skip missed it and a shields.io URL became the first
 * thing every agent read about the repo.
 */
const BADGE = /\[!\[[^\]]*\]\([^)]*\)\][ \t]*\([^)]*\)|!\[[^\]]*\]\([^)]*\)/g;

/**
 * The first line of a README that is actually prose about the project.
 *
 * A badge row is skipped rather than salvaged: what is left of it is punctuation. A line
 * that merely *contains* a badge keeps its words, because a leading logo does not stop the
 * sentence beside it from being the description. When nothing qualifies the answer is null —
 * a fragment of markup would read as a finding, and this file states no fact it cannot support.
 *
 * Every unusable line is skipped and the search continues. The old version gave up on the
 * first one it could not use, so a `---` rule under the title — which strips to empty —
 * returned null and the project lost its purpose to a horizontal line.
 */
function firstProseLine(text) {
  if (!text) return null;

  const lines = text.split('\n');
  let start = 0;
  // YAML front matter: `---` on the first non-empty line, everything up to its closing `---`.
  // The keys inside are metadata, not a description, and returning `title: x` as the purpose
  // states something the author never wrote about the project.
  while (start < lines.length && !lines[start].trim()) start++;
  if (lines[start]?.trim() === '---') {
    const close = lines.findIndex((l, i) => i > start && l.trim() === '---');
    if (close !== -1) start = close + 1;
  }

  for (const raw of lines.slice(start)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith('<')) continue;
    // A quote or bullet marker is one of `> * + -` followed by whitespace. The old class
    // `[>*\-\s]+` also ate the opening of `**Bold** summary`, which then reported the
    // description as `Bold** summary` — mangled markup reading as a finding, the same
    // failure as the badge one line below.
    const prose = line
      .replace(/^(?:[>*+-]\s+)+/, '')
      .replace(BADGE, ' ')
      .trim();
    // Punctuation-only residue means the line was badges and separators — `· | —` and the
    // like — never a sentence.
    if (!prose || !/[\p{L}\p{N}]/u.test(prose)) continue;
    return prose;
  }
  return null;
}

export function detect(repoRoot) {
  // A manifest that is valid JSON but not an object — `42`, `[]`, `"a string"`, `null` —
  // is not a manifest, and reading fields off it is how a non-fact becomes a stack fact.
  const parsedPkg = readJson(repoRoot, 'package.json');
  const pkg = isPlainObject(parsedPkg) ? parsedPkg : null;
  const deps = allDeps(pkg);
  const scripts = isPlainObject(pkg?.scripts) ? pkg.scripts : {};
  const pm = detectPackageManager(repoRoot) ?? (pkg ? 'npm' : null);

  const framework = FRAMEWORKS.find(([, dep]) => dep in deps)?.[0] ?? null;
  const testRunner = TEST_RUNNERS.find(([, dep]) => dep in deps)?.[0] ?? null;

  // A script is a command only if it is a non-empty string. `"dev": 42` names nothing a
  // developer can run, so printing `pnpm run dev` would be a command we never verified.
  const run = (name) => {
    if (!str(scripts[name]) || !pm) return null;
    return name === 'test' && pm === 'npm' ? 'npm test' : `${pm} run ${name}`;
  };

  return {
    name: str(pkg?.name) ?? basename(repoRoot),
    purpose: str(pkg?.description) ?? firstProseLine(read(repoRoot, 'README.md')),
    languages: detectLanguages(repoRoot),
    packageManager: pm,
    framework,
    testRunner,
    scripts: {
      install: pm ? (pm === 'npm' ? 'npm install' : `${pm} install`) : null,
      dev: run('dev') ?? run('start'),
      build: run('build'),
      test: run('test'),
      lint: run('lint'),
    },
    directories: detectDirectories(repoRoot),
    linters: detectLinters(repoRoot, deps),
    ci: detectCI(repoRoot),
    tsStrict: detectTsStrict(repoRoot),
  };
}
