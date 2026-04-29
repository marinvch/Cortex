/**
 * Recommendation registry — maps detected stack signals to tool recommendations.
 * Each entry maps a dependency key, framework name, or language to a set of
 * recommended MCP servers, VS Code extensions, agent skills, and Copilot extensions.
 */

export interface StackRecommendation {
  /** What triggered this recommendation */
  trigger: string;
  /** Recommended MCP server (npm package or GitHub repo) */
  mcp?: { package: string; description: string };
  /** Recommended VS Code extension IDs */
  vscode?: string[];
  /** AI OS skills to install */
  skills?: string[];
  /**
   * Source repository for each recommended skill, keyed by skill name.
   * When present the skills CLI source-based form is used:
   * `npx -y skills add <source>@<skill> -g -a github-copilot`
   */
  skillSources?: Record<string, string>;
  /** GitHub Copilot Extension */
  copilotExtension?: { name: string; url: string };
}

/** Dependency key → recommendation */
export const DEPENDENCY_RECOMMENDATIONS: Record<string, StackRecommendation> = {
  prisma: {
    trigger: 'prisma',
    mcp: { package: 'prisma/mcp-server', description: 'Official Prisma MCP server for schema-aware DB queries' },
    vscode: ['Prisma.prisma'],
    skills: ['prisma'],
  },
  '@prisma/client': {
    trigger: '@prisma/client',
    mcp: { package: 'prisma/mcp-server', description: 'Official Prisma MCP server for schema-aware DB queries' },
    vscode: ['Prisma.prisma'],
    skills: ['prisma'],
  },
  stripe: {
    trigger: 'stripe',
    skills: ['stripe'],
    copilotExtension: { name: 'Stripe Copilot Extension', url: 'https://marketplace.visualstudio.com/items?itemName=Stripe.stripe-vscode' },
    vscode: ['Stripe.stripe-vscode'],
  },
  '@trpc/server': {
    trigger: '@trpc/server',
    skills: ['trpc'],
  },
  '@trpc/client': {
    trigger: '@trpc/client',
    skills: ['trpc'],
  },
  next: {
    trigger: 'next',
    skills: ['nextjs', 'vercel-react-best-practices', 'context7'],
    skillSources: {
      'vercel-react-best-practices': 'vercel-labs/agent-skills',
      'context7': 'intellectronica/agent-skills',
    },
    vscode: ['bradlc.vscode-tailwindcss'],
  },
  'next.js': {
    trigger: 'next.js',
    skills: ['nextjs', 'vercel-react-best-practices', 'context7'],
    skillSources: {
      'vercel-react-best-practices': 'vercel-labs/agent-skills',
      'context7': 'intellectronica/agent-skills',
    },
    vscode: ['bradlc.vscode-tailwindcss'],
  },
  react: {
    trigger: 'react',
    skills: ['react', 'vercel-react-best-practices', 'context7'],
    skillSources: {
      'vercel-react-best-practices': 'vercel-labs/agent-skills',
      'context7': 'intellectronica/agent-skills',
    },
    vscode: ['dsznajder.es7-react-js-snippets', 'burkeholland.simple-react-snippets'],
  },
  nuxt: {
    trigger: 'nuxt',
    skills: ['context7'],
    vscode: ['Vue.volar'],
  },
  vue: {
    trigger: 'vue',
    vscode: ['Vue.volar'],
    skills: ['context7'],
  },
  'express': {
    trigger: 'express',
    skills: ['express'],
  },
  'fastapi': {
    trigger: 'fastapi',
    skills: ['python-fastapi', 'context7'],
    vscode: ['ms-python.python'],
  },
  'django': {
    trigger: 'django',
    vscode: ['ms-python.python', 'batisteo.vscode-django'],
    skills: ['context7'],
  },
  supabase: {
    trigger: 'supabase',
    mcp: { package: '@supabase/mcp-server-supabase', description: 'Official Supabase MCP server' },
    skills: ['supabase'],
    vscode: ['supabase.vscode-supabase-extension'],
  },
  '@supabase/supabase-js': {
    trigger: '@supabase/supabase-js',
    mcp: { package: '@supabase/mcp-server-supabase', description: 'Official Supabase MCP server' },
    skills: ['supabase'],
  },
  drizzle: {
    trigger: 'drizzle-orm',
    skills: ['prisma'], // drizzle uses similar patterns
  },
  'drizzle-orm': {
    trigger: 'drizzle-orm',
    skills: ['context7'],
  },
};

