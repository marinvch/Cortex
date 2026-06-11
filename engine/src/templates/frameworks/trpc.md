## tRPC Conventions

### Router Structure
- All procedures defined in a single router file (e.g., `src/trpc/index.ts` or `server/api/root.ts`)
- Split into `publicProcedure` (unauthenticated) and `privateProcedure` (requires auth)
- Use `createTRPCRouter` to namespace procedures by domain

### Procedure Rules
- Validate all inputs with Zod via `.input(z.object({...}))`
- Reuse Zod schemas from `src/validators/` when they exist
- Return stable, JSON-serializable shapes (no class instances, no Dates raw)
- Use `TRPCError` for expected errors: `UNAUTHORIZED`, `NOT_FOUND`, `BAD_REQUEST`
- For pagination: `{ limit, cursor? }` input → `{ items, nextCursor }` output

### Client Usage
- Access via `trpc.<procedure>.useQuery()` and `trpc.<procedure>.useMutation()` in client components
- Invalidate cache after mutations: `utils.<procedure>.invalidate()`
- Never call `fetch('/api/...')` for data that could be a tRPC procedure

### Server-side Calls
- Use `createCallerFactory` for server-side tRPC calls (e.g., in Server Components)
- Never import router procedures directly into components — always go through the tRPC layer
