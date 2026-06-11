## Bun Runtime Conventions

### Project Setup

- `bun init` to scaffold; `bun.lockb` is the lockfile — commit it
- `bun run <script>` replaces `npm run`; `bun install` replaces `npm install`
- `bun add` / `bun remove` for dependency management
- Use `bun --watch` for dev reloads instead of `nodemon`

### TypeScript

- Bun runs TypeScript natively — no `ts-node` or `tsx` needed
- `tsconfig.json` still required for editor support and strict checks
- Target `ESNext` and enable `strict: true`

### HTTP Server (Bun.serve)

- Use `Bun.serve({ fetch(req) { ... }, port: 3000 })` for lightweight HTTP
- For full-featured routing prefer `Hono` or `Elysia` with Bun adapter
- Access `Bun.file(path)` for zero-copy static file serving

### Testing

- Use `bun test` (built-in Jest-compatible runner)
- Test files: `*.test.ts` or `*.spec.ts`
- `expect`, `describe`, `it` are globals — no imports needed
- `mock()` from `bun:test` for spies and mocks

### Scripts & Build

- Bundle with `bun build ./src/index.ts --outdir ./dist --target=bun`
- Workspace support via `workspaces` in `package.json`
- Use `Bun.env` instead of `process.env` where possible

### Security

- Never commit `.env` files — use `Bun.env` with `.env.example` docs
- Validate all external inputs; Bun does not add request sanitization
