// Asks: a question addressed to a role or a project, carried by the team-brain (#620, R4–R11).
//
// An ask is ONE file, `asks/<id>.md`, in the team-brain clone. The frontmatter says who asked, from
// which project, to whom, and where the thread stands; the body is the question, and each answer is
// appended below it as `## Answer · <date> · <handle> · <status>`. One file per thread rather than
// one per message, because a thread split across files is the thing an inbox would have to stitch
// back together.
//
// `to` is a role some member of `team.json` holds, or a project in `projects/`, and nothing else:
// an ask nobody is placed to see is refused with the list of what exists, never accepted silently.
//
// What does NOT live here:
//   - the secret gate. `ask` and `answer` are `writes: PUBLISHED` in lib/tools.js and the dispatch
//     scrubs them, in the server and in the CLI alike (ADR 0007 rejected a scrub inside the module);
//   - the filesystem. Every read and write goes through the Vault opened on the clone;
//   - the profile. The caller passes the policy, whose `outwardSync` is how a `lab` install commits
//     and does not push, exactly as `capture` does, and whose `destinations` the pull and the push
//     ask first (core/destinations.js).

import { dirname } from "node:path";
import { resolveAuthor } from "../../core/author.js";
import { pull, commitPath, pushHead, teamCloneDir } from "./gitsync.js";
import { openVault } from "./vault.js";
import { readRoster, rolesOf, setMember, jobOf, RosterError } from "./roster.js";
import { ensureTeamClone } from "./team.js";
import { syncAfter } from "./sync.js";
import { AskRefused, oneLine, renderAsk, parseAsk, listAsks } from "./ask-file.js";

// The file's format lives in ask-file.js, which sync.js reads too. Re-exported so callers keep one
// module to import an ask from.
export { AskRefused, renderAsk, parseAsk, setAskMeta, appendSection, headerName, listAsks } from "./ask-file.js";

export const STATUSES = ["open", "answered", "decided", "wontfix"];
/** What an answer may set. `open` is where an ask starts, not something a reply sets. */
export const ANSWER_STATUSES = ["answered", "decided", "wontfix"];

const ID = /^[0-9a-z][0-9a-z-]{0,63}$/;

// What one inbox call may return. The transport caps a whole result at 40,000 characters
// (lib/stdio.js) and a capped result is a truncation marker, not the asks, so this stays under it.
const WAITING_MAX = 30;
const SENT_MAX = 20;
const TEXT_CHARS = 2_000;
const BUDGET = 28_000;

// ---------------------------------------------------------------------------------------------
// Addressing
// ---------------------------------------------------------------------------------------------

/** Every project the team-brain knows: a project file `projects/<slug>.md` or a notes folder. */
export function teamProjects(clone) {
  const vault = openVault(clone);
  const out = new Set();
  for (const e of vault.entries("projects", { ignore: false })) {
    if (e.name.startsWith(".")) continue;
    if (e.isDirectory) out.add(e.name);
    else if (e.isFile && e.name.endsWith(".md")) out.add(e.name.slice(0, -3));
  }
  return [...out].sort();
}

/**
 * What `to` names: a role some member holds, else a project. A name that is both is the role —
 * a role is a person who answers, a project is a place someone may look. Anything else is refused,
 * and the refusal lists what exists so the caller can pick (#620's acceptance).
 */
export function resolveAddressee(clone, to, members) {
  const want = oneLine(to).toLowerCase();
  const roles = rolesOf(members);
  const projects = teamProjects(clone);
  if (want && roles.includes(want)) return { to: want, toKind: "role" };
  if (want && projects.includes(want)) return { to: want, toKind: "project" };
  const list = (xs) => (xs.length ? xs.join(", ") : "none");
  throw new AskRefused(
    "unknown_addressee",
    `no role or project in this team is named '${want}'. Roles: ${list(roles)}. Projects: ${list(projects)}. ` +
      "A role exists once a member holds it in team.json (`ai-os team member`); a project once its repo joins (`/join-team`).",
  );
}

// ---------------------------------------------------------------------------------------------
// Who is asking
// ---------------------------------------------------------------------------------------------

/**
 * Place the caller in the roster: their roles, and the projects they own plus the project of the
 * repo they are in. A caller whose handle is not in `members` — or who has none — is still served:
 * they read asks addressed to this repo's project, and `notice` says why that is all (R3).
 *
 * @param {{ slug: string|null, why?: string }} author  core/author.js's answer
 * @param {object[]} members
 * @param {string|null} project  the connector's project
 */
