# Prisma Patterns — {{PROJECT_NAME}}

## Schema File

`{{SCHEMA_FILE}}` — single source of truth for all DB shapes

## Prisma Client

```typescript
// Always import from the singleton
import { prisma } from '@/lib/prisma';
// NEVER: new PrismaClient() directly in a component or route
```

## Query Patterns

```typescript
// Always scope by userId
const files = await prisma.file.findMany({
  where: { userId: ctx.userId },
  orderBy: { createdAt: 'desc' },
  select: { id: true, name: true, uploadStatus: true }, // only needed fields
});

// Upsert (create-or-update, avoids race conditions)
await prisma.user.upsert({
  where: { email: session.user.email },
  create: { email, name },
  update: { name },
});

// Transaction (atomic multi-step)
await prisma.$transaction([
  prisma.file.delete({ where: { id } }),
  prisma.message.deleteMany({ where: { fileId: id } }),
]);
```

## Migration Workflow

```bash
# 1. Edit prisma/schema.prisma
# 2. Create migration
npx prisma migrate dev --name <descriptive-name>
# 3. Regenerate client
npx prisma generate
```

## Error Handling

```typescript
import { Prisma } from '@prisma/client';

try {
  await prisma.user.create({ data: { email } });
} catch (e) {
  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    if (e.code === 'P2002') throw new Error('Email already exists');
    if (e.code === 'P2025') throw new Error('Record not found');
  }
  throw e;
}
```

## Raw SQL (when needed)

```typescript
// Only in src/lib/vector-store.ts or src/trpc/index.ts
// Always define a typed interface for results
interface ChunkRow { id: string; content: string; }
const rows = await prisma.$queryRaw<ChunkRow[]>`
  SELECT id, content FROM document_chunks
  WHERE "fileId" = ${fileId}
  ORDER BY embedding <-> ${embedding}::vector
  LIMIT 5
`;
```

## Performance Tips

- Use `select` to avoid over-fetching (don't return all fields)
- Use `include` sparingly — prefer `select` with nested relations
- For read-heavy queries, consider Prisma's `findRaw` for complex aggregations
- Add DB-level indexes for frequently filtered fields (add to schema with `@@index`)
