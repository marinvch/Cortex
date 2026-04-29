import { runBootstrap, formatBootstrapReport } from '../bootstrap.js';
import type { DetectedStack } from '../types.js';

export function runBootstrapAction(stack: DetectedStack, dryRun: boolean): void {
  const report = runBootstrap(stack, { dryRun });
  console.log(formatBootstrapReport(report));
}