export function placeCaller(author, members, project) {
  const handle = author?.slug ?? null;
  const me = handle ? members.find((m) => m.handle === handle) : null;
  const projects = [...new Set([...(me?.projects ?? []), ...(project ? [project] : [])])];
  // `job` decides what the rituals offer this person first; an unplaced caller is a developer.
  const caller = { handle, placed: Boolean(me), roles: me?.roles ?? [], projects, project: project ?? null, job: jobOf(me) };
  if (!me) {
    const who = handle
      ? `the handle '${handle}' is not a member in the team-brain's team.json`
      : `no handle could be found (${author?.why ?? "CORTEX_AUTHOR is not set"})`;
    const scope = project ? `asks addressed to this repo's project '${project}'` : "no asks addressed to you";
    caller.notice =
      `Could not place you in the team: ${who}. Set CORTEX_AUTHOR to your handle there, or add yourself with ` +
      "`ai-os team member --handle <handle> --roles <role,...>`. " +
      `Until then the inbox shows ${scope}, and answers to asks you sent.`;
  }
  return caller;
}

const addressedTo = (meta, caller) =>
  (meta.toKind === "role" && caller.roles.includes(meta.to)) ||
  (meta.toKind === "project" && caller.projects.includes(meta.to));

const sentBy = (meta, caller) =>
  caller.handle ? meta.from === caller.handle : Boolean(caller.project) && !meta.from && meta.fromProject === caller.project;

/** How many open asks are addressed to the caller. Local clone only: no pull. */
export function countWaiting(clone, caller) {
  return listAsks(clone).filter((a) => a.meta.status === "open" && addressedTo(a.meta, caller)).length;
}

// ---------------------------------------------------------------------------------------------
// The three operations
// ---------------------------------------------------------------------------------------------

function publish(clone, rel, message, gate) {
  const c = commitPath(clone, rel, message);
  if (!c.ok) return { committed: false, pushed: false, error: c.error };
  if (!gate.policy.outwardSync) return { committed: c.committed, pushed: false, error: "outward_sync_disabled" };
  const p = pushHead(clone, gate);
  return p.ok ? { committed: c.committed, pushed: true } : { committed: c.committed, pushed: false, error: p.error };
}

/**
 * Send an ask. `content` is the question; `title` defaults to its first line.
 *
 * @param {string} clone
 * @param {{ to: string, content: string, title?: string, links?: string[], caller: object, id: string, today: string, policy: object, env?: object }} opts
 */
export function sendAsk(clone, { to, content, title, links = [], caller, id, today, policy, env = process.env }) {
  if (!policy) throw new TypeError("sendAsk: { policy } is required — pass brain.policy");
  const gate = { policy, env };
  const outwardSync = policy.outwardSync;
  const question = String(content ?? "").trim();
  if (!question) throw new AskRefused("empty", "an ask needs a question in `content`");
  if (!ID.test(id)) throw new AskRefused("bad_id", "the ask id is not a-z, 0-9 and -");
  if (!Array.isArray(links) || links.some((l) => typeof l !== "string")) throw new AskRefused("bad_links", "links must be a list of strings");

  // Best-effort, as capture does: the roster and the projects are read after it. Pointless when the
  // commit will not be pushed.
  if (outwardSync) pull(clone, gate);
  const { members } = readRoster(clone);
  const addressee = resolveAddressee(clone, to, members);

  const vault = openVault(clone);
  const rel = `asks/${id}.md`;
  if (vault.exists(rel)) throw new AskRefused("exists", `an ask with the id ${id} already exists; nothing was written`);
  const meta = {
    id,
    title: oneLine(title) || oneLine(question.split("\n")[0]).slice(0, 80),
    from: caller.handle ?? "",
    fromProject: caller.project ?? "",
    ...addressee,
    status: "open",
    created: today,
    updated: today,
    links: links.map((l) => l.trim()).filter(Boolean),
  };
  vault.write(rel, renderAsk(meta, question));
  const res = publish(clone, rel, `ask: ${id} to ${meta.toKind} ${meta.to}`, gate);
  return { id, path: vault.abs(rel), to: meta.to, toKind: meta.toKind, status: meta.status, ...res };
}

/**
 * Append an answer to an ask and set its status. The question and earlier answers are kept byte
 * for byte; only the `status:` and `updated:` lines of the frontmatter change.
 */
