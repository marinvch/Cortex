import fs from 'node:fs';
import path from 'node:path';
import { pruneMemory } from '../mcp-server/utils.js';

export function runCompactMemoryAction(cwd: string): void {
  console.log(`  🧹 Compact memory: ${cwd}`);
  console.log('');

  const memoryFile = path.join(cwd, '.github', 'ai-os', 'memory', 'memory.jsonl');
  if (!fs.existsSync(memoryFile)) {
    console.log('  ℹ️  No memory.jsonl file found — nothing to compact.');
    console.log('');
    return;
  }

  try {
    process.env['AI_OS_ROOT'] = cwd;
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
