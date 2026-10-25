// The skills that have evals, and where each one's SKILL.md lives. A skill earns a row here when its
// text — not deterministic code — decides the outcome, and that outcome can be checked exactly.
import * as ship from "./scenarios/ship.mjs";
import * as resume from "./scenarios/resume.mjs";
import * as review from "./scenarios/review.mjs";
import * as teamAsk from "./scenarios/team-ask.mjs";
import * as cortex from "./scenarios/cortex.mjs";

export const SKILLS = { "merge-work": ship, "resume-work": resume, "review-change": review, "team-ask": teamAsk, "setup-repo": cortex };

// A body that is not skills/<name>/SKILL.md, repo-relative. The team playbook is a template stamped
// into a user's CLAUDE.md, and its text decides whether the session asks before working (#498), so it
// is measured — and its baseline checked — like a skill.
export const SKILL_FILES = { "team-ask": "templates/team/playbook.md" };

// The name each skill's tasks were first seeded under. The seed is derived from the name, so renaming
// a skill would otherwise draw a new task set, and the next record would compare its score against a
// baseline earned on different tasks. 3.0.0 renamed all four; their tasks stayed the same draws.
export const SEED_NAMES = { "merge-work": "ship", "resume-work": "resume", "review-change": "cortex-review", "setup-repo": "cortex" };