export function answerAsk(clone, { id, content, status = "answered", caller, today, policy, env = process.env }) {
  if (!policy) throw new TypeError("answerAsk: { policy } is required — pass brain.policy");
  const gate = { policy, env };
  const outwardSync = policy.outwardSync;
  const text = String(content ?? "").trim();
  if (!text) throw new AskRefused("empty", "an answer needs its text in `content`");
  if (typeof id !== "string" || !ID.test(id)) throw new AskRefused("bad_id", "id must be an ask id: a-z, 0-9 and -");
  if (!ANSWER_STATUSES.includes(status)) {
    throw new AskRefused("bad_status", `status must be one of ${ANSWER_STATUSES.join(" | ")}`);
  }

  if (outwardSync) pull(clone, gate);
  const vault = openVault(clone);
  const rel = `asks/${id}.md`;
  if (!vault.isFile(rel)) throw new AskRefused("not_found", `no ask with the id ${id} in the team-brain`);
  const before = vault.read(rel).replace(/\r\n/g, "\n");
  if (!parseAsk(before)) throw new AskRefused("not_an_ask", `asks/${id}.md is not an ask file`);

  const fm = before.match(/^---\n[\s\S]*?\n---\n?/)[0];
  const head = fm.replace(/^status: .*$/m, `status: ${status}`).replace(/^updated: .*$/m, `updated: ${today}`);
  const body = before.slice(fm.length).replace(/\n*$/, "\n");
  const who = caller.handle ?? "unknown";
  vault.write(rel, `${head}${body}\n## Answer · ${today} · ${who} · ${status}\n\n${text}\n`);
  const res = publish(clone, rel, `answer: ${id} ${status}`, gate);
  return { id, path: vault.abs(rel), status, ...res };
}

function clip(text, room) {
  const s = String(text);
  return s.length > room ? { text: s.slice(0, room), clipped: true } : { text: s, clipped: false };
}

/**
 * The caller's inbox: open asks addressed to their roles or projects, and the asks they sent with
 * every answer so far. `pulled` is the result of the ff-only pull the caller made first; a failed
 * pull is returned, never swallowed — the local asks still come back, because an empty answer must
 * never pass for a quiet week (R11).
 */
export function readInbox(clone, { caller, pulled = { ok: true } }) {
  const all = listAsks(clone);
  let budget = BUDGET;
  let truncated = false;
  const shape = (a) => {
    const q = clip(a.question, Math.max(0, Math.min(TEXT_CHARS, budget)));
    budget -= q.text.length;
    const answers = a.answers.map((x) => {
      const t = clip(x.text, Math.max(0, Math.min(TEXT_CHARS, budget)));
      budget -= t.text.length;
      if (t.clipped) truncated = true;
      return { date: x.date, handle: x.handle, status: x.status, text: t.text };
    });
    const comments = (a.comments ?? []).map((x) => {
      const t = clip(x.text, Math.max(0, Math.min(TEXT_CHARS, budget)));
      budget -= t.text.length;
      if (t.clipped) truncated = true;
      return { date: x.date, author: x.author, kind: x.kind, text: t.text };
    });
    if (q.clipped) truncated = true;
    const { id, title, from, fromProject, to, toKind, status, created, updated, links, assignee } = a.meta;
    const out = { id, title, from, fromProject, to, toKind, status, created, updated, links, question: q.text, answers };
    if (assignee) out.assignee = assignee;
    if (comments.length) out.comments = comments;
    return out;
  };

  const waitingAll = all.filter((a) => a.meta.status === "open" && addressedTo(a.meta, caller));
  const sentAll = all.filter((a) => sentBy(a.meta, caller));
  if (waitingAll.length > WAITING_MAX || sentAll.length > SENT_MAX) truncated = true;
  const waiting = waitingAll.slice(0, WAITING_MAX).map(shape);
  const sent = sentAll.slice(0, SENT_MAX).map(shape);

  const me = { handle: caller.handle, placed: caller.placed, roles: caller.roles, projects: caller.projects, job: caller.job ?? jobOf(null) };
  const out = {
    pull: pulled.ok ? { ok: true } : { ok: false, error: String(pulled.error).split("\n").slice(0, 3).join("\n").trim() },
    me,
    waiting,
    sent,
    truncated,
  };
  if (caller.notice) out.notice = caller.notice;
  return out;
}

/**
 * The line the server's `initialize` result carries on a team (R10): how many asks wait for the
 * caller, and to call `inbox` first. Reads the local clone and never pulls, so starting a session
 * costs no network. Never throws: a clone that is missing or a roster that is broken just drops the
 * count from the line.
 *
 * @param {{ team: string|null, teamClone: string|null, project: string|null }} brain
 * @param {() => { slug: string|null, why?: string }} author
 * @returns {string|null}
 */
export function asksInstructions(brain, author) {
  if (!brain.team) return null;
  const call = "Call the `inbox` tool at the start of a task to read asks addressed to you, and `answer` to reply.";
  let count = null;
  let handle = null;
  try {
    const { members } = readRoster(brain.teamClone);
    const caller = placeCaller(author(), members, brain.project);
    handle = caller.handle;
    count = countWaiting(brain.teamClone, caller);
  } catch {
    count = null;
  }
  const team = `This repo is joined to the team-brain '${brain.team}'.`;
  if (count === null) return `${team} ${call}`;
  const n = count === 1 ? "1 ask is" : `${count} asks are`;
  return `${team} ${n} open for you${handle ? ` (${handle})` : ""}. ${call}`;
}

