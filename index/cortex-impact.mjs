#!/usr/bin/env node
// cortex-impact.mjs — what breaks if this changes, and which of it nothing tests.
//
//   node index/cortex-impact.mjs src/lib/db.ts        # named files
//   node index/cortex-impact.mjs --staged             # what you are about to commit
//   node index/cortex-impact.mjs --since HEAD~3       # what changed over a range
//   node index/cortex-impact.mjs --staged --json      # for a ritual to walk
//
//   node index/cortex-impact.mjs --staged --against theirs.txt     # vs another session's change list
//   node index/cortex-impact.mjs --staged --against-ref feat/x     # vs another branch's commits
//   git -C ../other diff --name-only HEAD | node index/cortex-impact.mjs --staged --against -
//
//   node index/cortex-impact.mjs src/a.ts src/b.ts --size          # single or team, and why
//   node index/cortex-impact.mjs --staged --size --json             # for a ritual to walk
//
// Read-only in the strongest sense: it writes nothing, not even under .cortex/.
//
// Every count is a FLOOR. Import resolution is regex-based, so dynamic and computed imports are
// missed — the files named will be affected, and others may be. The output says "at least" for that
// reason, and no flag turns it into a total.
//
// `--against` / `--against-ref` switch the question from "what breaks if this changes" to "where
// does my change set collide with theirs" (#408): files both sets touch, and one-hop import edges
// between them. See lib/overlap.mjs. The blast radius is not printed in that mode; run without the
// flag for it.
//
// `--size` answers a third question (spec T2): for a task touching these files, does the evidence
// say one agent or a team? It RECOMMENDS; the developer chooses. The thresholds are provisional and
// live in one constant in lib/sizing.mjs. It refuses --depth and --against: sizing reads the whole
// radius of one change set.
//
// Exit codes, unchanged by --against and --size, and shared with every CLI that opens through lib/open.mjs:
//   0  an answer was printed — including one that found overlap. Findings are data, never a
//      failure code; a hook that wants to block reads `--json` and decides.
//   1  what was asked for is not a thing: an unknown flag, a bad --root, an --against file that
//      does not exist, or --depth combined with --against.
//   2  nothing could be answered: no index, an empty change set on either side, or git could not
//      read one.

import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { impactOf, groupUnknown } from "./lib/impact.mjs";
import { overlapOf, parseChangeList } from "./lib/overlap.mjs";
import { sizeTask } from "./lib/sizing.mjs";
import { UNRESOLVED_LANGUAGES } from "./lib/imports.mjs";
import { openTarget } from "./lib/open.mjs";
import { branchChanges, changedFiles, failureLines } from "./lib/changed.mjs";

// Bare arguments here are FILE PATHS, so the root comes from `--root` — a command that took both
// positionally could not tell one from the other, and the one it guessed wrong is the one that
// decides where it looks.
const { root, args, paths, index } = openTarget(process.argv.slice(2), {
  usage:
    "usage: node index/cortex-impact.mjs [paths...] [--staged] [--since REF] " +
    "[--depth N] [--against FILE|-] [--against-ref REF] [--size] [--root DIR] [--index FILE] [--json]",
  flags: {
    "--staged": "boolean",
    "--json": "boolean",
    "--size": "boolean",
    "--since": "value",
    "--depth": "value",
    "--against": "value",
    "--against-ref": "value",
    "--index": "value",
    "--root": "value",
  },
  root: "flag",
  // No index, no graph — and a blast radius guessed without one is the confident wrong answer this
  // whole command exists to avoid.
  index: "require",
  freshness: (a) => !a.json,
});

const depth = args.depth === null ? Infinity : Number(args.depth);
const comparing = args.against !== null || args.againstRef !== null;

if (args.size && (comparing || args.depth !== null)) {
  // Refused rather than ignored, as --depth is below: sizing reads the full radius of one change
  // set, so a bound would understate it, and a second set has no place in the question.
  console.error("--size reads the whole radius of one change set, so it does not combine with --depth, --against or --against-ref.");
  process.exit(1);
}

