# Deno Runtime Patterns — {{PROJECT_NAME}}

## HTTP Server

```typescript
// main.ts — Deno.serve (no package.json required)
Deno.serve({ port: Number(Deno.env.get('PORT') ?? 8000) }, async (req) => {
  const url = new URL(req.url);
  if (url.pathname === '/health') return new Response('ok');
  return new Response('Not Found', { status: 404 });
});
```

## Imports & Version Pinning

```typescript
// Prefer JSR (jsr:) over deno.land/x for new packages
import { assertEquals } from 'jsr:@std/assert@1';
import { serve } from 'jsr:@std/http@1';

// npm compatibility layer for ecosystem packages
import express from 'npm:express@4';

// Use import maps in deno.json for alias management
// { "imports": { "@/": "./src/" } }
import { db } from '@/lib/db.ts';
```

## File I/O

```typescript
// Always use Deno.* APIs — not Node.js fs
const text = await Deno.readTextFile('data/config.json');
const config = JSON.parse(text);
await Deno.writeTextFile('output/result.json', JSON.stringify(result));
```

## Testing

```typescript
// items_test.ts — Deno built-in test runner
import { assertEquals, assertRejects } from 'jsr:@std/assert';

Deno.test('getItem returns item by id', async () => {
  const item = await getItem('123');
  assertEquals(item.id, '123');
});

Deno.test('getItem rejects on missing id', async () => {
  await assertRejects(() => getItem(''), Error, 'id required');
});

// Run: deno test
// Run with permissions: deno test --allow-net --allow-read
```

## Permissions (Least Privilege)

```typescript
// deno.json tasks — always declare explicit permissions
// "tasks": {
//   "dev": "deno run --allow-net=0.0.0.0:8000 --allow-env=PORT,DATABASE_URL --allow-read=./data main.ts",
//   "test": "deno test --allow-net --allow-read=./fixtures"
// }

// In code, access env with Deno.env.get() — requires --allow-env
const dbUrl = Deno.env.get('DATABASE_URL');
if (!dbUrl) throw new Error('DATABASE_URL is required');
```
