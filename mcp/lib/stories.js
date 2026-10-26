// The story mirror: epics and stories from the team's trackers, as `stories/<key>.md` in the
// team-brain (R3 of docs/specs/2026-10-25-role-packs-design.md). `lib/sync.js` runs it on a full
// sync, after the asks, and commits both in the one commit a run makes.
//
// The rules, each pinned by a test in test/stories.test.js:
//
// - **Only a tracker the team turned it on for** (`stories: true` on its entry in team.json), and
//   only on a profile that syncs outward. Reading a tracker is a request to it, and the result is
//   published to every member, so it rides the same two switches as the asks.
// - **The destination check comes first.** Every request goes through `request` in
//   trackers/http.js, which asks core/destinations.js before `fetch`: on `work`, a tracker host that
//   is not approved is refused, nothing is fetched, and the run reports `unapproved_destination` for
//   that tracker while the others carry on.
// - **Key, title, status, assignee, epic and link. Never a description** (lib/story-file.js).
// - **Every file passes the publish gate before it is written** (`core/gate.js`): a credential, the
//   employer denylist on `home`, personal data. The key is gated on its own first, so a key that
//   matches the denylist is refused even when the rest of the file is clean, and the refusal names
//   the check, never the key. A refused story is skipped and counted in `withheld`; nothing is
//   sanitised.
// - **An assignee is a person** (ADR 0027). With the personal-data mode at `refuse` (the `work`
//   default), only an assignee who matches a roster member — by handle, or by the `github` login
//   the roster records — is written, as that handle;
//   any other is left out and counted. At `warn` the tracker's name is written and the run returns
//   one warning saying so. At `off` it is written. The full gate still scans the file either way, so
//   an assignee that is an email address is refused or warned about like any other.
// - **Idempotent.** A file is written only when its bytes change, and a story no tracker returns any
//   more is left as it was: the mirror is a floor of the tracker, never a deletion of it.

import { RefusedWriteError, piiSetting } from "../../core/scrub.js";
import { assertPublished } from "../../core/gate.js";
import { stamp } from "../../core/date.js";
import { parseProjectFile } from "../../core/project-file.js";
import { slugify } from "./slug.js";
import { openVault } from "./vault.js";
import { adapterFor } from "./integrations.js";
import { githubRepoOf } from "./trackers/github.js";
import { normaliseStory, renderStory, storyRel } from "./story-file.js";

const errText = (e) => String(e?.message ?? e).split("\n")[0].slice(0, 300);
const DAY_MS = 86_400_000;
/** Closed stories older than this are not fetched. Open ones always are. */
export const DONE_WINDOW_DAYS = 90;

/** The integrations a team turned the story mirror on for. */
export const storyKinds = (config) => config.integrations.filter((i) => i.stories === true).map((i) => i.kind);

/** The GitHub repos a mirror reads: the entry's own, and every project file's on that host. */
function githubRepos(entry, vault) {
  const repos = new Set(entry.repo ? [entry.repo] : []);
  if (vault.isDirectory("projects")) {
    for (const e of vault.entries("projects", { ignore: false })) {
      if (!e.isFile || !e.name.endsWith(".md")) continue;
      const repo = githubRepoOf(parseProjectFile(vault.read(e.rel)).data.repo, entry.host ?? "github.com");
      if (repo) repos.add(repo);
    }
  }
  return [...repos].sort();
}

/**
 * The assignee to write, from the tracker's name, by the personal-data mode. `{ value, withheld }`.
 * `members` is the roster; a match is by handle, case-insensitively, after the slug rule.
 */
export function assigneeFor(name, { mode, members }) {
  if (!name) return { value: null, withheld: false };
  if (mode !== "refuse") return { value: name, withheld: false };
  const want = slugify(name);
  const lower = String(name).toLowerCase();
  // A member's handle, or the GitHub login the roster records for them.
  const hit = members.find((m) => slugify(m.handle) === want || (m.github && String(m.github).toLowerCase() === lower));
  return hit ? { value: hit.handle, withheld: false } : { value: null, withheld: true };
}

