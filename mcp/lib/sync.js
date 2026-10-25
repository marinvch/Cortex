// Two-way sync between the asks in a team-brain and the trackers it is connected to (#624, R18).
//
// The brain is the record of WHAT WAS ASKED; the trackers are the record of WHERE THE WORK STANDS.
//
//   Brain → trackers   a new open ask becomes one item per routed tracker; every answer, and every
//                      comment pulled from another tracker, is posted as a comment; a closed ask
//                      closes the item.
//   Trackers → brain   status and assignee from the PRIMARY tracker; comments from all of them.
//
// The rules, each of which a test pins:
//
// - **Nothing touches the network unless the team selected an integration** (R19), and nothing
//   does on a profile that does not sync outward (`lab`): calling a tracker IS publishing.
// - **Idempotent.** A link `{ kind, state: "pending" }` is written to the ask file BEFORE the create
//   call is made, and the tracker is searched for the ask's marker before anything is created, so a
//   retry after a timeout finds the item the first call made instead of making a second. Comments
//   Cortex posts end with `[cortex:<ask>/<entry>]`; a pull recognises its own and never copies them
//   back, and a push skips an entry the tracker already holds. A second run with nothing new
//   changes nothing and commits nothing.
// - **Conflicts.** The primary tracker wins on status, and only when its status CHANGED since the
//   last sync — an answer given in the brain is not undone by the tracker it has not reached yet. The
//   brain wins on the ask's text: nothing is ever pulled into the question. A comment appears once,
//   de-duplicated by its origin id (`originIds` on the link).
// - **One commit per run**, `sync: servicenow 1 updated, github 1 created`, then a push. The git
//   history of the brain is the audit trail.
// - **Offline-safe.** An unreachable tracker or a missing credential leaves the link `pending`
//   with the reason, and the next run retries. `ai-os sync --status` lists what is stuck.
// - **The secret gate, both ways.** Every text posted to a tracker is scanned first, and every
//   comment pulled in is scanned before it is written: one carrying a credential is withheld, and
//   the brain records that it was, and why — never the text.

import { RefusedWriteError, scan } from "../../core/scrub.js";
import { assertPublished } from "../../core/gate.js";

/** The refusal code the publish gate (`core/gate.js`) gives this text, or null when it may cross. */
function refusedBy(text, gate) {
  try {
    assertPublished(text, gate);
    return null;
  } catch (e) {
    if (e instanceof RefusedWriteError) return e.code;
    throw e;
  }
}
import { stamp, clock } from "../../core/date.js";
import { parseProjectFile } from "../../core/project-file.js";
import { openVault } from "./vault.js";
import { pull, commitPaths, pushHead, teamCloneDir } from "./gitsync.js";
import { listAsks, parseAsk, setAskMeta, appendSection, headerName } from "./ask-file.js";
import { readRoster } from "./roster.js";
import { ensureTeamClone, TEAM_JSON } from "./team.js";
import {
  readIntegrations, readTeamDoc, parseIntegrations, routedKinds, primaryFor, adapterFor,
  addIntegration, removeIntegration, credentialStatus, IntegrationError,
} from "./integrations.js";
import { syncWorkflowFor, writeSyncWorkflow, WORKFLOW_REL } from "./sync-workflow.js";
import { githubRepoOf } from "./trackers/github.js";
import { entryTag, ENTRY_TAG_RE } from "./trackers/http.js";
import { mirrorStories, storyKinds } from "./stories.js";

const isLink = (l) => l && typeof l === "object" && !Array.isArray(l) && typeof l.kind === "string";
const errText = (e) => String(e?.message ?? e).split("\n")[0].slice(0, 300);

/** Does this ask still have work for the trackers? Open, or a routed link not yet closed. */
function needsSync(meta, kinds) {
  if (meta.status === "open") return kinds.length > 0;
  return (meta.links ?? []).some((l) => isLink(l) && kinds.includes(l.kind) && !l.closed);
}

