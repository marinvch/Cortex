// A mirrored story: `stories/<name>.md` in a team-brain, one per epic or story (R3 of the role-packs
// design). This module owns the format; lib/stories.js writes it and lib/graph-stories.js reads it.
//
//   ---
//   type: story
//   key: ABC-12
//   kind: story
//   title: Sign in with a single sign-on provider
//   status: active
//   state: In Progress
//   epic: ABC-1
//   assignee: dev-fe
//   tracker: jira
//   url: https://tracker.example/browse/ABC-12
//   ---
//
// The rules:
//
// - **The fields are these and no others.** A description can hold anything — a customer's name,
//   a pasted log, a credential — so none is copied; the body says to follow the link. Adding a
//   field means changing this list, and the test that pins the exact set.
// - **Every value is one line, at most `VALUE_MAX` characters.** A tracker's title is untrusted
//   text: a newline in it would start a new frontmatter key.
// - **`status` is one of three words** (`open`, `active`, `done`), the same for every tracker, so a
//   reader can ask "is it open" without knowing which tracker it came from. `state` is the tracker's
//   own word.
// - **The bytes are a function of the fields.** No sync date and no tracker update time, so a run
//   that learns nothing writes nothing and commits nothing.

import { isStoryKey, storyFileName } from "../../core/story-key.js";
import { openVault } from "./vault.js";

export const STORIES_DIR = "stories";
export const STATUSES = Object.freeze(["open", "active", "done"]);
export const KINDS = Object.freeze(["epic", "story"]);
/** The frontmatter keys, in the order they are written. `type` is always `story`. */
export const FIELDS = Object.freeze(["type", "key", "kind", "title", "status", "state", "epic", "assignee", "tracker", "url"]);
export const VALUE_MAX = 200;

const oneLine = (v) => String(v ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, VALUE_MAX);

/** The repo-relative path a key's mirror is written to. */
export const storyRel = (key) => `${STORIES_DIR}/${storyFileName(key)}.md`;

/**
 * A URL a story may link to, or null: http(s), with no user or password in it. A tracker answers
 * with its own links, and one carrying credentials must not be committed.
 */
export function storyUrl(raw) {
  if (!raw) return null;
  let u;
  try {
    u = new URL(String(raw));
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  if (u.username || u.password) return null;
  return oneLine(u.href);
}

/**
 * A story as the tracker adapters return it, made safe to write, or null when it cannot be one: a
 * key in none of the three shapes, or an epic reference that is not a key (then it is dropped).
 */
export function normaliseStory(s, tracker) {
  const key = oneLine(s?.key);
  if (!isStoryKey(key)) return null;
  const epic = s.epic && isStoryKey(oneLine(s.epic)) && oneLine(s.epic) !== key ? oneLine(s.epic) : null;
  return {
    type: "story",
    key,
    kind: KINDS.includes(s.kind) ? s.kind : "story",
    title: oneLine(s.title) || "(no title)",
    status: STATUSES.includes(s.status) ? s.status : "open",
    state: oneLine(s.state) || null,
    epic,
    assignee: s.assignee ? oneLine(s.assignee) : null,
    tracker: oneLine(tracker),
    url: storyUrl(s.url),
  };
}

/** The file's text. A null field is left out. */
export function renderStory(story) {
  const lines = ["---"];
  for (const k of FIELDS) {
    const v = story[k];
    if (v === null || v === undefined || v === "") continue;
    lines.push(`${k}: ${oneLine(v)}`);
  }
  lines.push(
    "---",
    `# ${story.key} · ${oneLine(story.title)}`,
    "",
    `Mirrored from ${story.tracker} by \`ai-os sync\`. The description is not copied: follow the link for it.`,
    "",
  );
  return lines.join("\n");
}

/** The fields of a story file, or null when it is not one. Unknown keys are ignored, never kept. */
export function parseStory(text) {
  const src = String(text ?? "").replace(/\r\n/g, "\n");
  if (!src.startsWith("---\n")) return null;
  const end = src.indexOf("\n---", 4);
  if (end === -1) return null;
  const out = {};
  for (const line of src.slice(4, end).split("\n")) {
    const m = line.match(/^([a-z]+):\s?(.*)$/);
    if (m && FIELDS.includes(m[1])) out[m[1]] = m[2].trim();
  }
  if (out.type !== "story" || !isStoryKey(out.key)) return null;
  for (const k of FIELDS) if (!(k in out)) out[k] = null;
  if (!STATUSES.includes(out.status)) out.status = "open";
  if (!KINDS.includes(out.kind)) out.kind = "story";
  return out;
}

/** Every story mirrored in a clone, by key. A file that does not parse is counted, not thrown. */
export function readStories(clone) {
  const vault = openVault(clone);
  const stories = new Map();
  let unreadable = 0;
  if (!vault.isDirectory(STORIES_DIR)) return { stories, unreadable };
  for (const e of vault.entries(STORIES_DIR, { ignore: false })) {
    if (e.isDirectory || !e.name.endsWith(".md")) continue;
    const s = parseStory(vault.read(e.rel));
    if (s) stories.set(s.key, s);
    else unreadable++;
  }
  return { stories, unreadable };
}
