## Hono / Edge/Node.js API Conventions

### Route Structure
- Routes defined with `app.get()`, `app.post()` etc. on a `Hono` instance
- Group related routes with `app.route('/prefix', subApp)` for modularity
- Middleware (auth, logging, CORS) registered with `app.use()`
- Business logic in service modules — not inline in route handlers

### Validation
- Use Zod validator middleware: `zValidator('json', schema)` from `@hono/zod-validator`
- Always validate request body, query params, and path params
- Return typed responses with `c.json({ ... }, statusCode)`

### Context & Bindings
- Access request data via `c.req` (typed after validation)
- Environment bindings (Cloudflare Workers) via `c.env`
- Pass data between middleware with `c.set()` / `c.get()`

### Error Handling
- Use `app.onError()` for global error handler
- Throw `HTTPException` from `hono/http-exception` for typed errors
- Return consistent JSON error shapes: `{ error: { message, code } }`

### Deployment
- Hono runs on Cloudflare Workers, Deno, Bun, Node.js, and Fastly
- Use the correct adapter import: `hono/cloudflare-workers`, `hono/bun`, etc.
- Keep handler logic runtime-agnostic — avoid Node.js-specific APIs

### TypeScript
- Use `Hono<{ Bindings: Env; Variables: Vars }>` generics for full type safety
- Infer variable types with `c.var` after `c.set()`
- `strict: true` in tsconfig — no implicit `any`
