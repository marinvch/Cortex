// The skills that have evals, and where each one's SKILL.md lives. A skill earns a row here when its
// text — not deterministic code — decides the outcome, and that outcome can be checked exactly.
import * as ship from "./scenarios/ship.mjs";
import * as resume from "./scenarios/resume.mjs";
import * as review from "./scenarios/review.mjs";

export const SKILLS = { "ship": ship, "resume": resume, "cortex-review": review };
