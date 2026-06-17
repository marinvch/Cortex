# RAG + pgvector Patterns — {{PROJECT_NAME}}

## Pipeline Files

- Vector store + pipeline: `src/lib/vector-store.ts`
- Chat route (retrieval): `src/app/api/chat/route.ts`

## Embedding Model

**HuggingFace MiniLM-L6-v2 — 384 dimensions**
⚠️ DO NOT mix embedding models in the same `document_chunks` table — dimension mismatch causes query errors.

## Chunking Config

```typescript
// 1000 chars per chunk, 200 char overlap, per-page tracking
chunkSize: 1000
chunkOverlap: 200
metadata: { pageNumber, chunkIndex, charStart, charEnd, snippet }
```

## pgvector Query Pattern

```typescript
// Always scope by fileId to prevent cross-user leakage
const results = await prisma.$queryRaw<ChunkRow[]>`
  SELECT id, content, metadata,
         1 - (embedding <-> ${queryEmbedding}::vector) AS similarity
  FROM document_chunks
  WHERE "fileId" = ${fileId}
  ORDER BY embedding <-> ${queryEmbedding}::vector
  LIMIT 5
`;
```

## RetrievedChunk Interface

```typescript
interface RetrievedChunk {
  id: string;
  content: string;
  metadata: {
    pageNumber: number;
    chunkIndex: number;
    snippet: string;
  };
  similarity?: number;
}
```

## SSE Stream Format

```
POST /api/chat
→ data: {"type":"sources","sources":[{"id":"c1","pageNumber":3,"snippet":"..."}]}
→ data: {"type":"token","token":"word "}   (repeated)
→ data: {"type":"done"}
```

## Adding a New Embedding Model

1. Update `vector-store.ts` to use the new model
2. **Re-embed all existing files** — old embeddings are incompatible
3. Update dimension in pgvector column: `ALTER TABLE document_chunks ALTER COLUMN embedding TYPE vector(NEW_DIM)`
4. Update `config.json` in `.github/ai-os/`

## OCR Fallback

Tesseract.js fires automatically if PDFLoader extracts 0 text characters. Processes up to 20 pages. `bul.traineddata` (Bulgarian) and `eng.traineddata` are bundled.

## Performance Notes

- No IVFFLAT/HNSW index yet on `document_chunks.embedding` — sequential scan
- Add index before going to production: `CREATE INDEX ON document_chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100)`
- Batch embeddings: 50 chunks per HuggingFace API call
