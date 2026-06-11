import { formatOnboardingPlan } from '../planner.js';
import type { OnboardingPlan } from '../planner.js';

export function runPreviewAction(onboardingPlan: OnboardingPlan): void {
  console.log(formatOnboardingPlan(onboardingPlan));
  console.log('  🔍 Preview only: no files were written. Run with --apply to execute.');
  console.log('');
}
