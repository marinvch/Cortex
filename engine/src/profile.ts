/**
 * Install profiles — minimal / standard / full
 *
 * A profile is a named preset that sets multiple AiOsConfig feature flags at
 * once, so users do not need to manually toggle individual options.
 *
 * Profiles are applied at install / refresh time via the --profile CLI flag.
 * The chosen profile is persisted in config.json and re-applied on subsequent
 * refreshes unless a new --profile flag overrides it.
 */
import type { AiOsConfig, InstallProfile } from './types.js';

/** Subset of AiOsConfig flags that a profile may control. */
export type ProfileFlags = Pick<
  AiOsConfig,
  | 'agentsMd'
  | 'pathSpecificInstructions'
  | 'recommendations'
  | 'sessionContextCard'
  | 'updateCheckEnabled'
  | 'skillsStrategy'
  | 'agentFlowMode'
>;

/** Per-profile feature flag presets. */
export const PROFILE_PRESETS: Record<InstallProfile, ProfileFlags> = {
  /** Essentials only — instructions + MCP wiring.  No agents, no recommendations. */
  minimal: {
    agentsMd: false,
    pathSpecificInstructions: false,
    recommendations: false,
    sessionContextCard: false,
    updateCheckEnabled: false,
    skillsStrategy: 'creator-only',
    agentFlowMode: 'skip',
  },

  /** Balanced default — most features on, predefined skills off. */
  standard: {
    agentsMd: false,
    pathSpecificInstructions: true,
    recommendations: true,
    sessionContextCard: true,
    updateCheckEnabled: true,
    skillsStrategy: 'creator-only',
    agentFlowMode: 'create',
  },

  /** All stack-relevant integrations enabled. */
  full: {
    agentsMd: true,
    pathSpecificInstructions: true,
    recommendations: true,
    sessionContextCard: true,
    updateCheckEnabled: true,
    skillsStrategy: 'predefined+creator',
    agentFlowMode: 'create',
  },
};

/**
 * Apply profile flags to a config object and return a new config with the
 * profile applied.  The original object is not mutated.
 * Profile-controlled fields are overwritten; all other fields are preserved.
 */
export function applyProfile(config: AiOsConfig, profile: InstallProfile): AiOsConfig {
  const flags = PROFILE_PRESETS[profile];
  return { ...config, ...flags, profile };
}

/**
 * Return a human-readable summary of what the profile enables/disables.
 */
export function describeProfile(profile: InstallProfile): string {
  const flags = PROFILE_PRESETS[profile];
  const lines: string[] = [`  Profile: ${profile}`];
  lines.push(`    agents.md:              ${flags.agentsMd ? 'enabled' : 'disabled'}`);
  lines.push(`    path instructions:      ${flags.pathSpecificInstructions ? 'enabled' : 'disabled'}`);
  lines.push(`    recommendations:        ${flags.recommendations ? 'enabled' : 'disabled'}`);
  lines.push(`    session context card:   ${flags.sessionContextCard ? 'enabled' : 'disabled'}`);
  lines.push(`    update-check workflow:  ${flags.updateCheckEnabled ? 'enabled' : 'disabled'}`);
  lines.push(`    skills strategy:        ${flags.skillsStrategy}`);
  lines.push(`    agent flow:             ${flags.agentFlowMode}`);
  return lines.join('\n');
}

/** Parse a raw string into a valid InstallProfile, or return null. */
export function parseProfile(raw: string): InstallProfile | null {
  if (raw === 'minimal' || raw === 'standard' || raw === 'full') return raw;
  return null;
}
