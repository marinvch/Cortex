export interface GenerationSummary {
  writtenCount: number;
  skippedCount: number;
  prunedCount: number;
  preservedCount: number;
  /** writtenCount + skippedCount — the set of files managed this run */
  totalFiles: number;
  durationMs: number;
}

interface SummaryInput {
  written: string[];
  skipped: string[];
  pruned: string[];
  preserved: string[];
  durationMs: number;
}

export function buildGenerationSummary(input: SummaryInput): GenerationSummary {
  return {
    writtenCount: input.written.length,
    skippedCount: input.skipped.length,
    prunedCount: input.pruned.length,
    preservedCount: input.preserved.length,
    totalFiles: input.written.length + input.skipped.length,
    durationMs: input.durationMs,
  };
}

export function formatGenerationSummary(s: GenerationSummary): string {
  const durationSec = (s.durationMs / 1000).toFixed(1);
  const lines: string[] = [
    `  ✅ Written (new or changed):  ${s.writtenCount}`,
    `  ⏭️  Unchanged (skipped):        ${s.skippedCount}`,
  ];
  if (s.preservedCount > 0) {
    lines.push(`  🔒 Preserved (curated):        ${s.preservedCount}`);
  }
  if (s.prunedCount > 0) {
    lines.push(`  🗑️  Pruned (stale):              ${s.prunedCount}`);
  }
  lines.push(`  ⏱️  Duration:                    ${durationSec}s`);
  return lines.join('\n');
}
