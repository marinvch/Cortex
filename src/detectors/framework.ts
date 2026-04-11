import fs from 'node:fs';
import path from 'node:path';
import type { DetectedFramework } from '../types.js';

interface PackageJson {
  name?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
  workspaces?: string[] | { packages: string[] };
}

function readJson<T>(filePath: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;
  } catch {
    return null;
  }
}

function readFile(filePath: string): string {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return '';
  }
}

function allDeps(pkg: PackageJson): Record<string, string> {
  return { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies };
}

function detectFromPackageJson(rootDir: string): DetectedFramework[] {
  const pkgPath = path.join(rootDir, 'package.json');
  const pkg = readJson<PackageJson>(pkgPath);
  if (!pkg) return [];

  const deps = allDeps(pkg);
  const frameworks: DetectedFramework[] = [];

  if (deps['next']) {
    frameworks.push({ name: 'Next.js', category: 'fullstack', version: deps['next'], template: 'nextjs' });
  } else if (deps['@remix-run/react'] || deps['@remix-run/node']) {
    const version = deps['@remix-run/react'] ?? deps['@remix-run/node'];
    frameworks.push({ name: 'Remix', category: 'fullstack', version, template: 'remix' });
  } else if (deps['@nuxt/core'] || deps['nuxt']) {
    frameworks.push({ name: 'Nuxt.js', category: 'fullstack', version: deps['nuxt'], template: 'nuxt' });
  } else if (deps['react']) {
    if (deps['vite'] || deps['@vitejs/plugin-react']) {
      frameworks.push({ name: 'React (Vite)', category: 'frontend', version: deps['react'], template: 'react' });
    } else {
      frameworks.push({ name: 'React', category: 'frontend', version: deps['react'], template: 'react' });
    }
  } else if (deps['solid-js']) {
    frameworks.push({ name: 'SolidJS', category: 'frontend', version: deps['solid-js'], template: 'solid' });
  } else if (deps['vue']) {
    frameworks.push({ name: 'Vue.js', category: 'frontend', version: deps['vue'], template: 'vue' });
  } else if (deps['svelte']) {
    frameworks.push({ name: 'Svelte', category: 'frontend', template: 'svelte' });
  } else if (deps['@angular/core']) {
    frameworks.push({ name: 'Angular', category: 'frontend', version: deps['@angular/core'], template: 'angular' });
  } else if (deps['astro']) {
    frameworks.push({ name: 'Astro', category: 'fullstack', version: deps['astro'], template: 'astro' });
  }

  if (deps['@nestjs/core']) {
    frameworks.push({ name: 'NestJS', category: 'backend', version: deps['@nestjs/core'], template: 'nestjs' });
  } else if (deps['express']) {
    frameworks.push({ name: 'Express', category: 'backend', version: deps['express'], template: 'express' });
  } else if (deps['fastify']) {
    frameworks.push({ name: 'Fastify', category: 'backend', version: deps['fastify'], template: 'express' });
  } else if (deps['hono']) {
    frameworks.push({ name: 'Hono', category: 'backend', version: deps['hono'], template: 'express' });
  } else if (deps['koa']) {
    frameworks.push({ name: 'Koa', category: 'backend', version: deps['koa'], template: 'express' });
  }

  if (deps['@trpc/server']) {
    frameworks.push({ name: 'tRPC', category: 'backend', template: 'trpc' });
  }
  if (deps['prisma'] || deps['@prisma/client']) {
    frameworks.push({ name: 'Prisma', category: 'backend', template: 'prisma' });
  }
  if (deps['drizzle-orm']) {
    frameworks.push({ name: 'Drizzle ORM', category: 'backend', template: 'drizzle' });
  }

  if (deps['react-native']) {
    frameworks.push({ name: 'React Native', category: 'mobile', version: deps['react-native'], template: 'react-native' });
  } else if (deps['expo']) {
    frameworks.push({ name: 'Expo', category: 'mobile', version: deps['expo'], template: 'expo' });
  }

  return frameworks;
}

function detectFromPython(rootDir: string): DetectedFramework[] {
  const files = ['requirements.txt', 'pyproject.toml', 'Pipfile', 'setup.py', 'setup.cfg'];
  const content = files.map(f => readFile(path.join(rootDir, f))).join('\n').toLowerCase();

  if (!content) return [];

  const frameworks: DetectedFramework[] = [];

  if (content.includes('django')) {
    frameworks.push({ name: 'Django', category: 'fullstack', template: 'python-django' });
  } else if (content.includes('fastapi')) {
    frameworks.push({ name: 'FastAPI', category: 'backend', template: 'python-fastapi' });
  } else if (content.includes('flask')) {
    frameworks.push({ name: 'Flask', category: 'backend', template: 'python-fastapi' });
  } else if (content.includes('starlette')) {
    frameworks.push({ name: 'Starlette', category: 'backend', template: 'python-fastapi' });
  }

  return frameworks;
}

function detectFromGo(rootDir: string): DetectedFramework[] {
  const goMod = readFile(path.join(rootDir, 'go.mod'));
  if (!goMod) return [];

  const frameworks: DetectedFramework[] = [];
  if (goMod.includes('gin-gonic/gin')) {
    frameworks.push({ name: 'Gin', category: 'backend', template: 'go' });
  } else if (goMod.includes('labstack/echo')) {
    frameworks.push({ name: 'Echo', category: 'backend', template: 'go' });
  } else if (goMod.includes('gofiber/fiber')) {
    frameworks.push({ name: 'Fiber', category: 'backend', template: 'go' });
  } else if (goMod.includes('go-chi/chi')) {
    frameworks.push({ name: 'Chi', category: 'backend', template: 'go' });
  } else {
    frameworks.push({ name: 'Go', category: 'backend', template: 'go' });
  }

  return frameworks;
}