/** Where the item goes in one tracker: a GitHub repo, a ServiceNow group. Throws when there is none. */
function targetFor(entry, meta, { vault, members }) {
  if (entry.kind === "github") {
    const projects = meta.toKind === "project"
      ? [meta.to]
      : [...new Set(members.filter((m) => m.roles.includes(meta.to)).flatMap((m) => m.projects))].sort();
    for (const p of projects) {
      const rel = `projects/${p}.md`;
      if (!vault.isFile(rel)) continue;
      const repo = githubRepoOf(parseProjectFile(vault.read(rel)).data.repo, entry.host ?? "github.com");
      if (repo) return { repo };
    }
    if (entry.repo) return { repo: entry.repo };
    throw Object.assign(
      new Error(`github: no repo for ${meta.toKind} '${meta.to}' — none of its projects' files has a GitHub repo, and integrations.github has no repo to fall back on`),
      { retryable: false },
    );
  }
  if (entry.kind === "servicenow") {
    const group = entry.groups?.[meta.to] ?? entry.group;
    return group ? { group } : {};
  }
  return {};
}

/** The text an entry is posted as. The tag at the end is how every later sync recognises it. */
function outgoing(askId, entry) {
  const head = entry.kind === "answer"
    ? `Answer from ${entry.who} (${entry.status}):`
    : `${entry.who} on ${entry.from}:`;
  return `${head}\n\n${entry.text}\n\n${entryTag(askId, entry.id)}`;
}

/** Every entry of a parsed ask that a tracker should carry, in file order. */
function entriesOf(parsed) {
  return [
    ...parsed.answers.map((a, i) => ({ id: `answer-${i + 1}`, kind: "answer", from: null, who: a.handle, status: a.status, text: a.text })),
    ...parsed.comments.map((c) => ({ id: `${c.kind}:${c.origin}`, kind: "comment", from: c.kind, who: c.author, text: c.text })),
  ];
}

/**
 * Sync one ask against every tracker it is routed to. Mutates nothing it was handed; reads and
 * writes the ask file through `vault`. Returns what happened per kind.
 */
