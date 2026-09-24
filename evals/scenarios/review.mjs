// /cortex-review — the drift axis: which lines did this change make WRONG?
//
// Every scenario is one or two real kinds of drift (a moved file, a changed count, a renamed flag, a
// changed default, a renamed function) plus the evidence `cortex-review.mjs` prints: the governing
// documents and every line that NAMES something the change touched. Each mention is constructed as
// either stale (a present-tense claim the change made false) or still true — a CHANGELOG entry or an
// ADR recording history, a line naming the thing but stating a fact that did not change. Some
// scenarios have no stale line at all: the skill says a review that manufactures a finding costs
// more than one that returns clean, and that is checked too.

import { rng, pick, int, shuffle, sample, word, readAnswer, listOf, setF1, sameSet } from "../lib.mjs";

const DOCS = ["AGENTS.md", "index/AGENTS.md", "mcp/AGENTS.md", "README.md", "CONTEXT.md", "docs/changing-cortex.md"];

// Each kind returns the diff summary and the mention lines. `stale: true` marks a line the change
// made false. Present-tense pointers go stale; history and unchanged facts do not.
const KINDS = {
  move(r) {
    const name = `${word(r)}.js`;
    const from = `${pick(r, ["mcp/lib", "index/lib", "tools/lib"])}/${name}`;
    const to = `core/${name}`;
    return {
      diff: [`rename ${from} => ${to} (100%)`, `M  ${pick(r, ["mcp/server.js", "index/cortex-index.mjs"])} (import path updated)`],
      mentions: [
        { text: `The ${name.replace(".js", "")} gate lives in \`${from}\`; read it before changing a writer.`, stale: true },
        { text: `\`${from}\` is the only place allowed to decide this — do not reimplement it.`, stale: true },
        { text: `- Moved \`${from}\` to \`${to}\` so both leaves can share it.`, stale: false, where: "CHANGELOG.md" },
        { text: `We considered keeping \`${from}\` in place; it was moved to \`core/\` because two leaves need it.`, stale: false, where: "docs/adr/0009-shared-code-goes-in-core.md" },
        { text: `\`${to}\` refuses any write that carries a credential.`, stale: false },
      ],
    };
  },
  count(r) {
    const thing = pick(r, ["coverage", "orphan detection", "the staleness check", "ranking"]);
    const [was, now] = pick(r, [["two", "three"], ["three", "four"], ["two", "four"]]);
    return {
      diff: [`M  index/lib/${pick(r, ["coverage", "findings", "rank"])}.mjs  (+${int(r, 12, 40)} -${int(r, 2, 9)}: adds a ${now === "four" && was === "two" ? "third and a fourth" : "further"} signal)`],
      mentions: [
        { text: `${thing[0].toUpperCase() + thing.slice(1)} uses ${was} signals, combined with OR.`, stale: true },
        { text: `The ${was} signals ${thing} reads are cheap and deterministic.`, stale: true },
        { text: `${thing[0].toUpperCase() + thing.slice(1)} started with ${was} signals; we chose OR over a weighted score.`, stale: false, where: "docs/adr/0003-coverage-is-a-floor.md" },
        { text: `Every number ${thing} prints is a floor, never a total.`, stale: false },
      ],
    };
  },
  flag(r) {
    const tool = pick(r, ["cortex-findings.mjs", "cortex-index.mjs", "cortex-view.mjs"]);
    const [was, now] = pick(r, [["--offers", "--worklist"], ["--out", "--output"], ["--since", "--from"], ["--json", "--format=json"]]);
    return {
      diff: [`M  index/${tool}  (flag ${was} renamed to ${now}; the old spelling now exits 2 with "unknown flag")`],
      mentions: [
        { text: `Read the worklist with \`node index/${tool} ${was}\`, which writes nothing.`, stale: true },
        { text: `\`${tool}\` is read-only unless you pass \`--write\`.`, stale: false },
        { text: `- \`${tool} ${was}\` added, so the wizard's script can be read without running it.`, stale: false, where: "CHANGELOG.md" },
      ],
    };
  },
  default(r) {
    const knob = pick(r, ["exec_timeout", "max_sessions", "lookback", "batch size"]);
    const [was, now] = pick(r, [["120", "300"], ["20", "50"], ["7", "14"]]);
    return {
      diff: [`M  mcp/lib/config.js  (default ${knob}: ${was} -> ${now})`],
      mentions: [
        { text: `The ${knob} defaults to ${was}; raise it for large repos.`, stale: true },
        { text: `Set ${knob} in the config file; the environment variable wins over it.`, stale: false },
      ],
    };
  },
  rename(r) {
    const [was, now] = pick(r, [["readState", "loadState"], ["nextSteps", "planSteps"], ["resolveRoot", "findRoot"], ["openBrain", "openVault"]]);
    return {
      diff: [`M  index/lib/next.mjs  (export ${was} renamed to ${now}; all 4 callers updated)`],
      mentions: [
        { text: `Callers read the fact from \`${was}()\` instead of re-deriving it.`, stale: true },
        { text: `\`${was}\` was renamed to \`${now}\` in 2.39 — the old name no longer exists.`, stale: false },
        { text: `The sequence is deterministic: same tree, same answer, tomorrow included.`, stale: false },
      ],
    };
  },
  clean(r) {
    // A change whose mentions are all still true: the correct review reports nothing stale.
    const f = `${pick(r, ["index/lib", "mcp/lib"])}/${word(r)}.mjs`;
    return {
      diff: [`M  ${f}  (+${int(r, 3, 15)} -${int(r, 1, 6)}: an internal loop rewritten; exports and behaviour unchanged)`],
      mentions: [
        { text: `\`${f}\` never reads the clock; the caller supplies today.`, stale: false },
        { text: `Anything under \`${f.split("/").slice(0, 2).join("/")}/\` stays deterministic — same tree, same output.`, stale: false },
      ],
    };
  },
};

