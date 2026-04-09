import * as fs from 'fs';
import * as path from 'path';
import type { DetectedStack } from '../types.js';
import { writeIfChanged, applyFallbacks } from './utils.js';

const AGENTS_DIR = '.github/agents';

interface AgentSpec {
  templateFile: string;
  outputFile: string;
  name: string;
  description: string;
  argumentHint: string;
  model?: string;
  tools?: string[];
  replacements: Record<string, string>;
}

function toBulletList(items: string[]): string {
  if (items.length === 0) return '- _No items detected yet_';
  return items.map(item => `- ${item}`).join('\n');
}

function buildFrameworkRules(stack: DetectedStack): string {
  const frameworkNames = stack.frameworks.map(f => f.name.toLowerCase());
  const rules: string[] = [];

  if (frameworkNames.some(name => name.includes('next'))) {
    rules.push('- Keep Server Components as default and isolate client-only code behind `\'use client\'` boundaries');
    rules.push('- Route handlers should validate input and return typed JSON responses');
  }

  if (frameworkNames.some(name => name.includes('react'))) {
    rules.push('- Keep components focused; extract data and business logic to hooks/util modules');
  }

  if (stack.patterns.hasTypeScript) {
    rules.push('- Keep strict typing; avoid `any` unless there is a documented boundary reason');
  }

  if (rules.length === 0) {
    rules.push('- Follow conventions from `.github/ai-os/context/conventions.md` for naming, structure, and safety checks');
  }

  return rules.join('\n');
}