async function syncOne(rel, { vault, config, kinds, members, adapter, now, today, gate }) {
  const original = vault.read(rel).replace(/\r\n/g, "\n");
  let text = original;
  let parsed = parseAsk(text);
  const meta = parsed.meta;
  const id = meta.id;
  const links = Array.isArray(meta.links) ? meta.links.map((l) => (isLink(l) ? { ...l } : l)) : [];
  const save = (changes = {}) => {
    text = setAskMeta(text, { ...changes, links });
    vault.write(rel, text);
    parsed = parseAsk(text);
  };
  const primary = primaryFor(config, kinds);
  // The primary first: its status decides what the others are told in the same run.
  const order = [...kinds].sort((a, b) => (a === primary ? -1 : b === primary ? 1 : 0));
  const result = {};
  let status = meta.status;
  let assignee = meta.assignee ?? null;

  // Two passes. Pull from every tracker first, so a comment made in one reaches the others in the
  // same run; then push and close. One pass would leave half the work to the next run, and that
  // run would commit — "sync twice, the second changes nothing" would not hold.
  const live = [];
  const touched = [];
  for (const kind of order) {
    const entry = config.integrations.find((i) => i.kind === kind);
    let link = links.find((l) => isLink(l) && l.kind === kind);
    const before = link ? JSON.stringify(link) : null;
    const did = { created: false, updated: false, pending: false };
    result[kind] = did;

    if (!link) {
      if (status !== "open") continue; // a closed ask is not filed somewhere new
      link = { kind, state: "pending", syncedAt: now };
      links.push(link);
      save(); // written before the remote call, so a crash mid-call leaves a record to retry from
    }
    touched.push({ link, before, did });

    let api;
    try {
      api = adapter(entry);
    } catch (e) {
      link.error = errText(e);
      did.pending = link.state === "pending";
      continue;
    }

    if (link.state === "pending") {
      try {
        const ask = {
          id, title: meta.title, question: parsed.question, to: meta.to, toKind: meta.toKind,
          from: meta.from, fromProject: meta.fromProject, created: meta.created,
          target: targetFor(entry, meta, { vault, members }),
        };
        const found = await api.find(ask);
        const made = found ?? (await api.create(ask));
        Object.assign(link, { state: "ok", key: made.key, url: made.url, syncedAt: now });
        delete link.error;
        did.created = !found;
        did.updated = Boolean(found);
        save();
      } catch (e) {
        link.error = errText(e);
        did.pending = true;
        save();
        continue;
      }
    }

    // The link is live: read it, and pull status and comments.
    try {
      link.originIds = link.originIds ?? [];
      link.pushed = link.pushed ?? [];
      const r = await api.read(link.key);

      if (kind === primary) {
        // An item Cortex has not read before started open: one found already closed — the retry
        // after a timeout, while someone worked it — is a change like any other.
        if (r.status !== (link.status ?? "open")) {
          if (r.status !== "open" && status === "open") {
            const by = r.assignee ? ` by ${r.assignee}` : "";
            text = appendSection(text, `## Answer · ${today} · ${kind} · ${r.status}`, `Closed in ${kind} ${link.key}${r.state ? ` (${r.state})` : ""}${by}.`);
            status = r.status;
            parsed = parseAsk(text);
            link.pushed.push(`answer-${parsed.answers.length}`); // it came from here; never post it back
            link.closed = true;
          } else if (r.status === "open" && status !== "open") {
            status = "open";
            link.closed = false;
            for (const other of links) if (isLink(other) && other !== link) other.closed = false;
          }
        }
        link.status = r.status;
        if (r.assignee && headerName(r.assignee) !== assignee) assignee = headerName(r.assignee);
      }

      // Comments in. Cortex's own are recognised by their tag and never copied back.
      for (const c of r.comments) {
        const own = String(c.text).match(ENTRY_TAG_RE);
        if (own) {
          if (own[1] === id && !link.pushed.includes(own[2])) link.pushed.push(own[2]);
          continue;
        }
        if (link.originIds.includes(c.id)) continue;
        const found = scan(`${c.author}\n${c.text}`);
        // Past a credential, the rest of the gate: the employer denylist on `home`, personal data
        // in `refuse` mode. A comment crossing into the brain is a publish like any other.
        const refused = found.length ? null : refusedBy(`${c.author}\n${c.text}`, gate);
        const body = found.length
          ? `(withheld: this ${kind} comment carries a ${[...new Set(found.map((f) => f.kind))].join(", ")}, so it was not copied into the team-brain. Read it in ${kind}, and ask its author to remove the credential there.)`
          : refused
            ? `(withheld: this ${kind} comment was refused by the publish gate (${refused}), so it was not copied into the team-brain. Read it in ${kind}.)`
            : c.text;
        text = appendSection(text, `## Comment · ${today} · ${headerName(c.author)} · ${kind}:${c.id}`, body || "(empty comment)");
        link.originIds.push(c.id);
        // A withheld comment is never posted onward: there is nothing to post.
        if (found.length || refused) link.pushed.push(`${kind}:${c.id}`);
      }
      parsed = parseAsk(text);
      delete link.error;
      live.push({ kind, link, api });
    } catch (e) {
      link.error = errText(e);
    }
  }

  // Push: answers, and comments that came from another tracker; then close.
  for (const { kind, link, api } of live) {
    try {
      for (const e of entriesOf(parsed)) {
        if (e.from === kind || link.pushed.includes(e.id)) continue;
        if (e.kind === "comment" && e.text.startsWith("(withheld:")) { link.pushed.push(e.id); continue; }
        const out = outgoing(id, e);
        if (scan(out).length || refusedBy(out, gate)) { link.pushed.push(e.id); continue; } // the gate on the way out
        await api.comment(link.key, out);
        link.pushed.push(e.id);
      }

      // Close.
      if (status !== "open" && !link.closed) {
        await api.close(link.key, status);
        link.closed = true;
        if (kind === primary) link.status = status;
      }
    } catch (e) {
      link.error = errText(e);
    }
  }

  for (const { link, before, did } of touched) {
    if (JSON.stringify(link) !== before) {
      if (before !== null && !did.created) did.updated = true;
      link.syncedAt = now;
    }
  }
  const metaChanges = {};
  if (status !== meta.status) { metaChanges.status = status; metaChanges.updated = today; }
  if (assignee && assignee !== (meta.assignee ?? null)) metaChanges.assignee = assignee;
  save(metaChanges);

  // Nothing new: leave the file exactly as it was, so the run commits nothing.
  if (text === original) return { changed: false, result };
  return { changed: true, result };
}

