// /cortex-review — the drift axis: which lines did this change make WRONG?
//
// Every scenario is one or two real kinds of drift (a moved file, a changed count, a renamed flag, a
// changed default, a renamed function) plus the evidence `cortex-review.mjs` prints: the governing
// documents and every line that NAMES something the change touched. Each mention is constructed as
// either stale (a present-tense claim the change made false) or not stale. Some scenarios have no
// stale line at all: the skill says a review that manufactures a finding costs more than one that
// returns clean, and that is checked too.
//
// The first version of these tasks scored 0.986 soft with no skill at all (#472): every trap in it
// was one a careful generic reviewer avoids unprompted. The traps added since are the skill's own
// rules, where a generic reviewer's instinct points the other way:
//   - An ADR is a historical record BY DEFINITION, even when its decision is written in the present
//     tense and names the old path, flag or value. `index/lib/review.mjs` classes every ADR line
//     `historical` for the same reason. Superseding it is a new ADR, never an edit.
//   - A CHANGELOG entry is history even in the present tense ("`--offers` prints the worklist").
//   - A line whose truth depends on hunks the summary does not show (is the new signal combined the
//     same way? does the rewritten loop iterate in the same order?) is UNVERIFIED, not stale. The
//     skill says never to put it in the stale list on suspicion.
//   - A claim can go stale without repeating the literal: "both signals" is a count, "the last week"
//     is a default of 7 days, and "`core/` holds four modules" is wrong once a fifth moves in.

import { rng, pick, int, shuffle, sample, word, readAnswer, listOf, setF1, sameSet } from "../lib.mjs";

const DOCS = ["AGENTS.md", "index/AGENTS.md", "mcp/AGENTS.md", "README.md", "CONTEXT.md", "docs/changing-cortex.md"];
const cap = (s) => s[0].toUpperCase() + s.slice(1);

