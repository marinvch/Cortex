// The roster: who in a team holds which role and owns which project (#620, design R1–R3).
//
// `team.json` at the top of a team-brain is the one machine-read config. #622 put `source` there;
// this adds `members: [{ handle, roles: [], projects: [], github?, job? }]`. `team.md` stays prose for
// people. A `## Members` list parsed out of prose was the alternative, and two people editing prose
// on one day is a merge conflict with no schema to resolve it by.
//
// `job` is what the person does — developer, architect, lead, pm, qa — and `core/job.js` owns the
// words. It changes what is offered, never what is allowed, so a bad job never costs a member their
// place in the roster: it is reported and read as `developer`, the same as no job at all.
//
// A handle is the author slug from `core/author.js` — the name memory files are written under — so
// whoever is named in `.cortex/memory/<day>/<handle>.md` is named the same way in an ask. No email
// address is read or written (the team-memory design, "What names an author").
//
// Every read and write goes through the Vault, opened on the team-brain clone: the clone is the
// root, and `team.json` is a path under it (docs/adr/0007).

import { authorSlug } from "../../core/author.js";
import { JOBS, isJob, jobOf } from "../../core/job.js";
import { openVault } from "./vault.js";
import { TEAM_JSON } from "./team.js";

export { TEAM_JSON, JOBS, jobOf };

/** A role or project name: the author-slug alphabet, so it is safe in a path and a header. */
const NAME = /^[a-z0-9][a-z0-9-]{0,39}$/;
/** A GitHub login: letters, digits and single dashes, at most 39 characters. Never fetched. */
const GITHUB = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;

export class RosterError extends Error {
  constructor(message) {
    super(message);
    this.name = "RosterError";
    this.code = "invalid_roster";
  }
}

/**
 * One member, normalised, or a list of what is wrong with it. Never throws and never repeats a
 * value in a message: a file someone hand-edited may hold anything.
 *
 * A job that is not one of the five words is the one error that keeps the member: `member` comes
 * back without a job (read as `developer`) and `errors` says why. A reader keeps such a member, so
 * a typo in a job never takes a person out of the asks; a writer refuses any error.
 *
 * @param {unknown} raw
 * @returns {{ member: object|null, errors: string[] }}
 */
export function checkMember(raw) {
  const errors = [];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { member: null, errors: ["a member is not an object"] };
  const handle = typeof raw.handle === "string" ? raw.handle : "";
  if (!handle || authorSlug(handle) !== handle) {
    errors.push("handle must be an author slug: a-z, 0-9 and -, at most 40 characters (the CORTEX_AUTHOR form)");
  }
  const list = (key) => {
    const v = raw[key] ?? [];
    if (!Array.isArray(v) || v.some((x) => typeof x !== "string" || !NAME.test(x))) {
      errors.push(`${key} must be a list of names written a-z, 0-9 and -`);
      return [];
    }
    return [...new Set(v)];
  };
  const roles = list("roles");
  const projects = list("projects");
  let github;
  if (raw.github !== undefined && raw.github !== null && raw.github !== "") {
    if (typeof raw.github !== "string" || !GITHUB.test(raw.github)) errors.push("github must be a GitHub login");
    else github = raw.github;
  }
  const jobErrors = [];
  let job;
  if (raw.job !== undefined && raw.job !== null && raw.job !== "") {
    if (!isJob(raw.job)) jobErrors.push(`job must be one of ${JOBS.join(", ")}`);
    else job = raw.job;
  }
  if (errors.length) return { member: null, errors: [...errors, ...jobErrors] };
  const member = { handle, roles, projects };
  if (github) member.github = github;
  if (job) member.job = job;
  return { member, errors: jobErrors };
}

/**
 * Parse `team.json`'s text. Invalid JSON, or JSON that is not an object, throws `RosterError`: the
 * whole team's config is unreadable, and guessing an empty roster would refuse every ask with a
 * list that says nobody holds any role. A bad MEMBER is skipped and reported in `errors` instead,
 * so one typo does not take the whole team's inbox down.
 *
 * @param {string} text
 * @returns {{ doc: object, members: object[], errors: string[] }}
 */
export function parseRoster(text) {
  let doc;
  try {
    doc = JSON.parse(text);
  } catch (e) {
    throw new RosterError(`${TEAM_JSON} in the team-brain is not valid JSON (${e.message}); fix it there and run again`);
  }
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) throw new RosterError(`${TEAM_JSON} in the team-brain must hold a JSON object`);
  const errors = [];
  const members = [];
  if (doc.members !== undefined && !Array.isArray(doc.members)) {
    errors.push("members must be a list");
  } else {
    const seen = new Set();
    (doc.members ?? []).forEach((raw, i) => {
      const { member, errors: e } = checkMember(raw);
      // Only a bad job comes back with a member: kept, and read as a developer.
      for (const msg of e) errors.push(`members[${i}]: ${msg}${member ? "; read as developer" : ""}`);
      if (!member) return;
      if (seen.has(member.handle)) { errors.push(`members[${i}]: the handle is listed twice; the first entry is used`); return; }
      seen.add(member.handle);
      members.push(member);
    });
  }
  return { doc, members, errors };
}

/** The roster of the team-brain cloned at `clone`. A brain with no `team.json` has no members. */
export function readRoster(clone) {
  const vault = openVault(clone);
  if (!vault.isFile(TEAM_JSON)) return { doc: {}, members: [], errors: [] };
  return parseRoster(vault.read(TEAM_JSON));
}

/** Every role some member holds, sorted. */
export function rolesOf(members) {
  return [...new Set(members.flatMap((m) => m.roles))].sort();
}

/**
 * Add a member, or replace the roles, projects and GitHub login of the one with that handle. Every
 * other key of `team.json` — `source` from #622 included — is kept as it was, and so is every other
 * member. Returns what happened and the path written; committing is the caller's.
 *
 * The job is the exception to "replace": a call that passes none keeps the job already recorded.
 * Roles change with the work and a job rarely does, so updating your roles must not quietly turn
 * an architect back into a developer.
 *
 * @param {string} clone
 * @param {{ handle: string, roles?: string[], projects?: string[], github?: string, job?: string }} input
 * @returns {{ action: "added"|"updated"|"unchanged", member: object, rel: string }}
 */
export function setMember(clone, input) {
  const { member: given, errors } = checkMember(input);
  if (!given || errors.length) throw new RosterError(`not written: ${errors.join("; ")}`);
  const vault = openVault(clone);
  const { doc } = vault.isFile(TEAM_JSON) ? parseRoster(vault.read(TEAM_JSON)) : { doc: {} };
  const list = Array.isArray(doc.members) ? doc.members : [];
  const at = list.findIndex((m) => m?.handle === given.handle);
  const kept = at !== -1 && given.job === undefined && isJob(list[at]?.job) ? list[at].job : undefined;
  const member = kept ? { ...given, job: kept } : given;
  let action = "added";
  if (at === -1) list.push(member);
  else {
    const before = JSON.stringify(list[at]);
    list[at] = member;
    action = before === JSON.stringify(member) ? "unchanged" : "updated";
  }
  if (action !== "unchanged") vault.write(TEAM_JSON, JSON.stringify({ ...doc, members: list }, null, 2) + "\n");
  return { action, member, rel: TEAM_JSON };
}