/** The refusal code the gate gives `text`, or null when it may be written. */
function refusal(text, gate) {
  try {
    assertPublished(text, gate);
    return null;
  } catch (e) {
    if (e instanceof RefusedWriteError) return e.code ?? "refused";
    throw e;
  }
}

/**
 * Mirror the stories of every tracker the team turned it on for into `clone`. Writes the files and
 * returns what changed; committing is the caller's (`syncClone`).
 *
 * @param {string} clone
 * @param {{ config: object, members: object[], policy: object, env?: object, io: object, today?: string }} opts
 *   `today` is core/date.js's day, the one clock; closed stories are read back 90 days from it.
 *   `io` is the adapters' I/O: `{ env, fetch, timeoutMs, policy }`.
 * @returns {Promise<{ ran: boolean, reason?: string, changed: string[], written: number, unchanged: number,
 *   withheld: { tracker: string, code: string }[], assigneesWithheld: number, skipped: number,
 *   errors: Record<string, string>, warnings: string[] }>}
 */
export async function mirrorStories(clone, { config, members = [], policy, env = {}, io, today = stamp() }) {
  const kinds = storyKinds(config);
  const empty = { changed: [], written: 0, unchanged: 0, withheld: [], assigneesWithheld: 0, skipped: 0, errors: {}, warnings: [] };
  if (!kinds.length) return { ran: false, reason: "no_story_integrations", ...empty };
  if (!policy?.outwardSync) return { ran: false, reason: "outward_sync_disabled", ...empty };

  const vault = openVault(clone);
  const gate = { policy, env };
  const { mode } = piiSetting({ env, policy });
  const res = { ran: true, ...empty, errors: {}, withheld: [], changed: [], warnings: [] };
  const seen = new Set();
  let namedAssignees = 0;
  // Noon, so the local day `stamp` reads is the same day in every time zone.
  const closedSince = stamp(new Date(Date.parse(`${today}T12:00:00Z`) - DONE_WINDOW_DAYS * DAY_MS));

  for (const entry of config.integrations.filter((i) => kinds.includes(i.kind))) {
    let list;
    try {
      const api = adapterFor(entry, io);
      list = await api.stories({ repos: entry.kind === "github" ? githubRepos(entry, vault) : [], closedSince, days: DONE_WINDOW_DAYS });
    } catch (e) {
      res.errors[entry.kind] = e?.code === "unapproved_destination" ? `unapproved_destination: ${errText(e)}` : errText(e);
      continue;
    }
    for (const raw of list) {
      const story = normaliseStory(raw, entry.kind);
      if (!story) { res.skipped++; continue; }
      if (seen.has(story.key)) continue; // the first tracker to name a key keeps it
      seen.add(story.key);
      // The key alone first: a key the denylist names is refused even when nothing else is.
      const keyRefused = refusal(story.key, gate);
      if (keyRefused) { res.withheld.push({ tracker: entry.kind, code: keyRefused, field: "key" }); continue; }
      const a = assigneeFor(story.assignee, { mode, members });
      story.assignee = a.value;
      if (a.withheld) res.assigneesWithheld++;
      const text = renderStory(story);
      const refused = refusal(text, gate);
      if (refused) { res.withheld.push({ tracker: entry.kind, code: refused, field: "story" }); continue; }
      if (story.assignee && mode === "warn") namedAssignees++;
      const rel = storyRel(story.key);
      const before = vault.isFile(rel) ? vault.read(rel).replace(/\r\n/g, "\n") : null;
      if (before === text) { res.unchanged++; continue; }
      vault.write(rel, text);
      res.changed.push(rel);
      res.written++;
    }
  }
  if (namedAssignees) {
    res.warnings.push(
      `personal data: ${namedAssignees} mirrored stor${namedAssignees === 1 ? "y names its" : "ies name their"} assignee, ` +
        "as the tracker shows them. Once pushed that is in every clone of the team-brain (Cortex's docs/erasure.md). " +
        "CORTEX_PII=refuse writes only assignees who are roster members, by handle.",
    );
  }
  res.changed.sort();
  return res;
}
