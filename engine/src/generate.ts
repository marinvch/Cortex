#!/usr/bin/env node
import { main } from './cli/dispatch.js';
import { AiOsError, formatError } from './errors.js';

main().catch(err => {
  if (err instanceof AiOsError) {
    console.error(formatError(err));
    // Exit 2 for known recoverable errors (user can fix with suggested command)
    // Exit 1 for UNKNOWN errors (unexpected — no fix hint available)
    process.exit(err.code === 'UNKNOWN' ? 1 : 2);
  }
  console.error('  ❌ Error:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