if (comparing && args.depth !== null) {
  // Refused rather than ignored: --depth bounds a walk that the comparison never takes, and a flag
  // accepted and silently dropped reads as though it had an effect.
  console.error("--depth bounds the blast radius; --against compares one hop only, so the two do not combine.");
  process.exit(1);
}

// Their change set is read before mine, so a list file that is not there is refused as the typo it
// is — exit 1 — before any git work happens.
let theirs = [];
const theirFailures = [];
if (args.against !== null) {
  let text;
  if (args.against === "-") {
    text = readFileSync(0, "utf8");
  } else {
    const listPath = resolve(args.against);
    if (!existsSync(listPath) || !statSync(listPath).isFile()) {
      console.error(
        `--against: no file at ${listPath}.\n` +
          `It takes a change list, one path per line (or - for stdin). For a branch, use --against-ref <ref>.`,
      );
      process.exit(1);
    }
    text = readFileSync(listPath, "utf8");
  }
  theirs.push(...parseChangeList(text));
}
if (args.againstRef !== null) {
  const b = branchChanges(root, args.againstRef);
  theirs.push(...b.files);
  theirFailures.push(...b.failures);
}

const { files: changed, failures: myFailures } = changedFiles(root, {
  paths,
  staged: args.staged,
  since: args.since,
});
const failures = [...myFailures, ...theirFailures];

// A failure is not an empty diff, and this is the command where confusing the two costs the most:
// every number here is a floor, and a floor computed from a change set git could not read is not a
// floor at all. This copy of the git call had no maxBuffer, so a wide --since on a long-lived repo
// overflowed, threw, and printed "nothing to analyse" — the exact confident zero the command exists
// to avoid. Say it out loud, before anything else reaches the terminal.
for (const line of failureLines(failures)) console.error(line);

if (!changed.length) {
  console.error(
    myFailures.length
      ? "The change set could not be read, so nothing was analysed. This is git failing, not a repository with no changes."
      : "nothing to analyse. Pass file paths, or --staged, or --since <ref>.",
  );
  process.exit(2);
}

if (comparing) {
  if (!theirs.length) {
    // An empty "theirs" and a clean "no overlap" must not share a sentence. The first is usually a
    // list written to the wrong place or a ref that has not diverged; reporting it as "no
    // collisions" would be the confident zero this command exists to avoid.
    console.error(
      theirFailures.length
        ? "The other change set could not be read, so nothing was compared. This is git failing, not a session with no changes."
        : "The --against change set is empty, so there is nothing to compare against.\n" +
            "That is not the same as \"no overlap\": check the list is the one the other session wrote, " +
            "or that the ref has commits HEAD does not.",
    );
    process.exit(2);
  }
  reportOverlap(overlapOf(index, changed, theirs, { root }));
  process.exit(0);
}

if (args.size) {
  reportSize(sizeTask(index, changed, { root }));
  process.exit(0);
}

const r = impactOf(index, changed, { root, maxDepth: depth });

if (args.json) {
  console.log(JSON.stringify(r, null, 2));
  process.exit(0);
}

console.log(`\nChanged (${r.changed.length}):`);
// A wide `--since` range can name hundreds of files. The blast radius is the answer; the change set
// is context, and letting it push the answer off the top of the terminal loses the point of running.
for (const c of r.changed.slice(0, 12)) console.log(`  ${c}`);
if (r.changed.length > 12) console.log(`  ... and ${r.changed.length - 12} more`);

