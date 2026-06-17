/**
 * freshness-bridge.ts — wraps detectors/freshness for AI OS MCP server.
 */
import { computeFreshnessReport, formatFreshnessReport } from '../detectors/freshness.js';
import { ROOT } from './shared.js';

// ── Tool #25: Context Freshness ────────────────────────────────────────────────

export function getContextFreshness(): string {
  const report = computeFreshnessReport(ROOT);
  return formatFreshnessReport(report);
}
