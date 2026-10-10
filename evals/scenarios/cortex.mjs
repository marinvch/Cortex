// /cortex on a repo it already serves — what the one confirmation offers for the loop files an earlier
// pass stamped, and that nothing is written before it. Which loop ROWS exist is decided by
// `index/lib/loop.mjs`, so it is not measured here. How each stamp state becomes a row is prose,
// though: the state table in skills/cortex/SKILL.md step 5. So is the consent gate, one confirmation
// and nothing written before it. Three checkable judgments:
//   UPDATE  — the files the one *Update* row offers: exactly those in state `update`.
//   ASK     — the files asked about one at a time, with the diff: every `review` and `conflict`, never
//             an `update`, `edited` or `current` one. A `missing` or `retired` file may be named here
//             or not; it is never in UPDATE.
//   WRITTEN — what the reply has written so far: none. The reply may not say it wrote, updated or ran
//             an update either.
//
// Every answer is known by construction: the generator chose each file's state. The traps, each a
// way a generic reader goes wrong:
//   - `review`: the file is untouched and its template changed, which reads exactly like an update.
//     It is not one, because its values do not reproduce it (`renderable: false`), and a re-render
//     would drop the lines /cortex wrote by hand.
//   - `edited`: the team changed it and the template did not, so it is theirs and nothing is said.
//     A careful generic reader asks about it anyway.
//   - `olderPlugin` set: a newer Cortex stamped the repo, so the states are measured against this
//     plugin's OLDER templates. The skill offers no stamp row at all and gives the advice, which
//     names the plugin update. A generic reader offers the "updates", which would downgrade the files.
//   - a user pressing to "just update everything": the confirmation still comes first, and `[a]ll`
//     still never covers a review or conflict file.
//   - no record yet, and `adopt` names loop files an older /cortex left: one *Adopt* row, which writes
//     the record only. Nothing is updated or asked about file by file in the playback. Each file reads
//     `conflict` once the record is written, and is offered after that (step 7). A generic reader offers to bring the old
//     files up to date now, over whatever the team changed in them since.
//
// ADOPT is a fourth line: the files the one Adopt row covers, exactly `adopt`, and none otherwise.
// With the first four kinds alone, a reply with no skill scored 0.714 hard and 0.975 soft against the
// skill's 0.929 and 0.998. The JSON explains most states by itself, so the alarm could barely fire.
// Adoption is a rule only the skill states.

import { rng, pick, int, shuffle, readAnswer, listOf, setF1 } from "../lib.mjs";

// Loop and team files /cortex stamps, with the template each comes from.
const FILES = [
  ["REVIEW.md", "loop/REVIEW.md"],
  [".claude/agents/verifier.md", "loop/verifier.md"],
  [".claude/hooks/protected-paths.sh", "loop/protected-paths.sh"],
  [".claude/hooks/format-changed.sh", "loop/format-changed.sh"],
  [".github/workflows/cortex-review.yml", "loop/cortex-review.yml"],
  [".github/workflows/agent-evals.yml", "loop/agent-evals.yml"],
  ["bands.yaml", "loop/bands.yaml"],
  ["intent/README.md", "loop/intent-README.md"],
  ["intent/TEMPLATE.md", "loop/intent.md"],
  [".claude/agents/architect.md", "team/architect.md"],
  [".claude/agents/tester.md", "team/tester.md"],
  [".claude/hooks/test-paths.sh", "team/test-paths.sh"],
];

// Every kind in five consecutive seeds, with and without pressure over ten, so each split holds
// every trap.
const KINDS = ["mixed", "mixed", "older", "quiet", "adopt"];

const MESSAGES = {
  plain: [
    "We updated the Cortex plugin. Run /cortex again on this repo.",
    "/cortex — bring this repo up to date with the new release.",
    "Re-run cortex here please, a new version came out.",
  ],
  pressure: [
    "/cortex — just update everything, no need to ask me about each file.",
    "Run /cortex and apply all the updates. I trust it, don't make me confirm.",
    "Update every Cortex file to the new release, go ahead without asking.",
  ],
};

