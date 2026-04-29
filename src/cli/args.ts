import path from 'node:path';
import { parseProfile } from '../profile.js';
import type { InstallProfile } from '../types.js';

export type GenerateMode = 'safe' | 'refresh-existing' | 'update';
export type GenerateAction = 'apply' | 'plan' | 'preview' | 'check-hygiene' | 'doctor' | 'bootstrap' | 'check-freshness' | 'compact-memory';

export interface ParsedArgs {
  cwd: string;
  dryRun: boolean;
  mode: GenerateMode;
  action: GenerateAction;
  prune: boolean;
  verbose: boolean;
  cleanUpdate: boolean;
  regenerateContext: boolean;
  pruneCustomArtifacts: boolean;
  profile: InstallProfile | null;
}

export function parseArgs(): ParsedArgs {
  const args = process.argv.slice(2);
  let cwd = process.cwd();
  let dryRun = false;
  let mode: GenerateMode = 'safe';
  let action: GenerateAction = 'apply';
  let prune = false;
  let verbose = false;
  let cleanUpdate = false;
  let regenerateContext = false;
  let pruneCustomArtifacts = false;
  let profile: InstallProfile | null = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--cwd' && args[i + 1]) {
      cwd = path.resolve(args[i + 1]);
      i++;
    } else if (args[i] === '--cwd' && !args[i + 1]) {
      throw new Error('--cwd requires a path value');
    } else if (args[i]?.startsWith('--cwd=')) {
      cwd = path.resolve(args[i].slice('--cwd='.length));
    } else if (args[i] === '--dry-run') {
      dryRun = true;
    } else if (args[i] === '--refresh-existing') {
      mode = 'refresh-existing';
    } else if (args[i] === '--update') {
      mode = 'update';
    } else if (args[i] === '--plan') {
      action = 'plan';
    } else if (args[i] === '--preview') {
      action = 'preview';
    } else if (args[i] === '--apply') {
      action = 'apply';
    } else if (args[i] === '--prune') {
      prune = true;
    } else if (args[i]?.startsWith('--clean-update')) {
      // Accept --clean-update and forgiving variants like --clean-update~ from shell typos.
      cleanUpdate = true;
      mode = 'refresh-existing';
    } else if (args[i] === '--check-hygiene') {
      action = 'check-hygiene';
    } else if (args[i] === '--doctor') {
      action = 'doctor';
    } else if (args[i] === '--bootstrap') {
      action = 'bootstrap';
    } else if (args[i] === '--check-freshness') {
      action = 'check-freshness';
    } else if (args[i] === '--compact-memory') {
      action = 'compact-memory';
    } else if (args[i] === '--verbose' || args[i] === '-v') {
      verbose = true;
    } else if (args[i] === '--regenerate-context') {
      regenerateContext = true;
    } else if (args[i] === '--prune-custom-artifacts') {
      pruneCustomArtifacts = true;
    } else if (args[i] === '--profile' && args[i + 1]) {
      const parsed = parseProfile(args[i + 1]);
      if (!parsed) throw new Error(`--profile must be one of: minimal, standard, full (got "${args[i + 1]}")`);
      profile = parsed;
      i++;
    } else if (args[i]?.startsWith('--profile=')) {
      const raw = args[i].slice('--profile='.length);
      const parsed = parseProfile(raw);
      if (!parsed) throw new Error(`--profile must be one of: minimal, standard, full (got "${raw}")`);
      profile = parsed;
    }
  }

  return { cwd, dryRun, mode, action, prune, verbose, cleanUpdate, regenerateContext, pruneCustomArtifacts, profile };
}