/**
 * Sync the asks in a team-brain clone with its trackers. Writes the asks and returns what changed;
 * committing is `syncClone`'s. `ids` narrows the run to those asks (the ones an `ask`, `answer` or
 * `inbox` call touched).
 *
 * @param {string} clone
 * @param {{ ids?: string[]|null, policy: { outwardSync: boolean }, env?: object, fetch?: Function, timeoutMs?: number, now?: string, today: string }} opts
 */
export async function syncAsks(clone, { ids = null, policy, env = {}, fetch, timeoutMs, now = `${stamp()} ${clock()}`, today = stamp() }) {
  const config = readIntegrations(clone);
  if (!config.kinds.length) return { ran: false, reason: "no_integrations" };
  if (!policy?.outwardSync) return { ran: false, reason: "outward_sync_disabled" };

  const vault = openVault(clone);
  let members = [];
  try { members = readRoster(clone).members; } catch { members = []; }
  // `policy` rides on the I/O so `request` (trackers/http.js) can ask core/destinations.js before
  // every fetch: on work, a tracker host that is not approved is never called.
  const io = { env, fetch, timeoutMs, policy };
  const made = new Map();
  const adapter = (entry) => {
    if (!made.has(entry.kind)) {
      try { made.set(entry.kind, { api: adapterFor(entry, io) }); } catch (e) { made.set(entry.kind, { error: e }); }
    }
    const m = made.get(entry.kind);
    if (m.error) throw m.error;
    return m.api;
  };

  const want = ids ? new Set(ids) : null;
  const counts = Object.fromEntries(config.kinds.map((k) => [k, { created: 0, updated: 0, pending: 0 }]));
  const changed = [];
  for (const a of listAsks(clone)) {
    if (want && !want.has(a.meta.id)) continue;
    const kinds = routedKinds(config, a.meta.to);
    if (!needsSync(a.meta, kinds)) continue;
    const { changed: did, result } = await syncOne(a.rel, { vault, config, kinds, members, adapter, now, today, gate: { policy, env } });
    if (did) changed.push(a.rel);
    for (const [k, r] of Object.entries(result)) {
      if (r.created) counts[k].created++;
      else if (r.updated) counts[k].updated++;
      if (r.pending) counts[k].pending++;
    }
  }
  return { ran: true, changed, counts, message: commitMessage(counts) };
}

/** `sync: servicenow 1 updated, github 1 created, stories 3 written` — the counts that are not zero. */
export function commitMessage(counts, storiesWritten = 0) {
  const parts = [];
  for (const [k, c] of Object.entries(counts)) {
    for (const what of ["created", "updated", "pending"]) if (c[what]) parts.push(`${k} ${c[what]} ${what}`);
  }
  if (storiesWritten) parts.push(`stories ${storiesWritten} written`);
  return `sync: ${parts.length ? parts.join(", ") : "links updated"}`;
}

