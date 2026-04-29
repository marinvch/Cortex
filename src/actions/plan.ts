import { formatOnboardingPlan } from '../planner.js';
import type { OnboardingPlan } from '../planner.js';

export function runPlanAction(onboardingPlan: OnboardingPlan): void {
  console.log(formatOnboardingPlan(onboardingPlan));
}