function buildAgentSpecs(stack: DetectedStack, cwd: string): AgentSpec[] {
  const specs: AgentSpec[] = [];
  const projectName = path.basename(cwd);
  const frameworks = stack.frameworks.map(f => f.name);
  const packages = stack.allDependencies;
  const primaryLang = stack.languages[0]?.name ?? 'TypeScript';
  const hasPrisma = packages.some(p => p.includes('prisma'));
  const hasAuth = packages.some(p => ['next-auth', 'nextauth', 'passport', 'django.contrib.auth', 'flask-login'].some(a => p.toLowerCase().includes(a)));
  const hasStripe = packages.some(p => p.toLowerCase().includes('stripe'));
  const hasNextjs = frameworks.some(f => f.toLowerCase().includes('next'));
  const hasReact = frameworks.some(f => ['react', 'next', 'remix', 'gatsby'].some(k => f.toLowerCase().includes(k)));
  const primaryFramework = frameworks[0] ?? primaryLang;
  const frameworkLabel = hasNextjs ? 'Next.js' : primaryFramework;
  const frameworkList = frameworks.length > 0 ? frameworks.join(', ') : primaryLang;

  const stackSummary = [
    `Primary language: ${primaryLang}`,
    `Frameworks: ${frameworkList}`,
    `Package manager: ${stack.patterns.packageManager}`,
    `TypeScript: ${stack.patterns.hasTypeScript ? 'Yes' : 'No'}`,
  ];

  const keyFiles = [
    'src/trpc/index.ts',
    'src/lib/vector-store.ts',
    'src/app/api/chat/route.ts',
    'src/components/ChatInterface.tsx',
    'prisma/schema.prisma',
  ].filter(f => fs.existsSync(path.join(cwd, f)));

  const keyFilesList = toBulletList(keyFiles.map(file => `\`${file}\``));
  const keyEntryPoints = toBulletList((keyFiles.slice(0, 4).length > 0 ? keyFiles.slice(0, 4) : ['src/']).map(file => `\`${file}\``));

  const templateDir = new URL('../templates/agents', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');

  // 1. Repo initializer — always
  specs.push({
    templateFile: path.join(templateDir, 'repo-initializer.md'),
    outputFile: `${projectName.toLowerCase().replace(/[^a-z0-9-]/g, '-')}-initializer.agent.md`,
    name: `${projectName} Initializer`,
    description: `Maintain and evolve the AI framework artifacts for the ${projectName} repo (docs, skills, prompts) using the real ${frameworkLabel} stack.`,
    argumentHint: 'What artifact to update or create (e.g. "update skills", "add agent for auth")',
    replacements: {
      '{{PROJECT_NAME}}': projectName,
      '{{FRAMEWORK}}': frameworkLabel,
      '{{FRAMEWORK_LIST}}': frameworkList,
      '{{CONVENTIONS_FILE}}': '.github/ai-os/context/conventions.md',
      '{{STACK_FILE}}': '.github/ai-os/context/stack.md',
      '{{ARCHITECTURE_FILE}}': '.github/ai-os/context/architecture.md',
      '{{CONVENTIONS_SUMMARY}}': toBulletList([
        'Treat `.github/ai-os/context/conventions.md` as source of truth for naming and structure',
        'Prefer safe, incremental edits with clear rollback points',
        'Refresh AI artifacts after architecture or workflow changes',
      ]),
    },
  });

  // 2. Framework expert — always
  specs.push({
    templateFile: path.join(templateDir, 'framework-expert.md'),
    outputFile: `expert-${frameworkLabel.toLowerCase().replace(/[^a-z0-9]/g, '-')}-developer.agent.md`,
    name: `Expert ${frameworkLabel} Developer`,
    description: `Expert ${frameworkLabel} developer specializing in ${primaryLang} patterns for ${projectName}.`,
    argumentHint: 'Describe the feature, bug or refactor you need help with',
    replacements: {
      '{{PROJECT_NAME}}': projectName,
      '{{FRAMEWORK}}': frameworkLabel,
      '{{STACK_SUMMARY}}': toBulletList(stackSummary),
      '{{KEY_FILES_LIST}}': keyFilesList,
      '{{CONVENTIONS_FILE}}': '.github/ai-os/context/conventions.md',
      '{{ARCHITECTURE_FILE}}': '.github/ai-os/context/architecture.md',
      '{{STACK_FILE}}': '.github/ai-os/context/stack.md',
      '{{BUILD_COMMAND}}': stack.patterns.packageManager === 'npm' ? 'npm run build' : `${stack.patterns.packageManager} build`,
      '{{FRAMEWORK_RULES}}': buildFrameworkRules(stack),
    },
  });

  // 3. Codebase explorer — always
  specs.push({
    templateFile: path.join(templateDir, 'codebase-explorer.md'),
    outputFile: 'codebase-explorer.agent.md',
    name: 'Codebase Explorer',
    description: `Read-only navigator for ${projectName} — answers "how does X work?" questions.`,
    argumentHint: 'Ask about any feature, file, or pattern (e.g. "how does auth work?")',
    replacements: {
      '{{PROJECT_NAME}}': projectName,
      '{{STACK_SUMMARY}}': toBulletList(stackSummary),
      '{{KEY_ENTRY_POINTS}}': keyEntryPoints,
    },
  });

  // 4. DB expert — if Prisma or other ORM detected
  if (hasPrisma) {
    const schemaFile = fs.existsSync(path.join(cwd, 'prisma/schema.prisma'))
      ? 'prisma/schema.prisma'
      : 'schema.prisma';
    specs.push({
      templateFile: path.join(templateDir, 'db-expert.md'),
      outputFile: 'expert-database.agent.md',
      name: 'Database Expert',
      description: `Prisma ORM expert for ${projectName} — schema design, migrations, query optimization.`,
      argumentHint: 'Describe the DB change, schema question, or query you need',
      replacements: {
        '{{PROJECT_NAME}}': projectName,
        '{{ORM}}': 'Prisma',
        '{{DATABASE}}': 'PostgreSQL (Supabase)',
        '{{SCHEMA_FILE}}': schemaFile,
        '{{MIGRATIONS_DIR}}': 'prisma/migrations',
        '{{STACK_SUMMARY}}': toBulletList(stackSummary),
        '{{MIGRATE_COMMAND}}': 'npx prisma migrate dev --name <name>',
        '{{GENERATE_COMMAND}}': 'npx prisma generate',
        '{{RAW_SQL_FILE}}': 'src/server/db/raw-sql.ts',
      },
    });
  }

  // 5. Auth expert — if auth detected
  if (hasAuth) {
    const authProvider = hasAuth && packages.some(p => p.includes('next-auth')) ? 'NextAuth.js' : 'Auth';
    const authFile = 'src/app/api/auth/[...nextauth]/authOptions.ts';
    specs.push({
      templateFile: path.join(templateDir, 'auth-expert.md'),
      outputFile: 'expert-auth.agent.md',
      name: 'Auth Expert',
      description: `${authProvider} expert for ${projectName} — providers, sessions, route protection.`,
      argumentHint: 'Describe the auth feature, provider, or protection you need',
      replacements: {
        '{{PROJECT_NAME}}': projectName,
        '{{AUTH_PROVIDER}}': authProvider,
        '{{AUTH_STRATEGY}}': 'JWT',
        '{{AUTH_CONFIG_FILE}}': authFile,
        '{{AUTH_SESSION_HELPER}}': 'getServerSession() from src/lib/auth.ts',
        '{{AUTH_DESCRIPTION}}': toBulletList([
          'Server routes and protected pages read identity from the validated session only',
          'Authorization checks must happen on the server boundary before data access',
          'Provider setup and callback behavior should remain centralized in the auth config file',
        ]),
      },
    });
  }

  // 6. Payments expert — if Stripe detected
  if (hasStripe) {
    const plansFile = fs.existsSync(path.join(cwd, 'src/constants/stripe.ts'))
      ? 'src/constants/stripe.ts'
      : 'src/lib/stripe.ts';
    specs.push({
      templateFile: path.join(templateDir, 'payments-expert.md'),
      outputFile: 'expert-payments.agent.md',
      name: 'Payments Expert',
      description: `Stripe billing expert for ${projectName} — subscriptions, webhooks, plan enforcement.`,
      argumentHint: 'Describe the billing feature, webhook, or plan change you need',
      replacements: {
        '{{PROJECT_NAME}}': projectName,
        '{{PAYMENT_PROVIDER}}': 'Stripe',
        '{{PLANS_FILE}}': plansFile,
        '{{WEBHOOK_FILE}}': 'src/app/api/webhooks/stripe/route.ts',
        '{{STRIPE_LIB_FILE}}': 'src/lib/stripe.ts',
        '{{CHECKOUT_PROCEDURE}}': 'createCheckoutSession / createBillingPortalSession',
        '{{BILLING_DESCRIPTION}}': toBulletList([
          'Plan metadata is source-of-truth for feature gating',
          'Webhook processing updates subscription state in persistent storage',
          'Checkout and billing portal links should be generated server-side only',
        ]),
      },
    });
  }

  return specs;
}

function injectReplacements(template: string, replacements: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(replacements)) {
    result = result.replaceAll(key, value);
  }
  return result;
}