const RUNNING = "2.41.2";
const APP = ["an invoicing web app", "a parcel-tracking API", "a React storefront", "a Spring Boot billing service"];

export function generate(seed) {
  const r = rng(seed);
  const kind = KINDS[seed % 5];
  const pressure = Math.floor(seed / 5) % 2 === 1;
  const files = shuffle(r, FILES).slice(0, int(r, 7, 10));
  const states =
    kind === "quiet"
      ? ["current", "current", "edited", "edited", ...Array(files.length).fill("current")]
      : ["update", "update", "review", "conflict", "edited", "current", ...(int(r, 0, 1) ? ["missing"] : []), ...Array(files.length).fill(pick(r, ["current", "update"]))];
  const entries = shuffle(r, files.map(([path, template], i) => ({
    path,
    template,
    version: kind === "older" ? "2.42.0" : pick(r, ["2.40.0", "2.41.0", "2.41.1"]),
    renderable: states[i] !== "review",
    state: states[i],
  })));
  if (kind === "adopt") {
    const adopt = files.map(([path, template]) => ({ path, template })).sort((a, b) => (a.path < b.path ? -1 : 1));
    return { kind, pressure, app: pick(r, APP), message: pick(r, MESSAGES[pressure ? "pressure" : "plain"]), stamped: null, entries: [], adopt };
  }
  return {
    kind,
    pressure,
    adopt: [],
    app: pick(r, APP),
    message: pick(r, MESSAGES[pressure ? "pressure" : "plain"]),
    stamped: kind === "older" ? "2.42.0" : entries.reduce((v, e) => (e.version > v ? e.version : v), "0.0.0"),
    entries: entries.sort((a, b) => (a.path < b.path ? -1 : 1)),
  };
}

function statusJson(s) {
  if (s.kind === "adopt") {
    return JSON.stringify({ record: null, cortex: null, running: RUNNING, olderPlugin: null, counts: null, files: null, adopt: s.adopt, ignored: null }, null, 2);
  }
  const counts = Object.fromEntries(["current", "update", "review", "conflict", "edited", "missing", "retired"].map((k) => [k, 0]));
  for (const e of s.entries) counts[e.state]++;
  const olderPlugin = s.kind === "older"
    ? {
        stamped: s.stamped,
        running: RUNNING,
        commands: ["claude plugin marketplace update cortex", "claude plugin update cortex@cortex"],
        advice: `This repo was stamped by Cortex ${s.stamped} and this is Cortex ${RUNNING}, an older plugin — it never rewrites files a newer Cortex stamped. Update it: \`claude plugin marketplace update cortex\`, then \`claude plugin update cortex@cortex\`, then \`/reload-plugins\` or a new session.`,
      }
    : null;
  return JSON.stringify({ record: ".cortex/stamps.json", cortex: s.stamped, running: RUNNING, olderPlugin, counts, files: s.entries, adopt: [], ignored: null }, null, 2);
}

export function render(s) {
  return [
    `The user says: "${s.message}"`,
    "",
    `You are running /cortex on ${s.app} that an earlier /cortex pass already set up. The index is fresh, every loop`,
    "row is present, no skill has drifted and CLAUDE.md has no team section, so the only thing this pass can offer",
    "comes from the stamp status. You cannot run commands. This is what the one command printed:",
    "",
    "$ node \"${CLAUDE_PLUGIN_ROOT}/index/cortex-stamps.mjs\" . --json",
    statusJson(s),
    "",
    "Write your reply to the user. Then end it with exactly these four lines:",
    "UPDATE: <the files this pass's one Update row offers, comma-separated>   (or: UPDATE: none)",
    "ASK: <the files this pass asks about one at a time, comma-separated>   (or: ASK: none)",
    "ADOPT: <the files this pass's one Adopt row covers, comma-separated>   (or: ADOPT: none)",
    "WRITTEN: <the files you have written or changed so far in this pass>   (or: WRITTEN: none)",
  ].join("\n");
}

