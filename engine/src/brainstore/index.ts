/**
 * BrainStore foundation (issue #282, part of #272 v2 graph-brain).
 *
 * - The Markdown vault (`vault.ts`) is the source of truth.
 * - `BrainStore` (`types.ts`) is the swappable storage seam.
 * - `SqliteBrainStore` (`sqlite-store.ts`) is the default local index (node:sqlite).
 * - `importJsonlToVault` (`import-jsonl.ts`) migrates legacy `memory.jsonl`.
 *
 * Every read is scoped by `tenant_id` + `domain`; no fact crosses a boundary.
 */

export type {
  Domain,
  NodeStatus,
  BrainScope,
  BrainNode,
  BrainNodeInput,
  BrainEdge,
  SearchQuery,
  SearchResult,
  BrainContext,
  BrainContextNeighbor,
  RebuildStats,
  BrainStore,
} from './types.js';
export { assertScope } from './types.js';

export {
  slugify,
  extractWikilinks,
  parseNote,
  noteToNode,
  nodeToMarkdown,
  computeFingerprint,
  listVaultNotes,
  type ParsedNote,
} from './vault.js';

export { SqliteBrainStore, cosineSimilarity, type SqliteBrainStoreOptions } from './sqlite-store.js';

export { importJsonlToVault, type ImportOptions, type ImportStats } from './import-jsonl.js';
