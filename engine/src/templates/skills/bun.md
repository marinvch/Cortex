# Bun Runtime Patterns — {{PROJECT_NAME}}

## HTTP Server

```typescript
// src/index.ts — lightweight HTTP with Bun.serve
Bun.serve({
  port: Number(Bun.env.PORT ?? 3000),
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === '/health') return new Response('ok');
    return new Response('Not Found', { status: 404 });
  },
});
```

## File I/O (zero-copy)

```typescript
// Read
const text = await Bun.file('data/config.json').text();
const json = await Bun.file('data/config.json').json<Config>();

// Write
await Bun.write('output/result.txt', 'hello world');
await Bun.write('output/data.json', JSON.stringify(payload));
```

## Testing (built-in runner)

```typescript
// items.test.ts — jest-compatible, no imports needed for describe/it/expect
import { describe, it, expect, mock } from 'bun:test';
import { getItem } from '../src/services/items';

describe('getItem', () => {
  it('returns item by id', async () => {
    const item = await getItem('123');
    expect(item).toMatchObject({ id: '123' });
  });
});

// Run: bun test
// Watch: bun test --watch
```

## Environment Variables

```typescript
// Use Bun.env for type-safe access (no process.env needed)
const DB_URL = Bun.env.DATABASE_URL;
if (!DB_URL) throw new Error('DATABASE_URL is required');
```

## Build & Bundle

```typescript
// Build for production (outputs to ./dist)
// bun build ./src/index.ts --outdir ./dist --target=bun --minify

// Workspace scripts in package.json use bun run
// "dev": "bun run --watch src/index.ts"
// "test": "bun test"
// "build": "bun build ./src/index.ts --outdir ./dist"
```