export function generate(seed) {
  const r = rng(seed);
  const names = r() < 0.2 ? ["clean"] : sample(r, Object.keys(KINDS).filter((k) => k !== "clean"), r() < 0.45 ? 2 : 1);
  const diff = [], mentions = [];
  for (const k of names) {
    const part = KINDS[k](r);
    diff.push(...part.diff);
    for (const m of part.mentions) mentions.push({ ...m, file: m.where || pick(r, DOCS) });
  }
  // Give every mention a unique file:line, as the evidence pass would.
  const lines = new Set();
  for (const m of shuffle(r, mentions)) {
    let l;
    do l = int(r, 8, 240); while (lines.has(`${m.file}:${l}`));
    lines.add(`${m.file}:${l}`);
    m.line = l;
  }
  return { diff, mentions: shuffle(r, mentions), governing: sample(r, ["index/AGENTS.md", "mcp/AGENTS.md", "AGENTS.md"], 2) };
}

export function render(s) {
  const byFile = new Map();
  for (const m of s.mentions) (byFile.get(m.file) || byFile.set(m.file, []).get(m.file)).push(m);
  const named = [];
  for (const [file, ms] of byFile) {
    named.push(`  ${file}  (${ms.length} mention${ms.length > 1 ? "s" : ""})`);
    for (const m of ms.sort((a, b) => a.line - b.line)) named.push(`      :${m.line}  ${m.text}`);
  }
  return [
    "The user says: \"review this before I commit it\"",
    "",
    "You cannot run commands or open files. This is everything the evidence pass returned.",
    "",
    "$ git diff --staged --summary",
    ...s.diff.map((d) => `  ${d}`),
    "",
    "$ node index/cortex-review.mjs --staged",
    "Documents governing this change, nearest scope first:",
    ...s.governing.map((g) => `  ${g}`),
    "",
    "Documents that NAME something this change touched — re-read these:",
    "",
    ...named,
    "",
    "A mention is not a defect — it is where one would hide.",
    "",
    "Review the drift axis: which of those lines did this change make wrong? Write your review,",
    "then end your reply with exactly this line, listing each stale line as path:line:",
    "STALE: <path:line>, <path:line>   (or: STALE: none)",
  ].join("\n");
}

export function truth(s) {
  return { stale: s.mentions.filter((m) => m.stale).map((m) => `${m.file}:${m.line}`) };
}

export function score(prediction, t) {
  const a = readAnswer(prediction, ["STALE"]);
  const got = listOf(a.STALE);
  if (got === null) return { hard: 0, soft: 0, reason: "no STALE line" };
  const norm = got.map((x) => x.replace(/^\.\//, "").replace(/\s+/g, ""));
  const f1 = setF1(norm, t.stale);
  const ok = sameSet(norm, t.stale);
  const extra = norm.filter((x) => !t.stale.includes(x));
  const missed = t.stale.filter((x) => !norm.includes(x));
  const reasons = [];
  if (extra.length) reasons.push(`flagged lines that are still true (history, or an unchanged fact): ${extra.join(", ")}`);
  if (missed.length) reasons.push(`missed stale lines: ${missed.join(", ")}`);
  return { hard: ok ? 1 : 0, soft: f1, reason: reasons.join("; ") || "correct" };
}
