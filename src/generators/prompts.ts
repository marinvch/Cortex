import * as fs from 'fs';
import * as path from 'path';
import type { DetectedStack } from '../types.js';

const PROMPTS_FILE = '.github/copilot/prompts.json';

interface PromptEntry {
  id: string;
  title: string;
  description: string;
  prompt: string;
}

interface PromptsFile {
  version: number;
  prompts: PromptEntry[];
}

function buildPrompts(stack: DetectedStack, cwd: string): PromptEntry[] {
  const prompts: PromptEntry[] = [];
  const frameworks = stack.frameworks.map(f => f.name.toLowerCase());
  const packages = stack.allDependencies;
  const hasNext = frameworks.some(f => f.includes('next'));
  const hasNuxt = frameworks.some(f => f.includes('nuxt'));
  const hasVue = frameworks.some(f => f.includes('vue'));
  const hasAngular = frameworks.some(f => f.includes('angular'));
  const hasAstro = frameworks.some(f => f.includes('astro'));
  const hasNest = frameworks.some(f => f.includes('nest'));
  const hasExpressLike = frameworks.some(f => ['express', 'fastify', 'hono', 'koa'].some(x => f.includes(x)));
  const hasFastApi = frameworks.some(f => f.includes('fastapi'));
  const hasDjango = frameworks.some(f => f.includes('django'));
  const hasLaravel = frameworks.some(f => f.includes('laravel'));
  const hasSpring = frameworks.some(f => f.includes('spring'));
  const hasDotnet = frameworks.some(f => f.includes('.net') || f.includes('asp.net'));
  const hasTrpc = packages.includes('@trpc/server') || packages.includes('trpc');
  const hasPrisma = packages.includes('prisma') || packages.includes('@prisma/client');
  const hasStripe = packages.includes('stripe');
  const hasAuth = packages.includes('next-auth') || packages.includes('nextauth');
  const hasVector = packages.some(p => p.includes('langchain') || p.includes('pgvector'));

  if (hasNext) {
    prompts.push({
      id: '/new-page',
      title: 'New App Router Page',
      description: 'Create a new Next.js App Router page with auth guard',
      prompt: `Create a new Next.js 15 App Router page at the path I specify.
Requirements:
- Server Component by default (no 'use client' unless needed)
- Guard with getServerSession() → redirect to /auth/signin if no session
- Pass any data to a Client Component child only if interactivity is needed
- Use TypeScript strict types
- Follow the project conventions in .ai-os/context/conventions.md`,
    });

    prompts.push({
      id: '/new-api-route',
      title: 'New API Route',
      description: 'Create a Next.js API route handler',
      prompt: `Create a new Next.js API route handler at the path I specify.
Requirements:
- Use NextRequest / NextResponse
- Validate auth with getServerSession() → return 401 if missing
- Parse and validate request body with Zod (create schema in src/validators/ if needed)
- Return structured JSON responses
- Use try/catch and return appropriate HTTP status codes
- Do NOT create an API route for data that can be a tRPC procedure`,
    });
  }

  if (hasNuxt || hasVue) {
    prompts.push({
      id: '/new-vue-page',
      title: 'New Vue/Nuxt Page',
      description: 'Create a new Vue or Nuxt page/component with typed props and data flow',
      prompt: `Create a new ${hasNuxt ? 'Nuxt page' : 'Vue page/component'} at the path I specify.
Requirements:
- Use script setup with TypeScript
- Keep page-level data fetching in a composable/service, not in deeply nested components
- Validate route params and external data shapes
- Keep component state minimal and derive where possible
- Follow the conventions in .ai-os/context/conventions.md`,
    });
  }

  if (hasAngular) {
    prompts.push({
      id: '/new-angular-feature',
      title: 'New Angular Feature',
      description: 'Create a feature module/standalone component with typed service integration',
      prompt: `Create a new Angular feature (standalone component + service) at the path I specify.
Requirements:
- Use strict TypeScript typing and typed HttpClient responses
- Put business logic in services, keep components focused on presentation
- Use reactive forms for non-trivial form inputs
- Add guard/interceptor wiring if auth is required
- Follow naming and structure conventions from .ai-os/context/conventions.md`,
    });
  }

  if (hasAstro) {
    prompts.push({
      id: '/new-astro-page',
      title: 'New Astro Page',
      description: 'Create a new Astro page with islands only where interactivity is required',
      prompt: `Create a new Astro page at the path I specify.
Requirements:
- Keep content/server rendering first; only hydrate islands where necessary
- Use typed frontmatter and validate external inputs
- Extract reusable UI into components and data loaders into utility modules
- Ensure route and file naming follow project conventions`,
    });
  }

  if (hasNest || hasExpressLike) {
    prompts.push({
      id: '/new-backend-endpoint',
      title: 'New Backend Endpoint',
      description: 'Create a typed backend endpoint with validation, auth boundary checks, and service layer',
      prompt: `Create a new backend endpoint at the path I specify.
Requirements:
- Validate input payload and params with Zod or framework-native validation
- Keep controller/route handlers thin and delegate business logic to services
- Enforce auth/authorization at the boundary
- Return consistent error response shapes and status codes
- Add unit/integration test scaffolding for happy path + validation failure`,
    });
  }

  if (hasFastApi) {
    prompts.push({
      id: '/new-fastapi-route',
      title: 'New FastAPI Route',
      description: 'Create an async FastAPI route with Pydantic models and service delegation',
      prompt: `Create a new FastAPI route in the module I specify.
Requirements:
- Use async handlers and Pydantic request/response schemas
- Keep endpoint logic thin; move business rules into services
- Add explicit HTTPException handling for expected error paths
- Include pytest test skeleton with AsyncClient`,
    });
  }

  if (hasDjango) {
    prompts.push({
      id: '/new-django-api',
      title: 'New Django API Endpoint',
      description: 'Create a Django endpoint with serializer/form validation and scoped query logic',
      prompt: `Create a new Django API endpoint at the location I specify.
Requirements:
- Validate request data with serializers/forms
- Keep DB access scoped to the authenticated user when applicable
- Keep business logic out of views and in services/managers
- Add tests for authorization, validation, and success responses`,
    });
  }

  if (hasLaravel) {
    prompts.push({
      id: '/new-laravel-endpoint',
      title: 'New Laravel Endpoint',
      description: 'Create a new Laravel API endpoint with Form Request validation and service-layer logic',
      prompt: `Create a new Laravel API endpoint and wire it in routes/api.php.
Requirements:
- Use Form Request classes for validation
- Keep controller actions thin and move domain logic to services
- Enforce auth/policy checks before data mutation
- Add feature tests for success and validation errors`,
    });
  }

  if (hasSpring) {
    prompts.push({
      id: '/new-spring-endpoint',
      title: 'New Spring Endpoint',
      description: 'Create a Spring REST endpoint with DTO validation and service abstraction',
      prompt: `Create a new Spring Boot REST endpoint.
Requirements:
- Use DTOs with bean validation annotations
- Keep controller thin and delegate to service classes
- Map domain exceptions to appropriate HTTP status responses
- Add a unit test (service) and web layer test (controller) skeleton`,
    });
  }

  if (hasDotnet) {
    prompts.push({
      id: '/new-dotnet-endpoint',
      title: 'New .NET Endpoint',
      description: 'Create an ASP.NET Core endpoint with validation and service-layer boundaries',
      prompt: `Create a new ASP.NET Core endpoint.
Requirements:
- Use request/response DTOs and model validation
- Keep endpoint/controller minimal; push business logic into services
- Enforce authorization attributes/policies where required
- Add test skeletons for validation and successful execution`,
    });
  }

  if (hasTrpc) {
    prompts.push({
      id: '/new-trpc-procedure',
      title: 'New tRPC Procedure',
      description: 'Add a new tRPC query or mutation to src/trpc/index.ts',
      prompt: `Add a new tRPC procedure to src/trpc/index.ts.
Requirements:
- Use privateProcedure if it requires auth (most cases), publicProcedure only if explicitly public
- Validate input with Zod (.input(z.object({...})))
- Always scope DB queries by ctx.userId
- Throw TRPCError with appropriate code on failures
- Add any new validators to src/validators/
- Also show me the client usage pattern (trpc.<name>.useQuery / useMutation)`,
    });
  }

  if (hasPrisma) {
    prompts.push({
      id: '/new-model',
      title: 'New Prisma Model',
      description: 'Add a new Prisma model to schema.prisma + generate migration',
      prompt: `Add a new Prisma model to the schema.
Requirements:
- Add to prisma/schema.prisma with proper types, relations, and @@map for snake_case table names
- Include id (cuid), createdAt, updatedAt fields
- Add any necessary indexes with @@index
- Show me the migration command: npx prisma migrate dev --name <name>
- Show me any new tRPC procedures or API routes needed to expose the model
- Follow the existing model patterns in the schema`,
    });
  }

  if (hasStripe) {
    prompts.push({
      id: '/add-plan',
      title: 'Add Subscription Plan',
      description: 'Add a new Stripe subscription plan tier',
      prompt: `Add a new subscription plan tier to the project.
Requirements:
- Add to src/constants/stripe.ts with appropriate limits (quota, maxFileSizeMb, messageLimit)
- Create the product/price in Stripe dashboard and update the price ID
- Update getUserSubscriptionPlan() in src/lib/stripe.ts if plan lookup logic changes
- Show me which enforcement points need updating (upload route, chat route, etc.)
- Show me any UI changes needed in the pricing page`,
    });
  }

  if (hasAuth) {
    prompts.push({
      id: '/add-oauth',
      title: 'Add OAuth Provider',
      description: 'Add a new OAuth provider to NextAuth.js',
      prompt: `Add a new OAuth provider to the NextAuth.js config.
Requirements:
- Add provider to src/app/api/auth/[...nextauth]/authOptions.ts
- Use conditional inclusion if env vars are present (so app works without the provider set)
- List the required environment variables to add to .env.local
- Show the OAuth app callback URL to configure in the provider dashboard
- Ensure user is upserted in the signIn callback with the provider's data`,
    });
  }

  if (hasVector) {
    prompts.push({
      id: '/rag-query',
      title: 'RAG Query / Retrieval',
      description: 'Write or optimize a vector similarity search query',
      prompt: `Write or optimize a pgvector similarity search query for the RAG pipeline.
Requirements:
- Use cosine distance (<->) on the document_chunks table
- Always scope by fileId (prevent cross-user leakage)
- Return top-K results with content + metadata (pageNumber, snippet)
- Ensure the embedding is 384D (HuggingFace MiniLM-L6-v2)
- Show me how to integrate the results into the SSE stream format
- Reference src/lib/vector-store.ts and src/app/api/chat/route.ts`,
    });
  }

  // Always add these utility prompts
  prompts.push({
    id: '/explain-file',
    title: 'Explain File',
    description: 'Get a detailed explanation of a file in the codebase',
    prompt: `Explain the file I specify in detail.
Include:
- Its purpose and responsibility in the architecture
- Key exports and their signatures
- Any important side effects or dependencies
- How it connects to other parts of the system
- Any gotchas or non-obvious behavior
Reference the project architecture in .ai-os/context/architecture.md as context.`,
  });

  prompts.push({
    id: '/refactor-component',
    title: 'Refactor Component',
    description: 'Refactor a component following project conventions',
    prompt: `Refactor the component I specify following the project conventions.
Before touching anything:
1. Read the component file completely
2. List all imports and consumers (grep for the component name)
3. Identify props, tRPC hooks, and state
Then:
- Apply the naming conventions from .ai-os/context/conventions.md
- Extract business logic to lib/ if present in the component
- Ensure TypeScript strict compliance (no any)
- Verify all callers still compile after the refactor`,
  });

  return prompts;
}

