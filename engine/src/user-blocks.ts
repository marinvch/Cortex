/**
 * User Block Preservation during AI OS refresh/regeneration.
 *
 * User-authored blocks are delimited by special markers:
 *
 *   <!-- AI-OS:USER_BLOCK:START id="block-id" -->
 *   ... user-authored content ...
 *   <!-- AI-OS:USER_BLOCK:END id="block-id" -->
 *
 * During refresh, these blocks are re-inserted into the freshly-generated file
 * using the following merge strategy (in priority order):
 *
 *   1. ID-match  — If the regenerated content contains the same START/END markers,
 *                  replace their inner content with the user's version.
 *   2. Anchor    — If the line immediately before the block's START marker in the
 *                  previous file is present in the new content, insert the block there.
 *   3. Conflict  — If neither works, append the block at the end inside a
 *                  <!-- AI-OS:CONFLICT --> wrapper and emit a ConflictReport so the
 *                  user knows manual reconciliation is needed.
 *
 * Per-file mode is configured via `.github/ai-os/protect.json`:
 *   {
 *     "protected": ["file-to-fully-protect.md"],  // whole-file shield (existing behaviour)
 *     "hybrid":    ["file-with-user-blocks.md"]   // block-level merge (new behaviour)
 *   }
 */

// ── Marker constants ─────────────────────────────────────────────────────────

export const USER_BLOCK_START_PREFIX = '<!-- AI-OS:USER_BLOCK:START';
export const USER_BLOCK_END_PREFIX   = '<!-- AI-OS:USER_BLOCK:END';

/** Pattern that matches a complete user block (start marker, content, end marker). */
const BLOCK_GLOBAL_RE =
  /<!-- AI-OS:USER_BLOCK:START id="([^"]+)" -->([\s\S]*?)<!-- AI-OS:USER_BLOCK:END id="\1" -->/g;

// ── Public types ─────────────────────────────────────────────────────────────

export interface UserBlock {
  /** The block identifier specified in the marker. */
  id: string;
  /** Complete block text including START and END markers. */
  fullMatch: string;
  /** Content between the START and END markers (may contain newlines). */
  innerContent: string;
  /**
   * The trimmed text of the line immediately before the START marker in the
   * source file. Used as an anchor for strategy-2 insertion.  Empty string
   * when the block is at the very beginning of the file.
   */
  anchorBefore: string;
}

export interface ConflictReport {
  blockId: string;
  /** Why the block could not be merged safely. */
  reason: 'anchor-lost' | 'block-id-missing';
  detail: string;
}

export interface MergeResult {
  /** The merged file content, ready to be written. */
  content: string;
  /** IDs of blocks that were successfully preserved. */
  preserved: string[];
  /** Reports for blocks that could not be automatically merged. */
  conflicts: ConflictReport[];
}

// ── Core logic ───────────────────────────────────────────────────────────────

/**
 * Parse all user blocks from `content` and return them keyed by block ID.
 * Duplicate IDs use the first occurrence.
 */
export function extractUserBlocks(content: string): Map<string, UserBlock> {
  const blocks = new Map<string, UserBlock>();

  BLOCK_GLOBAL_RE.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = BLOCK_GLOBAL_RE.exec(content)) !== null) {
    const id           = match[1];
    const innerContent = match[2];
    const fullMatch    = match[0];

    if (blocks.has(id)) continue; // first occurrence wins

    // Determine the anchor using a named helper to keep the loop body readable.
    const beforeContent = content.slice(0, match.index);
    const anchorBefore  = extractAnchorLine(beforeContent.split('\n'));

    blocks.set(id, { id, fullMatch, innerContent, anchorBefore });
  }

  return blocks;
}

/**
 * Return the last non-empty trailing line from a split content array.
 *
 * When a block opens on its own line (the common case) the split array ends
 * with an empty segment because the preceding text ends with `\n`.  We skip
 * that empty segment to reach the real anchor.
 */
function extractAnchorLine(beforeLines: string[]): string {
  const last      = beforeLines[beforeLines.length - 1] ?? '';
  const candidate = last.trimEnd() === ''
    ? (beforeLines[beforeLines.length - 2] ?? '')
    : last;
  return candidate.trimEnd();
}

/**
 * Merge user blocks extracted from `previous` into `generated`.
 *
 * Does NOT mutate either argument.  Returns a `MergeResult` whose `content`
 * field is ready to be written to disk.
 */
export function mergeUserBlocks(generated: string, previous: string): MergeResult {
  const userBlocks = extractUserBlocks(previous);

  if (userBlocks.size === 0) {
    return { content: generated, preserved: [], conflicts: [] };
  }

  const preserved: string[]      = [];
  const conflicts: ConflictReport[] = [];
  let result = generated;

  for (const [id, block] of userBlocks) {
    const startMarker = `<!-- AI-OS:USER_BLOCK:START id="${id}" -->`;
    const endMarker   = `<!-- AI-OS:USER_BLOCK:END id="${id}" -->`;

    // ── Strategy 1: ID-match ─────────────────────────────────────────────────
    if (result.includes(startMarker) && result.includes(endMarker)) {
      const blockRe = new RegExp(
        `<!-- AI-OS:USER_BLOCK:START id="${escapeRegex(id)}" -->[\\s\\S]*?<!-- AI-OS:USER_BLOCK:END id="${escapeRegex(id)}" -->`,
        'g',
      );
      result = result.replace(blockRe, block.fullMatch);
      preserved.push(id);
      continue;
    }

    // ── Strategy 2: Anchor-based insertion ───────────────────────────────────
    if (block.anchorBefore !== '') {
      const anchorIdx = result.indexOf(block.anchorBefore + '\n');

      if (anchorIdx !== -1) {
        const insertAt = anchorIdx + block.anchorBefore.length + 1; // after the newline
        result = result.slice(0, insertAt) + block.fullMatch + '\n' + result.slice(insertAt);
        preserved.push(id);
        continue;
      }
    }

    // ── Strategy 3: Conflict ─────────────────────────────────────────────────
    const conflictBlock = [
      ``,
      `<!-- AI-OS:CONFLICT block="${id}" — anchor lost; please reconcile manually -->`,
      block.fullMatch,
      `<!-- AI-OS:CONFLICT:END -->`,
      ``,
    ].join('\n');

    result += conflictBlock;

    conflicts.push({
      blockId: id,
      reason: block.anchorBefore ? 'anchor-lost' : 'block-id-missing',
      detail: block.anchorBefore
        ? `Anchor line "${block.anchorBefore}" not found in regenerated content`
        : `Block "${id}" has no anchor and no matching ID in regenerated content`,
    });
  }

  return { content: result, preserved, conflicts };
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
