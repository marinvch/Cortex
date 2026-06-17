# tRPC Patterns — {{PROJECT_NAME}}

## Router Location

All procedures: `src/trpc/index.ts` (single router)

## Procedure Types

```typescript
// Public (no auth required)
publicProcedure
  .input(z.object({ ... }))
  .query(async ({ input }) => { ... })

// Private (requires session — throws UNAUTHORIZED if missing)
privateProcedure
  .input(z.object({ ... }))
  .mutation(async ({ input, ctx }) => {
    // ctx.userId is always present here
    const items = await prisma.item.findMany({ where: { userId: ctx.userId } });
    return items;
  })
```

## Standard Error Pattern

```typescript
import { TRPCError } from '@trpc/server';

throw new TRPCError({ code: 'NOT_FOUND', message: 'File not found' });
// Codes: UNAUTHORIZED | FORBIDDEN | NOT_FOUND | BAD_REQUEST | INTERNAL_SERVER_ERROR
```

## Pagination Pattern

```typescript
.input(z.object({ limit: z.number().min(1).max(100).default(20), cursor: z.string().optional() }))
.query(async ({ input }) => {
  const items = await prisma.item.findMany({
    take: input.limit + 1,
    cursor: input.cursor ? { id: input.cursor } : undefined,
    orderBy: { createdAt: 'desc' },
  });
  const nextCursor = items.length > input.limit ? items.pop()!.id : undefined;
  return { items, nextCursor };
})
```

## Client Usage

```typescript
// Query
const { data, isLoading } = trpc.getFiles.useQuery();

// Mutation + invalidate
const utils = trpc.useUtils();
const { mutate } = trpc.deleteFile.useMutation({
  onSuccess: () => utils.getFiles.invalidate(),
});

// Optimistic update
const { mutate } = trpc.updateItem.useMutation({
  onMutate: async (newData) => {
    await utils.getItem.cancel();
    const previous = utils.getItem.getData();
    utils.getItem.setData(undefined, newData);
    return { previous };
  },
  onError: (_, __, ctx) => utils.getItem.setData(undefined, ctx?.previous),
});
```

## Adding a New Procedure

1. Add to `src/trpc/index.ts`
2. Create/reuse Zod schema in `src/validators/`
3. Import + use in component: `trpc.<name>.useQuery()`
4. Never create an API route for data that can be a tRPC procedure
