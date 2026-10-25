// The job a person does on a team, and the rituals each job is offered first.
//
// A job is one of five words, recorded once per member in the team-brain's `team.json`
// (`members[].job`, read by `mcp/lib/roster.js`). It is not a role: a role (`frontend`, `backend`)
// is what an ask is addressed to, and a member holds any number of them. A job is what the person
// does all day, and a member has exactly one.
//
// A job decides what is OFFERED, never what is ALLOWED. Every ritual still runs for every job; the
// job only changes which ones `/setup-repo`, `/resume-work` and `/join-team` put first, and which a
// role pack carries (`tools/cortex-pack.mjs`). It is not a fourth runtime switch beside mode,
// audience and profile, and nothing may refuse an action because of it.
// docs/specs/2026-10-25-role-packs-design.md, "How each person installs their part".
//
// A member with no job is a developer, so every roster written before the field existed means what
// it meant. Pure: no file, no environment, no clock.

export const JOBS = Object.freeze(["developer", "architect", "lead", "pm", "qa"]);

/** What a missing or unreadable job is read as. */
export const DEFAULT_JOB = "developer";

/** True for one of the five job words, exactly as written. */
export function isJob(value) {
  return typeof value === "string" && JOBS.includes(value);
}

/** The job of a roster member, or `developer` when it has none. */
export function jobOf(member) {
  return isJob(member?.job) ? member.job : DEFAULT_JOB;
}

/**
 * The rituals each job is offered first, in the order of the design's table ("What each role
 * gets"). A ritual named here must exist under `skills/`; `core/test/job.test.js` holds that.
 * The project manager's story-map ritual is R4 of the design and is added when it exists.
 */
export const JOB_SKILLS = Object.freeze({
  developer: Object.freeze([
    "setup-repo", "review-change", "change-impact", "debug-issue", "resume-work", "merge-work",
    "repo-map", "handover-notes", "end-of-day-summary",
  ]),
  architect: Object.freeze([
    "define-terms", "design-spec", "architecture-review", "write-area-brief", "write-context-docs",
    "challenge-plan", "repo-map",
  ]),
  lead: Object.freeze([
    "create-team", "join-team", "whats-changed", "review-change", "suggest-skills", "trim-agent-docs",
    "set-profile",
  ]),
  pm: Object.freeze(["whats-changed", "challenge-plan"]),
  qa: Object.freeze(["change-impact", "review-change", "debug-issue"]),
});