// Each kind returns the diff summary and the mention lines. `stale: true` marks a line the change
// made false. `where` pins a line to a history file (CHANGELOG, an ADR); the rest land in a
// present-tense document at random.
const KINDS = {
  move(r) {
    const name = `${word(r)}.js`;
    const from = `${pick(r, ["mcp/lib", "index/lib", "tools/lib"])}/${name}`;
    const to = `core/${name}`;
    const gate = name.replace(".js", "");
    return {
      diff: [`rename ${from} => ${to} (100%)`, `M  ${pick(r, ["mcp/server.js", "index/cortex-index.mjs"])} (import path updated)`],
      mentions: [
        { text: `The ${gate} gate lives in \`${from}\`; read it before changing a writer.`, stale: true },
        { text: `\`${from}\` is the only place allowed to decide this — do not reimplement it.`, stale: true },
        ...(r() < 0.6 ? [{ text: `\`core/\` holds four modules — paths, scrub, memory and date — and depends on nothing else in the repo.`, stale: true }] : []),
        { text: `- Moved \`${from}\` to \`${to}\` so both leaves can share it.`, stale: false, where: "CHANGELOG.md" },
        { text: `We considered keeping \`${from}\` in place; it was moved to \`core/\` because two leaves need it.`, stale: false, where: "docs/adr/0009-shared-code-goes-in-core.md" },
        ...(r() < 0.7 ? [{ text: `Decision: \`${from}\` is the single ${gate} gate, and every writer calls it.`, stale: false, where: "docs/adr/0020-one-gate-per-writer.md" }] : []),
        { text: `\`${to}\` refuses any write that carries a credential.`, stale: false },
      ],
    };
  },
  count(r) {
    const thing = pick(r, ["coverage", "orphan detection", "the staleness check", "ranking"]);
    const [was, now] = pick(r, [["two", "three"], ["two", "three"], ["three", "four"], ["two", "four"]]);
    return {
      diff: [`M  index/lib/${pick(r, ["coverage", "findings", "rank"])}.mjs  (+${int(r, 12, 40)} -${int(r, 2, 9)}: adds a ${now === "four" && was === "two" ? "third and a fourth" : "further"} signal)`],
      mentions: [
        { text: `${cap(thing)} uses ${was} signals, combined with OR.`, stale: true },
        was === "two"
          ? { text: `${cap(thing)} reads both of its signals in a single pass over the index.`, stale: true }
          : { text: `The ${was} signals ${thing} reads are cheap and deterministic.`, stale: true },
        // Depends on how the new signal is wired in — a hunk the summary does not show.
        { text: `Every signal ${thing} reads is combined with OR, never weighted.`, stale: false },
        { text: `${cap(thing)} started with ${was} signals; we chose OR over a weighted score.`, stale: false, where: "docs/adr/0003-coverage-is-a-floor.md" },
        ...(r() < 0.7 ? [{ text: `${cap(thing)} uses exactly ${was} signals; a third would need a new ADR.`.replace("a third", was === "two" ? "a third" : "another"), stale: false, where: "docs/adr/0011-signals-are-cheap.md" }] : []),
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
        ...(r() < 0.7 ? [{ text: `- \`${tool} ${was}\` prints the worklist and writes nothing.`, stale: false, where: "CHANGELOG.md" }] : []),
        ...(r() < 0.6 ? [{ text: `The wizard's script is read with \`${tool} ${was}\`, never by running the wizard.`, stale: false, where: "docs/adr/0006-the-report-is-the-wizards-script.md" }] : []),
      ],
    };
  },
  default(r) {
    const [knob, was, now, derived] = pick(r, [
      ["exec_timeout", "120", "300", `\`exec_timeout\` gives each call two minutes before it is killed.`],
      ["lookback", "7", "14", `\`lookback\` covers the last week unless you raise it.`],
      ["max_sessions", "20", "50", null],
      ["batch_size", "20", "50", null],
    ]);
    return {
      diff: [`M  mcp/lib/config.js  (default ${knob}: ${was} -> ${now})`],
      mentions: [
        { text: `The \`${knob}\` defaults to ${was}; raise it for large repos.`, stale: true },
        ...(derived ? [{ text: derived, stale: true }] : []),
        { text: `Set \`${knob}\` in the config file; the environment variable wins over it.`, stale: false },
        ...(r() < 0.7 ? [{ text: `\`${knob}\` defaults to ${was}, which is enough for a cold cache on a laptop.`, stale: false, where: "docs/adr/0012-defaults-favour-a-laptop.md" }] : []),
        ...(r() < 0.5 ? [{ text: `- \`${knob}\` defaults to ${was}.`, stale: false, where: "CHANGELOG.md" }] : []),
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
        ...(r() < 0.7 ? [{ text: `Every caller goes through \`${was}()\`; nothing re-derives the sequence.`, stale: false, where: "docs/adr/0019-one-reader-for-the-sequence.md" }] : []),
        { text: `The sequence is deterministic: same tree, same answer, tomorrow included.`, stale: false },
      ],
    };
  },
  clean(r) {
    // A change whose mentions are all still true, or at worst unverified: the correct review reports
    // nothing stale, and says which lines it took on the summary's word.
    const f = `${pick(r, ["index/lib", "mcp/lib"])}/${word(r)}.mjs`;
    return {
      diff: [`M  ${f}  (+${int(r, 3, 15)} -${int(r, 1, 6)}: an internal loop rewritten; exports and behaviour unchanged)`],
      mentions: [
        { text: `\`${f}\` never reads the clock; the caller supplies today.`, stale: false },
        { text: `Anything under \`${f.split("/").slice(0, 2).join("/")}/\` stays deterministic — same tree, same output.`, stale: false },
        { text: `\`${f}\` walks its input in sorted order, so two runs print byte-identical output.`, stale: false },
        ...(r() < 0.6 ? [{ text: `\`${f}\` reads each file once and holds nothing in memory between calls.`, stale: false }] : []),
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
  if (extra.length) reasons.push(`flagged lines that are not stale (history, an unchanged fact, or unverified): ${extra.join(", ")}`);
  if (missed.length) reasons.push(`missed stale lines: ${missed.join(", ")}`);
  return { hard: ok ? 1 : 0, soft: f1, reason: reasons.join("; ") || "correct" };
}
