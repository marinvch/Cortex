/**
 * Review Severity Taxonomy
 *
 * Defines the four-level severity labels used consistently across all
 * review-oriented generated agents (Enhancement Advisor, Idea Validator) and
 * any skills or prompts that surface review findings.
 *
 * Levels (in descending urgency):
 *   Critical  — must fix before merge; blocks safe delivery
 *   Required  — must fix in this cycle; significant quality/security issue
 *   Optional  — recommended improvement; non-blocking but high-value
 *   FYI       — informational; low-priority or deferred to backlog
 */

export const SEVERITY_LEVELS = ['Critical', 'Required', 'Optional', 'FYI'] as const;

export type SeverityLevel = (typeof SEVERITY_LEVELS)[number];

export interface ReviewFinding {
  /** Sequential number from the advisor report */
  index: number;
  title: string;
  severity: SeverityLevel;
}

/**
 * Returns a Markdown badge string for the given severity level, e.g.
 * `[Critical]` styled for display inside finding headers.
 */
export function formatSeverityBadge(level: SeverityLevel): string {
  return `[${level}]`;
}

/**
 * Returns true when the given string is a recognised severity level.
 */
export function isValidSeverityLevel(value: string): value is SeverityLevel {
  return (SEVERITY_LEVELS as readonly string[]).includes(value);
}

/**
 * Returns the severity levels ordered by urgency (most urgent first).
 */
export function getSeverityLevelsOrdered(): readonly SeverityLevel[] {
  return SEVERITY_LEVELS;
}
