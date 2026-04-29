import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { parseArgs } from '../cli/args.js';

function withArgv(args: string[], fn: () => void): void {
  const original = process.argv;
  process.argv = ['node', 'generate.js', ...args];
  try {
    fn();
  } finally {
    process.argv = original;
  }
}

describe('parseArgs', () => {
  it('defaults to action=apply and mode=safe with no flags', () => {
    withArgv([], () => {
      const result = parseArgs();
      expect(result.action).toBe('apply');
      expect(result.mode).toBe('safe');
      expect(result.dryRun).toBe(false);
      expect(result.verbose).toBe(false);
    });
  });

  it('sets action=apply when --apply is passed', () => {
    withArgv(['--apply'], () => {
      expect(parseArgs().action).toBe('apply');
    });
  });

  it('sets dryRun=true when --dry-run is passed', () => {
    withArgv(['--dry-run'], () => {
      expect(parseArgs().dryRun).toBe(true);
    });
  });

  it('sets action=doctor when --doctor is passed', () => {
    withArgv(['--doctor'], () => {
      expect(parseArgs().action).toBe('doctor');
    });
  });

  it('sets mode=refresh-existing when --refresh-existing is passed', () => {
    withArgv(['--refresh-existing'], () => {
      expect(parseArgs().mode).toBe('refresh-existing');
    });
  });

  it('sets verbose=true when --verbose is passed', () => {
    withArgv(['--verbose'], () => {
      expect(parseArgs().verbose).toBe(true);
    });
  });

  it('sets verbose=true when -v is passed', () => {
    withArgv(['-v'], () => {
      expect(parseArgs().verbose).toBe(true);
    });
  });

  it('sets action=check-hygiene when --check-hygiene is passed', () => {
    withArgv(['--check-hygiene'], () => {
      expect(parseArgs().action).toBe('check-hygiene');
    });
  });

  it('sets action=bootstrap when --bootstrap is passed', () => {
    withArgv(['--bootstrap'], () => {
      expect(parseArgs().action).toBe('bootstrap');
    });
  });

  it('sets action=check-freshness when --check-freshness is passed', () => {
    withArgv(['--check-freshness'], () => {
      expect(parseArgs().action).toBe('check-freshness');
    });
  });

  it('sets action=compact-memory when --compact-memory is passed', () => {
    withArgv(['--compact-memory'], () => {
      expect(parseArgs().action).toBe('compact-memory');
    });
  });

  it('sets mode=update when --update is passed', () => {
    withArgv(['--update'], () => {
      expect(parseArgs().mode).toBe('update');
    });
  });

  it('sets action=plan when --plan is passed', () => {
    withArgv(['--plan'], () => {
      expect(parseArgs().action).toBe('plan');
    });
  });

  it('sets action=preview when --preview is passed', () => {
    withArgv(['--preview'], () => {
      expect(parseArgs().action).toBe('preview');
    });
  });

  it('sets cleanUpdate=true and mode=refresh-existing when --clean-update is passed', () => {
    withArgv(['--clean-update'], () => {
      const result = parseArgs();
      expect(result.cleanUpdate).toBe(true);
      expect(result.mode).toBe('refresh-existing');
    });
  });

  it('sets prune=true when --prune is passed', () => {
    withArgv(['--prune'], () => {
      expect(parseArgs().prune).toBe(true);
    });
  });

  it('sets regenerateContext=true when --regenerate-context is passed', () => {
    withArgv(['--regenerate-context'], () => {
      expect(parseArgs().regenerateContext).toBe(true);
    });
  });

  it('sets pruneCustomArtifacts=true when --prune-custom-artifacts is passed', () => {
    withArgv(['--prune-custom-artifacts'], () => {
      expect(parseArgs().pruneCustomArtifacts).toBe(true);
    });
  });

  it('parses --cwd as a separate argument', () => {
    withArgv(['--cwd', '/some/path'], () => {
      const result = parseArgs();
      expect(result.cwd).toContain('some');
      expect(result.cwd).toContain('path');
    });
  });

  it('parses --cwd= inline syntax', () => {
    withArgv(['--cwd=/some/path'], () => {
      const result = parseArgs();
      expect(result.cwd).toContain('some');
      expect(result.cwd).toContain('path');
    });
  });

  it('throws when --cwd is passed without a value', () => {
    withArgv(['--cwd'], () => {
      expect(() => parseArgs()).toThrow('--cwd requires a path value');
    });
  });

  it('parses --profile standard', () => {
    withArgv(['--profile', 'standard'], () => {
      expect(parseArgs().profile).toBe('standard');
    });
  });

  it('parses --profile=full inline syntax', () => {
    withArgv(['--profile=full'], () => {
      expect(parseArgs().profile).toBe('full');
    });
  });

  it('throws on invalid --profile value', () => {
    withArgv(['--profile', 'invalid'], () => {
      expect(() => parseArgs()).toThrow('--profile must be one of');
    });
  });
});