if (r.unknown.length) {
  // Reported, never dropped. A path the index does not know contributes nothing to the walk, and
  // silently ignoring it reads as "nothing depends on this" — the most dangerous wrong answer here.
  //
  // But "never dropped" is not the same as "printed one per line". On a repo with a DeepZoom tile
  // set this section returned 2,483 entries, 2,478 of them tile PNGs, and the two staged source
  // deletions a reader genuinely had to resolve were buried under it — the terminal never even
  // reached the affected / unverified / suggested-tests sections. A section nobody can read has the
  // same effect as one that was dropped, while looking like diligence.
  //
  // So: assets are counted by directory and extension, source is still listed one per line. The
  // total is unchanged and every path stays reachable with --json.
  const groups = groupUnknown(r.unknown);
  console.log(`\nNot in the index (${r.unknown.length}) — new, ignored, or a typo:`);
  for (const u of groups.source.slice(0, 40)) console.log(`  ${u}`);
  if (groups.source.length > 40) console.log(`  ... and ${groups.source.length - 40} more source paths (--json for all)`);
  for (const a of groups.assets) {
    console.log(`  ${a.count} ${a.ext} under ${a.dir}/ — assets, never indexed`);
  }
  if (!groups.source.length && groups.assets.length) {
    console.log(`  (nothing here is source; assets are expected to be absent from the index)`);
  }
}

if (!r.affected.length) {
  // "Nothing imports this" and "I cannot read this language" are different answers, and only one
  // of them is about the repo. Pointed at a Go repo before its resolver existed, this printed the
  // first for a file the whole framework depends on.
  const byPath = new Map(index.files.map((f) => [f.path, f]));
  const blind = [...new Set(r.changed.map((c) => byPath.get(c)?.lang).filter((l) => UNRESOLVED_LANGUAGES.has(l)))];
  if (blind.length) {
    console.log(`\nCortex cannot resolve ${blind.join(", ")} imports, so it has no graph for these files.`);
    console.log(`This is not "nothing depends on them" — it is "Cortex did not look". Find the`);
    console.log(`dependents another way before treating this as a safe change.`);
    process.exit(0);
  }
  console.log(`\nNothing in the index imports these.`);
  console.log(`That is a floor, not a proof: imports are resolved by convention, so a dynamically`);
  console.log(`loaded or framework-discovered dependent would not appear here.`);
  process.exit(0);
}

console.log(`\nAt least ${r.atLeast} file${r.atLeast === 1 ? "" : "s"} affected, nearest first:\n`);
for (const a of r.affected) {
  const mark = a.isTest ? "test" : a.covered ? "  ok" : "  ??";
  console.log(`  ${mark}  d${a.depth}  ${a.path}${a.commits ? `   (${a.commits} commits)` : ""}`);
}

if (r.unverified.length) {
  console.log(`\n${r.unverified.length} of those ${r.unverified.length === 1 ? "is" : "are"} exercised by no test Cortex can see:`);
  for (const u of r.unverified) console.log(`  ${u.path}`);
  console.log(`\nThis is where a regression lands. A large blast radius that is covered is an ordinary`);
  console.log(`change; a small one that is not is the one to look at.`);
}

if (r.suggestedTests.length) {
  console.log(`\nTests worth running (${r.suggestedTests.length}):`);
  for (const t of r.suggestedTests) console.log(`  ${t}`);
}

if (r.truncated) {
  // Said out loud: a bounded walk and an exhausted one print the same shape, so a reader who forgot
  // the flag would take the smaller number for the whole radius.
  console.log(`\nStopped at depth ${depth}. Anything further out was not walked.`);
}

console.log(`\nA floor, not a total — imports are resolved by convention, so treat this as the`);
console.log(`smallest honest answer rather than the complete one.`);
if (failures.length) {
  // The floor is only a floor over the change set it was given. Repeating it here is deliberate:
  // the reader who acts on this number is at the BOTTOM of the output, and a warning printed before
  // sixty lines of radius has already scrolled off the top of the terminal.
  console.log(`\nAnd this radius was computed from an incomplete change set — see the git error above.`);
}

// --- --against: where two change sets collide (#408) ------------------------------------------------

