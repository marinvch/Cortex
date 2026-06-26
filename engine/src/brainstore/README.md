# BrainStore foundation (`src/brain/`)

The v2 graph-brain keystone (issue #282, part of #272). Local-first, with seams left
open so a hosted version is a config change, not a rewrite.

## Model

```
Markdown vault  ──(rebuild)──►  BrainStore index
(source of truth)               (disposable cache)
```

- **Vault = source of truth.** Plain Markdown notes (Obsidian/Foam/Logseq-compatible,
  also a browsable wiki). Notes = nodes, `[[wikilinks]]` = edges, frontmatter =
  `id` / `tenant_id` / `domain` / `category` / `tags` / `status`. No app dependency,
  no paid services — sovereign, git-friendly, human-editable plain files.
- **Index = `BrainStore`.** Rebuildable from the vault for fast structured + (future)
  vector search. Default impl: `SqliteBrainStore` (`node:sqlite`, Node ≥22), embeddings
  stored as BLOBs with a JS cosine kNN. The vault is authoritative; `rebuild()` reparses it.

## The non-negotiable invariant

Every **read** (`search`, `getContext`) is scoped by `tenant_id` + `domain`. No fact
crosses a tenant or domain boundary. Enforced by `src/tests/brain-scoping-invariant.test.ts`
(structural: every `SELECT *` carries the shared `SCOPE_WHERE`; runtime: reads throw
without a valid scope and never leak across scopes).

## Surface

| File | Responsibility |
|---|---|
| `types.ts` | `BrainStore` interface, node/edge/scope types, `assertScope` |
| `vault.ts` | Markdown notes ↔ nodes, frontmatter (no YAML dep), `[[wikilink]]` extraction |
| `sqlite-store.ts` | `SqliteBrainStore` — `node:sqlite` index, cosine kNN seam |
| `import-jsonl.ts` | Migrate legacy `memory.jsonl` → vault notes → rebuilt index |
| `index.ts` | Barrel export |

## Usage

```ts
import { SqliteBrainStore, importJsonlToVault } from './brainstore/index.js';

// Migrate existing memory + build the index (index is derived from the vault):
await importJsonlToVault({
  jsonlPath: '.github/cortex/memory/memory.jsonl',
  vaultPath: 'brain/vault',
  dbPath: 'brain/.index/brain.db',
  tenantId: 'local',
});

// Query — scope is mandatory:
const store = new SqliteBrainStore({ dbPath: 'brain/.index/brain.db' });
const hits = await store.search({ text: 'build pipeline' }, { tenantId: 'local', domain: 'project' });
```

## Swappability (#272 SaaS-readiness seam)

`BrainStore` is async by design so a cloud impl (Turso/libSQL per-tenant, or
Postgres + pgvector) drops in without touching engine logic. `deleteTenant()` is the
GDPR hard-delete seam. Embedding/LLM providers and the MCP transport seam are
separate follow-up sub-projects; this PR leaves the storage seam only.

## Not in this PR (follow-ups)

- Flip the live personal brain (`promote_to_brain`, personal reads) onto the store.
- Rewire per-repo project memory; retire legacy JSONL.
- Embedding provider + LLM/extraction provider interfaces.
- MCP transport seam + multi-agent memory tools.
