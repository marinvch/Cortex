/**
 * Skills CLI compatibility utilities.
 *
 * Detects which syntax mode the installed skills CLI supports and emits
 * validated install commands accordingly.
 *
 * Supported modes:
 *   'source-based' — `npx -y skills add <source>@<skill> -g -a github-copilot`
 *   'legacy'       — `npx -y skills add --skill <skill> -g -a github-copilot`
 *
 * Source-based is the correct, current form. Legacy mode is a fallback for
 * older CLI versions that predate the `<source>@<skill>` positional syntax.
 */
import { execSync } from 'node:child_process';

/** Skills CLI syntax capability mode. */
export type SkillsCliMode = 'source-based' | 'legacy';

/**
 * Detect which install-command syntax the skills CLI supports.
 *
 * Detection strategy:
 *   1. Run `npx -y skills --version` to get the version string.
 *   2. If the version string contains a semver number, the CLI is available
 *      and new enough to support source-based `<source>@<skill>` syntax.
 *   3. If the CLI is unavailable or errors, default to 'source-based' —
 *      that is always the preferred form and avoids emitting `--skill` flag
 *      commands that may be broken on newer CLI versions.
 *
 * @param opts.timeout - ms to wait for the CLI probe (default: 8000)
 */
export function detectSkillsCliMode(opts?: { timeout?: number }): SkillsCliMode {
  const timeout = opts?.timeout ?? 8_000;
  try {
    const output = execSync('npx -y skills --version 2>&1', { timeout, encoding: 'utf-8' });
    // Any CLI version that prints a semver string supports source-based syntax.
    // Older pre-release builds (before 1.0) used `--skill` flag only and did
    // not print a standard semver — they typically print nothing or error out.
    if (/\b\d+\.\d+(\.\d+)?\b/.test(output)) {
      return 'source-based';
    }
    return 'legacy';
  } catch {
    // CLI unavailable, timed out, or errored — use source-based as safe default.
    return 'source-based';
  }
}

/**
 * Build a validated skills install command string for the given skill.
 *
 * - In 'source-based' mode (default): emits `npx -y skills add <source>@<skill> -g -a github-copilot`
 * - In 'legacy' mode: emits `npx -y skills add --skill <skill> -g -a github-copilot`
 *
 * When source-based mode is active but no source is available, the command uses
 * `<source>@<skill>` as a placeholder so the user can clearly identify what to fill in.
 *
 * @param skill - skill name and optional source repository (e.g. `vercel-labs/agent-skills`)
 * @param mode  - CLI capability mode (default: 'source-based')
 */
export function buildSkillsInstallCommand(
  skill: { name: string; source?: string },
  mode: SkillsCliMode = 'source-based',
): string {
  if (mode === 'source-based') {
    const spec = skill.source ? `${skill.source}@${skill.name}` : `<source>@${skill.name}`;
    return `npx -y skills add ${spec} -g -a github-copilot`;
  }
  // legacy — use --skill flag (no source positional arg)
  return `npx -y skills add --skill ${skill.name} -g -a github-copilot`;
}

/**
 * Returns true if the command string uses the legacy `--skill` flag form.
 * Used in tests to assert that known-invalid syntax was not emitted.
 */
export function isLegacySkillCommand(cmd: string): boolean {
  return cmd.includes('--skill ');
}
