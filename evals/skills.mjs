// The skills that have evals, and where each one's SKILL.md lives. A skill earns a row here when its
// text — not deterministic code — decides the outcome, and that outcome can be checked exactly.
import * as ship from "./scenarios/ship.mjs";
import * as resume from "./scenarios/resume.mjs";
import * as review from "./scenarios/review.mjs";
import * as teamAsk from "./scenarios/team-ask.mjs";

export const SKILLS = { "ship": ship, "resume": resume, "cortex-review": review, "team-ask": teamAsk };

// A body that is not skills/<name>/SKILL.md, repo-relative. The team playbook is a template stamped
// into a user's CLAUDE.md, and its text decides whether the session asks before working (#498), so it
// is measured — and its baseline checked — like a skill.
export const SKILL_FILES = { "team-ask": "templates/team/playbook.md" };
