# Supabase Patterns — {{PROJECT_NAME}}

## Client File

`src/lib/supabase.ts` — admin client with service role key

## Storage Patterns

```typescript
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Upload file
const { data, error } = await supabase.storage
  .from('pdfs')
  .upload(`${userId}/${fileId}.pdf`, buffer, { contentType: 'application/pdf' });

// Get signed URL (time-limited)
const { data: urlData } = await supabase.storage
  .from('pdfs')
  .createSignedUrl(`${userId}/${fileId}.pdf`, 3600); // 1 hour

// Delete file
await supabase.storage.from('pdfs').remove([`${userId}/${fileId}.pdf`]);
```

## pgvector Setup (SQL)

```sql
-- Enable extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Add vector column
ALTER TABLE document_chunks ADD COLUMN embedding vector(384);

-- Create index (run before production)
CREATE INDEX ON document_chunks USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 100);
```

## Connection Strings

```
DATABASE_URL    — Supabase pooler URL (for Prisma at runtime, connection pooling)
DIRECT_URL      — Supabase direct URL (for Prisma migrate, schema operations)
```

Both required. `DATABASE_URL` for app, `DIRECT_URL` for migrations.

## Row Level Security (RLS)

Disabled for server-side access via service role key. If you add client-side Supabase access:
1. Enable RLS on the table
2. Add policy: `USING (user_id = auth.uid())`
3. Switch to anon key for client

## Debugging

- Check `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are set correctly
- Service role key bypasses RLS — never expose it client-side
- Storage bucket name: `SUPABASE_STORAGE_BUCKET` (default: `pdfs`)