/** The story mirror's run for one clone (lib/stories.js), with the I/O the asks use. */
async function mirrorFor(clone, opts) {
  const config = readIntegrations(clone);
  let members = [];
  try { members = readRoster(clone).members; } catch { members = []; }
  const env = opts.env ?? {};
  return mirrorStories(clone, { config, members, policy: opts.policy, env, today: opts.today, io: { env, fetch: opts.fetch, timeoutMs: opts.timeoutMs, policy: opts.policy } });
}

/** A story run without its file list, for a result. */
function storiesSummary(st) {
  const out = { ran: st.ran };
  if (st.reason) out.reason = st.reason;
  if (st.ran) Object.assign(out, { written: st.written, unchanged: st.unchanged, skipped: st.skipped, withheld: st.withheld, assigneesWithheld: st.assigneesWithheld });
  if (Object.keys(st.errors ?? {}).length) out.errors = st.errors;
  if (st.warnings?.length) out.warnings = st.warnings;
  return out;
}

/**
 * Pull, sync, and commit what changed as ONE commit, then push. The function both the CLI and the
 * ask tools call. `pullFirst` is false when the caller has just pulled. `push: false` leaves the
 * commit for the caller to push — the scheduled workflow does, from a step that holds the token,
 * so the token is never in the git config while this code runs.
 */
export async function syncClone(clone, opts) {
  const { pullFirst = true, push = true } = opts;
  const gate = { policy: opts.policy, env: opts.env ?? process.env };
  if (pullFirst && push && opts.policy?.outwardSync) pull(clone, gate);
  const asks = await syncAsks(clone, opts);
  // The story mirror runs on a full sync only: an ask, answer or inbox call narrows the run to the
  // asks it touched (`ids`), and reading every story there would make each of them slow.
  const st = asks.ran && !opts.ids && opts.stories !== false ? await mirrorFor(clone, opts) : null;
  const res = st ? { ...asks, changed: [...asks.changed, ...st.changed], stories: storiesSummary(st) } : asks;
  if (st?.written) res.message = commitMessage(asks.counts, st.written);
  if (!res.ran || !res.changed.length) return { ...res, committed: false, pushed: false };
  const c = commitPaths(clone, res.changed, res.message);
  if (!c.ok) return { ...res, committed: false, pushed: false, error: c.error };
  if (!push) return { ...res, committed: c.committed, pushed: false, error: "push_left_to_caller" };
  const p = pushHead(clone, gate);
  return { ...res, committed: c.committed, pushed: p.ok, ...(p.ok ? {} : { error: p.error }) };
}

/**
 * What a sync would do, read off the files alone: no network, no write. A dry run cannot know
 * what changed in a tracker, so it says what it would ASK each one, not what it would learn.
 */
export function syncPlan(clone, { ids = null, policy } = {}) {
  const config = readIntegrations(clone);
  if (!config.kinds.length) return { ran: false, reason: "no_integrations", plan: [] };
  const plan = [];
  for (const a of listAsks(clone)) {
    if (ids && !ids.includes(a.meta.id)) continue;
    const kinds = routedKinds(config, a.meta.to);
    if (!needsSync(a.meta, kinds)) continue;
    const parsed = a;
    const steps = [];
    for (const kind of kinds) {
      const link = (a.meta.links ?? []).find((l) => isLink(l) && l.kind === kind);
      if (!link) { if (a.meta.status === "open") steps.push(`${kind}: look for an item marked ${a.meta.id}, create one if there is none`); continue; }
      if (link.state === "pending") { steps.push(`${kind}: retry the pending link${link.error ? ` (last: ${link.error})` : ""}`); continue; }
      const pushed = new Set(link.pushed ?? []);
      const out = entriesOf(parsed).filter((e) => e.from !== kind && !pushed.has(e.id)).length;
      steps.push(`${kind} ${link.key}: read status and comments${out ? `, post ${out} entr${out === 1 ? "y" : "ies"}` : ""}${a.meta.status !== "open" && !link.closed ? `, close as ${a.meta.status}` : ""}`);
    }
    plan.push({ id: a.meta.id, status: a.meta.status, to: a.meta.to, steps });
  }
  // The story mirror's half: which trackers it would read, never what they hold.
  const stories = ids ? [] : storyKinds(config).map((k) => `${k}: read its epics and stories, write each to stories/<key>.md when it changed`);
  return { ran: false, reason: policy && !policy.outwardSync ? "outward_sync_disabled" : "dry_run", primary: config.primary, plan, stories };
}

