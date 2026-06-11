export type AiOsErrorCode =
  | 'MISSING_CONFIG'
  | 'INVALID_CONFIG'
  | 'WRITE_FAILED'
  | 'SCAN_FAILED'
  | 'TEMPLATE_NOT_FOUND'
  | 'MCP_RUNTIME_MISSING'
  | 'BUNDLE_CORRUPTED'
  | 'UNKNOWN';

export class AiOsError extends Error {
  constructor(
    public readonly code: AiOsErrorCode,
    message: string,
    public readonly fix?: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AiOsError';
    // Maintain correct prototype chain in transpiled environments
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export function formatError(err: AiOsError): string {
  let out = `\n  ❌ ${err.message}`;
  if (err.fix) out += `\n     Fix: ${err.fix}`;
  if (err.code !== 'UNKNOWN') out += `\n     Code: ${err.code}`;
  return out;
}
