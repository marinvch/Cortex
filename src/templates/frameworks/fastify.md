## Fastify / Node.js API Conventions

### Route Structure
- Routes registered via plugins: `fastify.register(import('./routes/users.js'), { prefix: '/users' })`
- Each plugin file exports an `async function(fastify, opts)` with `fastify-plugin` wrapping when sharing decorations
- Business logic in `services/` — never directly in route handlers
- Shared state via `fastify.decorate()` or dependency injection

### Schema Validation
- Define JSON Schema for every route: `schema: { body, querystring, params, response }`
- Fastify compiles schemas with AJV — validation is fast and automatic
- Use TypeBox (`@sinclair/typebox`) for type-safe schema definitions
- Never access `request.body` without a schema — always declare one

### Error Handling
- Use `fastify.setErrorHandler()` for global error handling
- Throw `createError()` from `@fastify/error` for typed HTTP errors
- Return consistent JSON: `{ statusCode, error, message }`
- Use `fastify.log` (pino) — never `console.log` in production code

### Plugins
- Encapsulate related functionality with `fastify-plugin` when sharing decorations
- Keep plugins focused: one plugin per domain or concern
- Load order matters — register plugins before routes that need them

### TypeScript
- Use `FastifyRequest<{ Body: ..., Querystring: ... }>` generics
- `FastifyPluginAsync<Options>` type for plugin definitions
- Enable `strict: true` in tsconfig — no implicit `any`

### Testing
- `fastify.inject()` for route tests without a running HTTP server
- Tap or Vitest for test runner
- Reset app state between tests — call `fastify.close()` in teardown