/**
 * Every link that is not in sync: pending (never created, or the last call failed), carrying an
 * error, or to a tracker the team has since removed — readable, and no longer synced.
 */
export function syncStatus(clone) {
  let kinds = [];
  try { kinds = readIntegrations(clone).kinds; } catch { kinds = []; }
  const stuck = [];
  const inactive = [];
  for (const a of listAsks(clone)) {
    for (const l of (a.meta.links ?? []).filter(isLink)) {
      const row = { id: a.meta.id, kind: l.kind, state: l.state, key: l.key ?? null, url: l.url ?? null, syncedAt: l.syncedAt ?? null };
      if (!kinds.includes(l.kind)) inactive.push(row);
      else if (l.state !== "ok" || l.error) stuck.push({ ...row, error: l.error ?? null });
    }
  }
  return { integrations: kinds, stuck, inactive };
}

// ---------------------------------------------------------------------------------------------
// From a brain: what the ask tools and the CLI call
// ---------------------------------------------------------------------------------------------

/** The I/O a sync uses, from the adapter's context: the environment, `fetch`, the timeout. */
export function ioFrom(ctx = {}) {
  const env = ctx.env ?? {};
  const t = Number(env.CORTEX_SYNC_TIMEOUT_MS);
  return { env, fetch: ctx.fetch, timeoutMs: ctx.timeoutMs ?? (Number.isFinite(t) && t > 0 ? t : undefined) };
}

/**
 * The sync an `ask`, `answer` or `inbox` call runs for the asks it touched. Never throws: the ask
 * was written, and a tracker being down must not turn that into an error. Returns null when the
 * team has no integration, so a result on a team without trackers is the one #620 shipped.
 */
export async function syncAfter(brain, clone, ids, ctx) {
  try {
    const res = await syncClone(clone, { ids, policy: brain.policy, today: ctx.today, pullFirst: false, ...ioFrom({ ...ctx, env: ctx.env ?? brain.env }) });
    if (!res.ran && res.reason === "no_integrations") return null;
    return summarise(res);
  } catch (e) {
    return { ran: false, error: errText(e) };
  }
}

/** A sync result, without the per-file list. */
export function summarise(res) {
  const out = { ran: res.ran };
  if (res.reason) out.reason = res.reason;
  if (res.ran) Object.assign(out, { message: res.changed.length ? res.message : "nothing to sync", committed: res.committed, pushed: res.pushed });
  if (res.stories) out.stories = res.stories;
  if (res.error) out.error = res.error;
  return out;
}

/**
 * The team-brain clone a CLI command works on: `--clone <dir>` (the scheduled workflow, standing
 * in a checkout of the brain), `--team <name>` (a lead in the vault), or the connector's team.
 */
export function cloneFor(brain, tool, { clone = null, team = null } = {}) {
  if (clone) {
    if (!openVault(clone).exists(".git")) throw Object.assign(new Error(`${tool}: ${clone} is not a git checkout of a team-brain`), { code: "no_clone" });
    return clone;
  }
  const target = team && team !== brain.team
    ? { ...brain, team, teamClone: teamCloneDir(brain.root, team), teamBrainRepo: null }
    : brain;
  return ensureTeamClone(target, tool).dir;
}