interface GeneratePromptsOptions {
  refreshExisting?: boolean;
}

export async function generatePrompts(stack: DetectedStack, cwd: string, options?: GeneratePromptsOptions): Promise<number> {
  const promptsPath = path.join(cwd, PROMPTS_FILE);
  fs.mkdirSync(path.dirname(promptsPath), { recursive: true });

  let existing: PromptsFile = { version: 1, prompts: [] };
  if (fs.existsSync(promptsPath)) {
    try {
      existing = JSON.parse(fs.readFileSync(promptsPath, 'utf-8'));
    } catch {
      // file is malformed, start fresh
    }
  }

  const generatedPrompts = buildPrompts(stack, cwd);
  let changed = 0;

  if (options?.refreshExisting) {
    const byId = new Map(existing.prompts.map(p => [p.id, p]));
    for (const prompt of generatedPrompts) {
      const prev = byId.get(prompt.id);
      if (!prev) {
        existing.prompts.push(prompt);
        changed++;
        continue;
      }

      if (prev.title !== prompt.title || prev.description !== prompt.description || prev.prompt !== prompt.prompt) {
        byId.set(prompt.id, prompt);
        changed++;
      }
    }

    existing.prompts = existing.prompts.map(p => byId.get(p.id) ?? p);
  } else {
    const existingIds = new Set(existing.prompts.map(p => p.id));
    const newPrompts = generatedPrompts.filter(p => !existingIds.has(p.id));
    if (newPrompts.length === 0) return 0;
    existing.prompts = [...existing.prompts, ...newPrompts];
    changed = newPrompts.length;
  }

  if (changed === 0) return 0;

  fs.writeFileSync(promptsPath, JSON.stringify(existing, null, 2), 'utf-8');
  return changed;
}
