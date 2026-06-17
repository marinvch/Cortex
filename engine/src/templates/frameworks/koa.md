## Koa / Node.js API Conventions

### Route Structure
- Routes via `koa-router` — one router per domain, mounted in `app.ts`
- Controllers in `controllers/`, services in `services/`
- No business logic in route callbacks — always delegate to services
- Middleware in `middleware/` — apply globally in `app.ts` or per-router

### Context (ctx) Usage
- Access request data via `ctx.request.body`, `ctx.params`, `ctx.query`
- Set response via `ctx.body` and `ctx.status` — never `ctx.res.write()`
- Pass request-scoped data with `ctx.state` (not `ctx` directly)
- Always validate and sanitize `ctx.request.body` before use

### Validation & Error Handling
- Validate inputs with Zod, Joi, or koa-body with custom validator middleware
- Top-level error-handling middleware: `app.use(async (ctx, next) => { try { await next() } catch (err) { ... } })`
- Return consistent JSON: `{ error: { message, code } }` with appropriate status code
- Never expose stack traces to clients in production

### Async / Middleware
- All middleware must be `async (ctx, next)` — always `await next()` unless short-circuiting
- Compose middleware with `koa-compose` when order matters
- Use `koa-body` or `@koa/multer` for request body parsing

### TypeScript
- Extend `Koa.DefaultState` and `Koa.DefaultContext` for typed `ctx.state`
- Type route parameters explicitly in route callbacks
- `strict: true` in tsconfig — no implicit `any`

### Testing
- Supertest with the Koa `app.callback()` for route testing
- Separate server creation from `app.listen()` for testability
- Mock service layer — never hit real DB or external APIs in unit tests
