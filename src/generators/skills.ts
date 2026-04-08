import * as fs from 'fs';
import * as path from 'path';
import type { DetectedStack } from '../types.js';

const SKILLS_DIR = '.github/copilot/skills';
const AGENTS_SKILLS_DIR = '.agents/skills';

interface SkillSpec {
  templateFile: string;
  outputFile: string;
  replacements: Record<string, string>;
}

function buildSkillSpecs(stack: DetectedStack, cwd: string): SkillSpec[] {
  const specs: SkillSpec[] = [];
  const projectName = path.basename(cwd);
  const frameworks = stack.frameworks.map(f => f.name.toLowerCase());
  const packages = stack.allDependencies;
  const hasExpressLike = frameworks.some(f => ['express', 'fastify', 'hono', 'koa', 'nest'].some(x => f.includes(x)));
  const hasJavaSpringLike = frameworks.some(f => ['spring', 'quarkus', 'micronaut', 'java'].some(x => f.includes(x)));

  const templateDir = new URL('../templates/skills', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');

  const add = (template: string, output: string, replacements: Record<string, string> = {}) => {
    const templatePath = path.join(templateDir, template);
    if (fs.existsSync(templatePath)) {
      specs.push({
        templateFile: templatePath,
        outputFile: output,
        replacements: { '{{PROJECT_NAME}}': projectName, ...replacements },
      });
    }
  };

  // Next.js
  if (frameworks.some(f => f.includes('next'))) {
    add('nextjs.md', 'ai-os-nextjs-patterns.md');
  }

  // React (non-Next.js to avoid duplicate)
  if (frameworks.some(f => f.includes('react')) && !frameworks.some(f => f.includes('next'))) {
    add('react.md', 'ai-os-react-patterns.md');
  }

  // tRPC
  if (packages.includes('@trpc/server') || packages.includes('trpc')) {
    const trpcRouterFile = fs.existsSync(path.join(cwd, 'src/trpc/index.ts'))
      ? 'src/trpc/index.ts'
      : 'src/server/trpc.ts';
    add('trpc.md', 'ai-os-trpc-patterns.md', { '{{TRPC_ROUTER_FILE}}': trpcRouterFile });
  }

  // Prisma
  if (packages.includes('prisma') || packages.includes('@prisma/client')) {
    const schemaFile = fs.existsSync(path.join(cwd, 'prisma/schema.prisma'))
      ? 'prisma/schema.prisma'
      : 'schema.prisma';
    add('prisma.md', 'ai-os-prisma-patterns.md', { '{{SCHEMA_FILE}}': schemaFile });
  }

  // Stripe
  if (packages.includes('stripe')) {
    const plansFile = fs.existsSync(path.join(cwd, 'src/constants/stripe.ts'))
      ? 'src/constants/stripe.ts'
      : 'src/lib/stripe.ts';
    add('stripe.md', 'ai-os-billing-stripe.md', {
      '{{PLANS_FILE}}': plansFile,
      '{{STRIPE_LIB_FILE}}': fs.existsSync(path.join(cwd, 'src/lib/stripe.ts')) ? 'src/lib/stripe.ts' : plansFile,
      '{{WEBHOOK_FILE}}': 'src/app/api/webhooks/stripe/route.ts',
    });
  }

  // NextAuth
  if (packages.includes('next-auth') || packages.includes('nextauth')) {
    const authFile = fs.existsSync(path.join(cwd, 'src/app/api/auth/[...nextauth]/authOptions.ts'))
      ? 'src/app/api/auth/[...nextauth]/authOptions.ts'
      : 'src/lib/auth.ts';
    add('auth-nextauth.md', 'ai-os-auth-flow.md', { '{{AUTH_CONFIG_FILE}}': authFile });
  }

  // Supabase
  if (packages.includes('@supabase/supabase-js')) {
    add('supabase.md', 'ai-os-supabase-patterns.md');
  }

  // pgvector / RAG
  if (packages.includes('langchain') || packages.includes('@langchain/community') || packages.includes('pgvector')) {
    add('rag-pgvector.md', 'ai-os-rag-pipeline.md');
  }

  // Express/Nest/Fastify/Koa/Hono
  if (hasExpressLike) {
    add('express.md', 'ai-os-express-api.md');
  }

  // FastAPI / Django
  if (frameworks.some(f => f.includes('fastapi') || f.includes('django'))) {
    add('python-fastapi.md', 'ai-os-fastapi-patterns.md');
  }

  // Go
  if (stack.languages.some(l => l.name.toLowerCase() === 'go')) {
    add('go.md', 'ai-os-go-patterns.md');
  }

  // Java / Spring Boot
  if (hasJavaSpringLike) {
    add('java-spring.md', 'ai-os-java-spring-patterns.md');
  }

  return specs;
}

interface GenerateSkillsOptions {
  refreshExisting?: boolean;
}

async function generateSkillsWithOptions(
  stack: DetectedStack,
  cwd: string,
  options: GenerateSkillsOptions,
): Promise<string[]> {
  const skillsDir = path.join(cwd, SKILLS_DIR);
  fs.mkdirSync(skillsDir, { recursive: true });

  const specs = buildSkillSpecs(stack, cwd);
  const generated: string[] = [];

  for (const spec of specs) {
    const outputPath = path.join(skillsDir, spec.outputFile);

    // In safe mode, never overwrite existing skills.
    if (fs.existsSync(outputPath) && !options.refreshExisting) {
      continue;
    }

    let content = fs.readFileSync(spec.templateFile, 'utf-8');

    for (const [key, value] of Object.entries(spec.replacements)) {
      content = content.replaceAll(key, value);
    }

    fs.writeFileSync(outputPath, content, 'utf-8');
    generated.push(spec.outputFile);
  }

  return generated;
}

export async function generateSkills(
  stack: DetectedStack,
  cwd: string,
  options?: GenerateSkillsOptions,
): Promise<string[]> {
  return generateSkillsWithOptions(stack, cwd, { refreshExisting: options?.refreshExisting ?? false });
}

// ── Bundled agent skills (skill-creator, etc.) ───────────────────────────────

const BUNDLED_SKILLS: Array<{ dirName: string; label: string }> = [
  { dirName: 'skill-creator', label: 'skill-creator' },
];

function getBundledSkillSourceDir(dirName: string): string {
  // From src/generators/, go up two levels to the repo root, then into the skill folder.
  return new URL(`../../${dirName}`, import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');
}

export interface DeployBundledSkillsOptions {
  refreshExisting?: boolean;
}

export async function deployBundledSkills(
  cwd: string,
  options?: DeployBundledSkillsOptions,
): Promise<string[]> {
  const deployed: string[] = [];

  for (const skill of BUNDLED_SKILLS) {
    const sourceDir = getBundledSkillSourceDir(skill.dirName);
    const targetDir = path.join(cwd, AGENTS_SKILLS_DIR, skill.dirName);

    if (!fs.existsSync(sourceDir)) {
      continue; // source not found — skip silently
    }

    if (fs.existsSync(targetDir) && !options?.refreshExisting) {
      continue; // already installed, skip in safe mode
    }

    fs.mkdirSync(path.join(cwd, AGENTS_SKILLS_DIR), { recursive: true });
    fs.cpSync(sourceDir, targetDir, { recursive: true, force: true });
    deployed.push(skill.label);
  }

  return deployed;
}
