import fs from 'node:fs';
import path from 'node:path';
import { pruneMemory } from '../mcp-server/utils.js';
import { ENV, CONFIG_DIR } from '../brand.js';

export function runCompactMemoryAction(cwd: string): void {
  console.log(`  🧹 Compact memory: ${cwd}`);
  console.log('');

  const memoryFile = path.join(cwd, CONFIG_DIR, 'memory', 'memory.jsonl');
  if (!fs.existsSync(memoryFile)) {
    console.log('  ℹ️  No memory.jsonl file found — nothing to compact.');
    console.log('');
    return;
  }

  try {
    process.env[ENV.ROOT] = cwd;
    const result = pruneMemory();
    const lines = result.split('\n');
    for (const line of lines) {
      console.log(`  ${line}`);
    }
  } catch (err) {
    console.error(`  ❌ Memory compact failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
  console.log('');
}