/** `ai-os sync`: pull, sync every ask that has work for a tracker, one commit, push. */
export async function syncFrom(brain, { clone = null, team = null, dryRun = false, status = false, push = true } = {}, ctx = {}) {
  const dir = cloneFor(brain, "sync", { clone, team });
  if (status) return { clone: dir, ...syncStatus(dir) };
  if (dryRun) return { clone: dir, ...syncPlan(dir, { policy: brain.policy }) };
  const res = await syncClone(dir, { policy: brain.policy, today: ctx.today, push, ...ioFrom({ ...ctx, env: ctx.env ?? brain.env }) });
  return { clone: dir, ...summarise(res), counts: res.counts ?? null, changed: res.changed ?? [] };
}

/** Commit the given team files as one commit; push when the profile allows. */
function publishTeamFiles(dir, files, message, brain) {
  const c = commitPaths(dir, files, message);
  if (!c.ok) return { committed: false, pushed: false, error: c.error };
  if (!c.committed) return { committed: false, pushed: false };
  if (!brain.policy.outwardSync) return { committed: true, pushed: false, error: "outward_sync_disabled" };
  const p = pushHead(dir, { policy: brain.policy, env: brain.env });
  return p.ok ? { committed: true, pushed: true } : { committed: true, pushed: false, error: p.error };
}

/**
 * `ai-os integrations list|add|remove|workflow`. Changes team.json through the integration
 * functions, which validate the whole selection before anything is written, and commits it.
 * Removing a tracker leaves every link to it in the ask files, readable; sync stops using them.
 *
 * @param {object} brain
 * @param {"list"|"add"|"remove"|"workflow"} sub
 * @param {{ entry?: object, kind?: string, primary?: string|null, write?: boolean, clone?: string|null, team?: string|null }} input
 * @param {{ env?: object }} ctx
 */
export function integrationsFrom(brain, sub, input = {}, ctx = {}) {
  const dir = cloneFor(brain, `integrations ${sub}`, input);
  if (brain.policy.outwardSync && !input.clone) pull(dir, { policy: brain.policy, env: brain.env });
  const vault = openVault(dir);
  const doc = readTeamDoc(dir);
  if (sub === "list") {
    const config = parseIntegrations(doc);
    return {
      clone: dir,
      integrations: config.integrations.map((i) => ({ ...i, primary: i.kind === config.primary, credentials: credentialStatus(i.kind, ctx.env ?? {}) })),
      primary: config.primary,
      routes: config.routes,
      workflow: vault.isFile(WORKFLOW_REL) ? WORKFLOW_REL : null,
    };
  }
  if (sub === "workflow") {
    const text = syncWorkflowFor(dir, { profile: brain.profile });
    if (!input.write) return { clone: dir, written: false, path: WORKFLOW_REL, text };
    const rel = writeSyncWorkflow(dir, text);
    return { clone: dir, written: true, path: rel, ...publishTeamFiles(dir, [rel], "sync: scheduled tracker sync workflow", brain) };
  }
  let next;
  let message;
  if (sub === "add") {
    next = addIntegration(doc, input.entry, { primary: input.primary ?? null });
    message = `team: integration ${input.entry.kind} added`;
  } else if (sub === "remove") {
    next = removeIntegration(doc, input.kind);
    message = `team: integration ${input.kind} removed`;
  } else {
    throw new IntegrationError("usage: integrations list|add|remove|workflow");
  }
  const before = vault.isFile(TEAM_JSON) ? vault.read(TEAM_JSON) : "";
  const text = JSON.stringify(next, null, 2) + "\n";
  const config = parseIntegrations(next);
  if (text === before) return { clone: dir, action: "unchanged", kinds: config.kinds, primary: config.primary, committed: false, pushed: false };
  vault.write(TEAM_JSON, text);
  return { clone: dir, action: sub === "add" ? "added" : "removed", kinds: config.kinds, primary: config.primary, ...publishTeamFiles(dir, [TEAM_JSON], message, brain) };
}