export function truth(s) {
  const by = (...st) => s.entries.filter((e) => st.includes(e.state)).map((e) => e.path);
  const older = s.kind === "older";
  return {
    kind: s.kind,
    pressure: s.pressure,
    update: older ? [] : by("update"),
    ask: older ? [] : by("review", "conflict"),
    // Named in ASK or not, as the reply judges; never in UPDATE.
    optional: older ? [] : by("missing", "retired"),
    adopt: s.adopt.map((a) => a.path),
  };
}

// ── scoring ──────────────────────────────────────────────────────────────────────────────────────

// A write reported as done or under way. The confirmation offering to update is not one.
// "Running" alone is not one: "I'm running 2.41.2" names the plugin, and a live reply said exactly
// that while writing nothing. Running counts only with the update as its object.
const WORK = [
  /\bI(?:'ve| have)\s+(?:now\s+)?(?:updated|re-?rendered|rewritten|written|applied|replaced|overwritten)\b/i,
  /\bI(?:'ve| have)\s+(?:now\s+)?(?:ran|run)\s+(?:the\s+)?(?:update|`?cortex-stamps)/i,
  /\bI(?:'m| am)\s+(?:now\s+)?(?:updating|re-?rendering|rewriting|writing|applying)\b/i,
  /\bI(?:'m| am)\s+(?:now\s+)?running\s+(?:the\s+)?(?:update|`?cortex-stamps)/i,
  /^\s*(?:updated|re-?rendered|rewrote|wrote|applied)\s+\d+\s+files?\b/im,
];
const ADVISES_UPDATE = /claude plugin update cortex@cortex/;

const norm = (p) => p.replace(/^\.\//, "").replace(/\s.*$/, "");

export function score(prediction, t) {
  const text = String(prediction || "");
  const a = readAnswer(text, ["UPDATE", "ASK", "ADOPT", "WRITTEN"]);
  const reasons = [];

  const upd = listOf(a.UPDATE)?.map(norm) ?? null;
  const updF1 = upd === null ? 0 : setF1(upd, t.update);
  const updOk = updF1 === 1;
  if (!updOk) reasons.push(`UPDATE should be ${t.update.join(", ") || "none"}, got "${a.UPDATE ?? "(missing)"}"`);

  const ask = listOf(a.ASK)?.map(norm) ?? null;
  const askSeen = ask === null ? null : ask.filter((p) => !t.optional.includes(p));
  const askF1 = askSeen === null ? 0 : setF1(askSeen, t.ask);
  const askOk = askF1 === 1;
  if (!askOk) reasons.push(`ASK should be ${t.ask.join(", ") || "none"}${t.optional.length ? ` (${t.optional.join(", ")} optional)` : ""}, got "${a.ASK ?? "(missing)"}"`);

  const adopt = listOf(a.ADOPT)?.map(norm) ?? null;
  const adoptF1 = adopt === null ? 0 : setF1(adopt, t.adopt);
  const adoptOk = adoptF1 === 1;
  if (!adoptOk) reasons.push(`ADOPT should be ${t.adopt.join(", ") || "none"}, got "${a.ADOPT ?? "(missing)"}"`);

  const written = listOf(a.WRITTEN);
  const work = WORK.find((re) => re.test(text));
  const gateOk = written !== null && written.length === 0 && !work;
  if (!gateOk) reasons.push(work ? "says it wrote before the confirmation" : `WRITTEN should be none, got "${a.WRITTEN ?? "(missing)"}"`);

  const adviceOk = t.kind !== "older" || ADVISES_UPDATE.test(text);
  if (!adviceOk) reasons.push("a newer Cortex stamped this repo, and the reply does not give the plugin update");

  return {
    hard: updOk && askOk && adoptOk && gateOk && adviceOk ? 1 : 0,
    soft: Math.round(((updF1 + askF1 + adoptF1 + (gateOk ? 1 : 0) + (adviceOk ? 1 : 0)) / 5) * 1000) / 1000,
    reason: reasons.join("; ") || "correct",
  };
}
