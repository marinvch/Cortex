import { describe, it, expect } from 'vitest';
import { AiOsError, formatError, type AiOsErrorCode } from '../errors.js';

describe('AiOsError', () => {
  it('has correct name', () => {
    const err = new AiOsError('MISSING_CONFIG', 'config missing');
    expect(err.name).toBe('AiOsError');
  });

  it('stores code, message, fix, and details', () => {
    const err = new AiOsError('WRITE_FAILED', 'cannot write', 'Check permissions', { detail: 1 });
    expect(err.code).toBe('WRITE_FAILED');
    expect(err.message).toBe('cannot write');
    expect(err.fix).toBe('Check permissions');
    expect(err.details).toEqual({ detail: 1 });
  });

  it('is an instance of Error', () => {
    expect(new AiOsError('UNKNOWN', 'oops')).toBeInstanceOf(Error);
  });

  it('formatError includes message, fix, and code', () => {
    const err = new AiOsError('MISSING_CONFIG', 'No config found', 'Run --refresh-existing');
    const out = formatError(err);
    expect(out).toContain('No config found');
    expect(out).toContain('Run --refresh-existing');
    expect(out).toContain('MISSING_CONFIG');
  });

  it('formatError omits code line for UNKNOWN', () => {
    const err = new AiOsError('UNKNOWN', 'unexpected', undefined);
    const out = formatError(err);
    expect(out).not.toContain('Code:');
  });

  it('formatError omits fix line when fix is undefined', () => {
    const err = new AiOsError('INVALID_CONFIG', 'bad config');
    const out = formatError(err);
    expect(out).not.toContain('Fix:');
  });

  it('all AiOsErrorCode values construct without error', () => {
    const codes: AiOsErrorCode[] = [
      'MISSING_CONFIG', 'INVALID_CONFIG', 'WRITE_FAILED', 'SCAN_FAILED',
      'TEMPLATE_NOT_FOUND', 'MCP_RUNTIME_MISSING', 'BUNDLE_CORRUPTED', 'UNKNOWN',
    ];
    for (const code of codes) {
      expect(() => new AiOsError(code, 'test')).not.toThrow();
    }
  });

  it('instanceof check works through a catch block', () => {
    let caught: unknown;
    try {
      throw new AiOsError('SCAN_FAILED', 'scan failed');
    } catch (e) {
      caught = e;
    }
    expect(caught instanceof AiOsError).toBe(true);
  });
});
