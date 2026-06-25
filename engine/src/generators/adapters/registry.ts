/**
 * registry.ts — Assistant-adapter registry.
 *
 * Each AI assistant (Copilot, Claude, Gemini, local, Cursor, JetBrains, Neovim)
 * is ONE equal entry in ADAPTERS. The registry wraps the EXISTING rendering logic
 * in multi-model.ts and multi-editor.ts — it does NOT re-implement any generation.
 *
 * Usage:
 *   const adapters = adaptersFor(resolvedIds);   // data-driven, no special-casing
 *   for (const a of adapters) {
 *     const files = a.emit(ctx);
 *     for (const f of files) writeIfChanged(f.path, f.content);
 *   }
 */

import path from 'node:path';
import type { DetectedStack } from '../../types.js';
import type { AdapterId } from '../detect-assistants.js';
import { adaptInstructionsForModel, getModelOutputPath } from '../multi-model.js';
import { generateCursorRules, generateJetBrainsContext, generateNeovimContext } from '../multi-editor.js';

// ── Public types ─────────────────────────────────────────────────────────────

/** Context passed to every adapter's emit() call. */
export interface RenderContext {
  /** Absolute path to the project root. */
  cwd: string;
  /** Absolute path to the .github directory (e.g. /project/.github). */
  githubDir: string;
  /** The canonical instruction content (Markdown, unmodified). */
  instructions: string;
  /** Detected project stack — used by editor adapters for context files. */
  stack: DetectedStack;
}

/** A single file to be written. */
export interface GeneratedFile {
  /** Absolute path to the output file. */
  path: string;
  /** File content string. */
  content: string;
}

/** Every AI-assistant adapter implements this interface. */
export interface AssistantAdapter {
  id: AdapterId;
  emit(ctx: RenderContext): GeneratedFile[];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Build a GeneratedFile for a model-style adapter (copilot / claude / gemini / local). */
function modelAdapter(id: 'copilot' | 'claude' | 'gemini' | 'local'): AssistantAdapter {
  return {
    id,
    emit(ctx: RenderContext): GeneratedFile[] {
      // NOTE: 'auto' must be resolved before adapters are called — these ids are always concrete.
      // If you see an 'auto' model arriving here, that is a bug in the call site, not the adapter.
      const content = adaptInstructionsForModel(ctx.instructions, id);
      const filePath = getModelOutputPath(id, ctx.githubDir);
      return [{ path: filePath, content }];
    },
  };
}

// ── ADAPTERS registry ─────────────────────────────────────────────────────────

/**
 * All registered adapters — order determines priority when more than one is
 * selected but the caller only wants one output (e.g. 'auto' resolution).
 * Copilot is one ordinary entry; there is no special-casing outside this list.
 */
export const ADAPTERS: AssistantAdapter[] = [
  // ── Model adapters (produce instruction markdown files) ───────────────────
  modelAdapter('copilot'),
  modelAdapter('claude'),
  modelAdapter('gemini'),
  modelAdapter('local'),

  // ── Editor adapters (produce editor-specific config files) ────────────────
  {
    id: 'cursor',
    emit(ctx: RenderContext): GeneratedFile[] {
      const content = generateCursorRules(ctx.stack, ctx.instructions);
      return [{ path: path.join(ctx.cwd, '.cursorrules'), content }];
    },
  },
  {
    id: 'jetbrains',
    emit(ctx: RenderContext): GeneratedFile[] {
      const content = generateJetBrainsContext(ctx.stack);
      return [{ path: path.join(ctx.githubDir, 'cortex', 'jetbrains-ai-context.md'), content }];
    },
  },
  {
    id: 'neovim',
    emit(ctx: RenderContext): GeneratedFile[] {
      const content = generateNeovimContext(ctx.stack);
      return [{ path: path.join(ctx.githubDir, 'cortex', 'nvim-context.md'), content }];
    },
  },
];

// ── Selection ────────────────────────────────────────────────────────────────

/**
 * Return only the adapters matching the given ids, in ADAPTERS order.
 * Unknown ids (ids not present in the registry) are silently ignored.
 */
export function adaptersFor(ids: AdapterId[]): AssistantAdapter[] {
  const idSet = new Set(ids);
  return ADAPTERS.filter((a) => idSet.has(a.id));
}