function reportOverlap(o) {
  if (args.json) {
    console.log(JSON.stringify(o, null, 2));
    return;
  }
  const list = (label, paths, cap) => {
    console.log(`\n${label} (${paths.length}):`);
    for (const p of paths.slice(0, cap)) console.log(`  ${p}`);
    if (paths.length > cap) console.log(`  ... and ${paths.length - cap} more (--json for all)`);
  };
  // Context first and short: the answer is the overlap and the collisions, and a wide change set
  // must not push them off the top of the terminal.
  list("Mine", o.mine, 12);
  list("Theirs", o.theirs, 12);

  if (o.unknown.mine.length || o.unknown.theirs.length) {
    // Reported, never dropped: these still count for direct overlap (two sessions creating the same
    // new file is a real collision), but the index has no edges for them.
    console.log(`\nNot in the index — new, ignored, or a typo. They can still overlap directly, but carry no import edges:`);
    for (const p of o.unknown.mine.slice(0, 40)) console.log(`  mine    ${p}`);
    for (const p of o.unknown.theirs.slice(0, 40)) console.log(`  theirs  ${p}`);
    const hidden = Math.max(0, o.unknown.mine.length - 40) + Math.max(0, o.unknown.theirs.length - 40);
    if (hidden) console.log(`  ... and ${hidden} more (--json for all)`);
  }

  if (o.overlap.length) {
    console.log(`\nAt least ${o.overlap.length} file${o.overlap.length === 1 ? " is" : "s are"} in both change sets — decide who edits ${o.overlap.length === 1 ? "it" : "them"} before either of you goes on:`);
    for (const p of o.overlap) console.log(`  ${p}`);
  }

  if (o.collisions.length) {
    console.log(`\nAt least ${o.collisions.length} one-hop dependency collision${o.collisions.length === 1 ? "" : "s"} — one side imports a file the other is changing:`);
    for (const c of o.collisions) {
      console.log(
        c.edge === "mine-imports-theirs"
          ? `  ${c.mine} (mine) imports ${c.theirs} (theirs)`
          : `  ${c.theirs} (theirs) imports ${c.mine} (mine)`,
      );
    }
  }

  if (!o.overlap.length && !o.collisions.length) {
    const byPath = new Map(index.files.map((f) => [f.path, f]));
    const blind = [...new Set([...o.mine, ...o.theirs].map((p) => byPath.get(p)?.lang).filter((l) => UNRESOLVED_LANGUAGES.has(l)))];
    console.log(`\nNo file is in both change sets, and no import edge joins them.`);
    if (blind.length) {
      console.log(`Cortex cannot resolve ${blind.join(", ")} imports, so for those files this is "Cortex did not look",`);
      console.log(`not "they are independent".`);
    }
    console.log(`That is a floor, not a proof: a dynamic import or a framework-discovered file coupling the`);
    console.log(`two would not appear here, and only one hop is read — run without --against for either side's`);
    console.log(`full radius.`);
  } else {
    console.log(`\nA floor, not a total — imports are resolved by convention and only one hop is read, so the`);
    console.log(`two change sets may be coupled in ways not listed here.`);
  }
  if (failures.length) {
    console.log(`\nAnd this was computed from an incomplete change set — see the git error above.`);
  }
}

// --- --size: single or team (spec T2) -----------------------------------------------------------------

function reportSize(z) {
  if (args.json) {
    console.log(JSON.stringify(z, null, 2));
    return;
  }
  console.log(`\nChanged (${changed.length}):`);
  for (const c of changed.slice(0, 12)) console.log(`  ${c}`);
  if (changed.length > 12) console.log(`  ... and ${changed.length - 12} more`);

  const head = z.recommendation === null ? "none — Cortex has no grounds to size this" : z.recommendation;
  console.log(`\nRecommendation: ${head} (provisional)\n`);
  for (const reason of z.reasons) console.log(`  - ${reason}`);

  // The two sentences a reader must leave with: the lines are a starting point rather than a
  // measurement, and the decision is theirs. A recommendation that reads as a verdict is what
  // spec T2 rules out.
  console.log(`\nThe thresholds are provisional — calibrated on four repositories' history, not measured`);
  console.log(`(SIZING_THRESHOLDS in index/lib/sizing.mjs). Every count is a floor.`);
  console.log(`You choose: this is evidence for the decision, not the decision.`);
  if (failures.length) {
    console.log(`\nAnd this was computed from an incomplete change set — see the git error above.`);
  }
}
