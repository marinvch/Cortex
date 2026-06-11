## Express / Node.js API Conventions

### Route Structure
- Route handlers in `routes/` or `src/routes/`, one file per resource
- Middleware in `middleware/`, apply globally in `app.ts` or per-router
- Controller logic in `controllers/`, service logic in `services/`
- No business logic directly in route handlers

### Validation & Error Handling
- Validate all inputs with Zod (or Joi/Yup) before processing
- Use a centralized error handler middleware (last `app.use()`)
- Return consistent JSON error shapes: `{ error: { code, message } }`
- Use typed HTTP status codes — never return 200 for errors

### Authentication
- JWT middleware validates token on protected routes
- Never trust client-provided user IDs — always read from validated token
- Store secrets in environment variables, never in code

### Database
- All DB calls in service layer, never directly in routes
- Parameterized queries only — no string interpolation in SQL
- Scope queries by userId/tenantId for multi-user systems

### TypeScript
- Define interfaces for all request bodies and response shapes
- Use `express.Request<Params, ResBody, ReqBody>` generics
- `strict: true` in tsconfig — no implicit `any`