/** Framework name → recommendation */
export const FRAMEWORK_RECOMMENDATIONS: Record<string, StackRecommendation> = {
  'Next.js': {
    trigger: 'Next.js',
    skills: ['nextjs', 'vercel-react-best-practices', 'context7'],
    skillSources: {
      'vercel-react-best-practices': 'vercel-labs/agent-skills',
      'context7': 'intellectronica/agent-skills',
    },
    vscode: ['dsznajder.es7-react-js-snippets', 'bradlc.vscode-tailwindcss'],
  },
  'React': {
    trigger: 'React',
    skills: ['react', 'vercel-react-best-practices', 'context7'],
    skillSources: {
      'vercel-react-best-practices': 'vercel-labs/agent-skills',
      'context7': 'intellectronica/agent-skills',
    },
    vscode: ['dsznajder.es7-react-js-snippets'],
  },
  'Express': {
    trigger: 'Express',
    skills: ['express'],
  },
  'NestJS': {
    trigger: 'NestJS',
    vscode: ['nrwl.angular-console'],
    skills: ['context7'],
  },
  'FastAPI': {
    trigger: 'FastAPI',
    skills: ['python-fastapi', 'context7'],
    vscode: ['ms-python.python'],
  },
  'Spring Boot': {
    trigger: 'Spring Boot',
    skills: ['java-spring', 'context7'],
    vscode: ['vscjava.vscode-java-pack', 'redhat.java'],
  },
  'Astro': {
    trigger: 'Astro',
    vscode: ['astro-build.astro-vscode'],
    skills: ['context7'],
  },
  'SvelteKit': {
    trigger: 'SvelteKit',
    vscode: ['svelte.svelte-vscode'],
    skills: ['context7'],
  },
  'Svelte': {
    trigger: 'Svelte',
    vscode: ['svelte.svelte-vscode'],
  },
  'Nuxt': {
    trigger: 'Nuxt',
    vscode: ['Vue.volar'],
    skills: ['context7'],
  },
  'Vue': {
    trigger: 'Vue',
    vscode: ['Vue.volar'],
  },
  'tRPC': {
    trigger: 'tRPC',
    skills: ['trpc'],
  },
  'Prisma': {
    trigger: 'Prisma',
    mcp: { package: 'prisma/mcp-server', description: 'Official Prisma MCP server' },
    vscode: ['Prisma.prisma'],
    skills: ['prisma'],
  },
  'WordPress': {
    trigger: 'WordPress',
    vscode: ['wongjn.php-sniffer', 'bmewburn.vscode-intelephense-client'],
    skills: ['wordpress', 'context7'],
    skillSources: {
      'context7': 'intellectronica/agent-skills',
    },
    copilotExtension: { name: 'WordPress Agent Skills', url: 'https://github.com/WordPress/agent-skills' },
  },
  'Laravel': {
    trigger: 'Laravel',
    vscode: ['bmewburn.vscode-intelephense-client', 'onecentlin.laravel5-snippets'],
    skills: ['context7'],
    skillSources: {
      'context7': 'intellectronica/agent-skills',
    },
  },
};

/** Language name → recommendation */
export const LANGUAGE_RECOMMENDATIONS: Record<string, StackRecommendation> = {
  'TypeScript': {
    trigger: 'TypeScript',
    vscode: ['ms-vscode.vscode-typescript-next'],
  },
  'Go': {
    trigger: 'Go',
    vscode: ['golang.go'],
    skills: ['context7'],
  },
  'Rust': {
    trigger: 'Rust',
    vscode: ['rust-lang.rust-analyzer'],
    skills: ['context7'],
  },
  'Python': {
    trigger: 'Python',
    vscode: ['ms-python.python', 'ms-python.black-formatter'],
    skills: ['context7'],
  },
  'Java': {
    trigger: 'Java',
    vscode: ['vscjava.vscode-java-pack'],
    skills: ['context7'],
  },
  'Ruby': {
    trigger: 'Ruby',
    vscode: ['Shopify.ruby-lsp'],
  },
  'PHP': {
    trigger: 'PHP',
    vscode: ['bmewburn.vscode-intelephense-client'],
  },
};

/** Always-recommended universal tools */
export const UNIVERSAL_RECOMMENDATIONS: StackRecommendation[] = [
  {
    trigger: 'universal',
    skills: ['find-skills', 'context7'],
    skillSources: {
      'find-skills': 'vercel-labs/skills',
      'context7': 'intellectronica/agent-skills',
    },
  },
];
