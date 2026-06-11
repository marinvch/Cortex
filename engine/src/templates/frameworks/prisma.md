## Prisma ORM Conventions

### Schema
- Single source of truth: `prisma/schema.prisma`
- Use `@@map` for snake_case table names (DB) while keeping PascalCase model names (code)
- All relations must have explicit `@relation` with `fields` and `references`
- Add `@updatedAt` and `createdAt DateTime @default(now())` to all models

### Client Usage
- Singleton Prisma client in `src/lib/prisma.ts` — import from there, never instantiate directly
- Scope all queries by `userId` (or equivalent ownership field) to prevent data leakage
- Use `select` to return only needed fields — avoid over-fetching

### Queries
- Always check for `null` on `.findUnique()` / `.findFirst()` — they return `null`, not throw
- Use `upsert` for create-or-update patterns
- Use transactions (`$transaction([...])`) for multi-step atomic operations
- `$queryRaw` / `$executeRaw` only in dedicated DB utility files — never scattered in components

### Migrations
- `npx prisma migrate dev --name <description>` for development migrations
- `npx prisma generate` after schema changes to regenerate the client
- Never edit migration files after they've been applied in production

### Error Handling
- Catch `PrismaClientKnownRequestError` for unique constraint violations (code: `P2002`)
- Catch `PrismaClientKnownRequestError` for not found (code: `P2025`)