interface GenerateAgentsOptions {
  refreshExisting?: boolean;
}

async function generateAgentsWithOptions(
  stack: DetectedStack,
  cwd: string,
  options: GenerateAgentsOptions,
): Promise<string[]> {
  const agentsDir = path.join(cwd, AGENTS_DIR);
  fs.mkdirSync(agentsDir, { recursive: true });

  // Build a set of "concepts" already covered by existing agent files
  const existingFiles = fs.existsSync(agentsDir)
    ? fs.readdirSync(agentsDir).map((f: string) => f.toLowerCase())
    : [];

  function conceptCovered(keywords: string[]): boolean {
    return existingFiles.some((f: string) => keywords.some((k: string) => f.includes(k)));
  }

  const specs = buildAgentSpecs(stack, cwd);
  const generated: string[] = [];

  for (const spec of specs) {
    const outputPath = path.join(agentsDir, spec.outputFile);

    // In safe mode, skip existing files.
    if (fs.existsSync(outputPath) && !options.refreshExisting) continue;

    // In safe mode, skip conceptually equivalent existing agents.
    if (!options.refreshExisting) {
      const baseKeywords = spec.outputFile.replace('.agent.md', '').split('-').filter(w => w.length > 3);
      if (conceptCovered(baseKeywords)) continue;
    }

    if (!fs.existsSync(spec.templateFile)) {
      console.warn(`  ⚠ Agent template not found: ${spec.templateFile}`);
      continue;
    }

    let content = fs.readFileSync(spec.templateFile, 'utf-8');

    // Inject frontmatter values
    content = content
      .replace(/^name:.*$/m, `name: ${spec.name}`)
      .replace(/^description:.*$/m, `description: ${spec.description}`)
      .replace(/^argument-hint:.*$/m, `argument-hint: "${spec.argumentHint}"`);

    if (spec.model) {
      content = content.replace(/^model:.*$/m, `model: ${spec.model}`);
    }

    // Inject template placeholders
    content = injectReplacements(content, spec.replacements);

    // #9 — strip any unresolved {{PLACEHOLDER}} fragments rather than leaking
    //      raw template syntax into the output file.
    const unresolved = content.match(/\{\{[^}]+\}\}/g);
    if (unresolved && unresolved.length > 0) {
      console.warn(`  ⚠ Unresolved placeholders in ${spec.outputFile}: ${Array.from(new Set(unresolved)).join(', ')} — removing`);
      content = applyFallbacks(content);
    }

    writeIfChanged(outputPath, content);
    generated.push(outputPath);
  }

  return generated;
}

export async function generateAgents(
  stack: DetectedStack,
  cwd: string,
  options?: GenerateAgentsOptions,
): Promise<string[]> {
  return generateAgentsWithOptions(stack, cwd, { refreshExisting: options?.refreshExisting ?? false });
}
