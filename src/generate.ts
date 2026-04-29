#!/usr/bin/env node
import { main } from './cli/dispatch.js';

main().catch(err => {
  console.error('  ❌ Error:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