// ---------------------------------------------------------------------------------------------
// From a brain: what both adapters call
// ---------------------------------------------------------------------------------------------
//
// `server.js` and `ai-os.js` are two adapters over these, so neither decides which clone, which
// caller or which push: the brain record says which team and clone, `core/author.js` says who, and
// the policy says whether the commit leaves the machine.

/**
 * Who is calling: the author slug, resolved as memory resolves it (CORTEX_AUTHOR, then git
 * `user.name` in the repo). In repo mode git is asked in the product repo, not wherever the process
 * happens to stand. A CORTEX_AUTHOR that is set and unusable throws `InvalidAuthorError`.
 */
export function authorFor(brain, { env, cwd, git } = {}) {
  return resolveAuthor({ env, cwd: brain.isRepo ? dirname(brain.root) : cwd, ...(git ? { git } : {}) });
}

function openClone(brain, tool, ctx) {
  // The author first: a CORTEX_AUTHOR that is set and wrong refuses before anything is cloned.
  const author = authorFor(brain, ctx);
  const { dir } = ensureTeamClone(brain, tool);
  return { dir, author };
}

// Each of the three runs a tracker sync for the asks it touched (#624), after its own write is
// committed. `syncAfter` returns null when the team selected no integration — then no tracker is
// named, no `fetch` is reached, and the result is the one #620 shipped — and never throws: a
// tracker that is down leaves the link pending, it does not fail the ask.

/** `ask`: send one. `id` and `today` come from the adapter (lib/noteid.js, core/date.js). */
export async function askFrom(brain, args, ctx) {
  const { dir, author } = openClone(brain, "ask", ctx);
  const caller = placeCaller(author, [], brain.project);
  const res = sendAsk(dir, {
    to: args.to, content: args.content, title: args.title, links: args.links ?? [],
    caller, id: ctx.id, today: ctx.today, policy: brain.policy, env: brain.env,
  });
  const sync = await syncAfter(brain, dir, [res.id], ctx);
  return sync ? { ...res, sync } : res;
}

/** `inbox`: pull (ff-only), sync the asks it is about to show, then the asks for the caller and the answers to theirs. */
export async function inboxFrom(brain, ctx) {
  const { dir, author } = openClone(brain, "inbox", ctx);
  const pulled = pull(dir, { policy: brain.policy, env: brain.env });
  const { members, errors } = readRoster(dir);
  const caller = placeCaller(author, members, brain.project);
  const involved = listAsks(dir).filter((a) => (a.meta.status === "open" && addressedTo(a.meta, caller)) || sentBy(a.meta, caller)).map((a) => a.meta.id);
  const sync = involved.length ? await syncAfter(brain, dir, involved, ctx) : null;
  const out = readInbox(dir, { caller, pulled });
  if (errors.length) out.rosterErrors = errors;
  if (sync) out.sync = sync;
  return out;
}

/** `answer`: append a reply and set the status. */
export async function answerFrom(brain, args, ctx) {
  const { dir, author } = openClone(brain, "answer", ctx);
  const caller = placeCaller(author, [], brain.project);
  const res = answerAsk(dir, {
    id: args.id, content: args.content, status: args.status ?? "answered",
    caller, today: ctx.today, policy: brain.policy, env: brain.env,
  });
  const sync = await syncAfter(brain, dir, [res.id], ctx);
  return sync ? { ...res, sync } : res;
}

/**
 * `ai-os team member`: add or update one member of `team.json`, then commit and push it. `team`
 * overrides the connector's, for a lead standing in the vault rather than in a joined repo; its
 * clone must already be there (`team init` made it), since no connector names a remote for it.
 */
export function memberFrom(brain, input, ctx, { team = null } = {}) {
  const author = authorFor(brain, ctx);
  const handle = input.handle ?? author.slug;
  if (!handle) throw new RosterError(`no handle given and none could be found (${author.why}). Pass --handle, or set CORTEX_AUTHOR.`);
  const target = team && team !== brain.team
    ? { ...brain, team, teamClone: teamCloneDir(brain.root, team), teamBrainRepo: null }
    : brain;
  const { dir } = ensureTeamClone(target, "team member");
  const gate = { policy: brain.policy, env: brain.env };
  if (brain.policy.outwardSync) pull(dir, gate);
  const res = setMember(dir, { ...input, handle });
  if (res.action === "unchanged") return { ...res, committed: false, pushed: false };
  return { ...res, ...publish(dir, res.rel, `team: member ${handle}`, gate) };
}