function detectFromRust(rootDir: string): DetectedFramework[] {
  const cargo = readFile(path.join(rootDir, 'Cargo.toml'));
  if (!cargo) return [];

  const frameworks: DetectedFramework[] = [];
  if (cargo.includes('actix-web')) {
    frameworks.push({ name: 'Actix Web', category: 'backend', template: 'rust' });
  } else if (cargo.includes('axum')) {
    frameworks.push({ name: 'Axum', category: 'backend', template: 'rust' });
  } else if (cargo.includes('rocket')) {
    frameworks.push({ name: 'Rocket', category: 'backend', template: 'rust' });
  } else {
    frameworks.push({ name: 'Rust', category: 'backend', template: 'rust' });
  }

  return frameworks;
}

function detectFromJava(rootDir: string): DetectedFramework[] {
  const pomXml = readFile(path.join(rootDir, 'pom.xml'));
  const buildGradle = readFile(path.join(rootDir, 'build.gradle')) + readFile(path.join(rootDir, 'build.gradle.kts'));
  const content = pomXml + buildGradle;

  if (!content) return [];

  if (content.includes('spring-boot') || content.includes('spring-boot-starter')) {
    return [{ name: 'Spring Boot', category: 'backend', template: 'java-spring' }];
  } else if (content.includes('quarkus')) {
    return [{ name: 'Quarkus', category: 'backend', template: 'java-spring' }];
  } else if (content.includes('micronaut')) {
    return [{ name: 'Micronaut', category: 'backend', template: 'java-spring' }];
  }

  if (content) return [{ name: 'Java', category: 'backend', template: 'java-spring' }];
  return [];
}

function detectFromDotnet(rootDir: string): DetectedFramework[] {
  const entries = fs.readdirSync(rootDir);
  const csproj = entries.find(e => e.endsWith('.csproj'));
  const sln = entries.find(e => e.endsWith('.sln'));

  if (!csproj && !sln) return [];

  const csprojContent = csproj ? readFile(path.join(rootDir, csproj)).toLowerCase() : '';
  if (csprojContent.includes('aspnetcore') || csprojContent.includes('web')) {
    return [{ name: 'ASP.NET Core', category: 'backend', template: 'dotnet' }];
  }

  return [{ name: '.NET', category: 'backend', template: 'dotnet' }];
}

function detectFromRuby(rootDir: string): DetectedFramework[] {
  const gemfile = readFile(path.join(rootDir, 'Gemfile')).toLowerCase();
  if (!gemfile) return [];

  if (gemfile.includes('rails')) {
    return [{ name: 'Ruby on Rails', category: 'fullstack', template: 'ruby-rails' }];
  } else if (gemfile.includes('sinatra')) {
    return [{ name: 'Sinatra', category: 'backend', template: 'ruby-rails' }];
  }

  return [{ name: 'Ruby', category: 'backend', template: 'ruby-rails' }];
}

function detectFromPhp(rootDir: string): DetectedFramework[] {
  const composer = readJson<{ require?: Record<string, string> }>(path.join(rootDir, 'composer.json'));
  if (!composer) return [];

  const reqs = { ...composer.require };
  if (reqs['laravel/framework']) {
    return [{ name: 'Laravel', category: 'fullstack', template: 'php-laravel' }];
  } else if (reqs['symfony/symfony'] || reqs['symfony/framework-bundle']) {
    return [{ name: 'Symfony', category: 'backend', template: 'php-laravel' }];
  } else if (reqs['slim/slim']) {
    return [{ name: 'Slim', category: 'backend', template: 'php-laravel' }];
  }

  return [{ name: 'PHP', category: 'backend', template: 'php-laravel' }];
}

function detectBun(rootDir: string): DetectedFramework[] {
  // Detect bun.lockb lockfile on disk
  if (fs.existsSync(path.join(rootDir, 'bun.lockb'))) {
    return [{ name: 'Bun', category: 'backend', template: 'bun' }];
  }

  // Detect "packageManager": "bun@..." in package.json
  interface PkgWithPackageManager {
    packageManager?: string;
  }
  const pkg = readJson<PkgWithPackageManager>(path.join(rootDir, 'package.json'));
  if (pkg?.packageManager?.startsWith('bun')) {
    return [{ name: 'Bun', category: 'backend', template: 'bun' }];
  }

  return [];
}

function detectDeno(rootDir: string): DetectedFramework[] {
  const denoFiles = ['deno.json', 'deno.jsonc', 'deno.lock', 'import_map.json'];
  if (denoFiles.some(f => fs.existsSync(path.join(rootDir, f)))) {
    return [{ name: 'Deno', category: 'backend', template: 'deno' }];
  }
  return [];
}

export function detectFrameworks(rootDir: string): DetectedFramework[] {
  const frameworks: DetectedFramework[] = [
    ...detectFromPackageJson(rootDir),
    ...detectFromPython(rootDir),
    ...detectFromGo(rootDir),
    ...detectFromRust(rootDir),
    ...detectFromJava(rootDir),
    ...detectFromDotnet(rootDir),
    ...detectFromRuby(rootDir),
    ...detectFromPhp(rootDir),
    ...detectBun(rootDir),
    ...detectDeno(rootDir),
  ];

  // Deduplicate by name
  const seen = new Set<string>();
  return frameworks.filter(f => {
    if (seen.has(f.name)) return false;
    seen.add(f.name);
    return true;
  });
}
