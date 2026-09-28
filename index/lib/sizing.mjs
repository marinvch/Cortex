// Single or team — a recommendation for one task, from evidence the index already holds.
//
// Spec decision T2 (docs/specs/2026-09-28-agent-team-design.md): for each new task the session
// recommends *single* or *team* from repo evidence, and **the developer chooses**. This module is
// the "recommends" half and nothing more. It never decides and never starts a team, and every
// recommendation carries the sentences that produced it, so the developer can disagree with a
// number rather than with a verdict.
//
// It is a module of its own rather than a function in `impact.mjs` on purpose. `impact.mjs` states
// facts — who depends on these files, as a floor — and every caller trusts them. This holds a
// POLICY: thresholds nobody has measured yet. Keeping the policy out of the reader lets the
// thresholds move (they must, see SIZING_THRESHOLDS) without anyone re-checking the blast radius,
// and keeps the reader from growing a knob only one caller wants. No signal is recomputed here:
// dependents and untested dependents are `impactOf`'s, areas are `layerKeyFor`'s, blindness is
// `UNRESOLVED_LANGUAGES`. A second copy of any of them is the drift index/AGENTS.md keeps recording.
//
// Deterministic, like everything in `index/`: no model, no network, no clock. Same index and files,
// same answer.
//
// ## The honesty constraints
//
// - Every dependent count is `impactOf`'s floor, so it is named `atLeast` here too. A floor over a
//   line is a real crossing; a floor under one is only "no evidence of size".
// - A file in a language Cortex cannot resolve has no graph. Its dependents are not zero, they are
//   unseen, so a task holding one is **blind** — never small — and is not called `single` on the
//   strength of signals that did not look.
// - No index, or no files: `recommendation: null` with the reason. Never a default. A default of
//   `single` is the confident small answer this command family exists to avoid; a default of `team`
//   teaches people to skip the recommendation.

import { impactOf } from "./impact.mjs";
import { layerKeyFor } from "./layers.mjs";
import { UNRESOLVED_LANGUAGES } from "./imports.mjs";
import { categoryOf, detectLanguage, isTestPath } from "./langs.mjs";
import { normalizeChangedPath } from "./changed.mjs";

/**
 * Where a task stops being one agent's job. PROVISIONAL — every value.
 *
 * The spec leaves these open ("Not yet specified: sizing thresholds") and says they need real repos
 * and the eval harness (#407), not a guess. These starting values came from running the
 * recommendation over the last 150 commits of pmndrs/zustand, spring-projects/spring-petclinic,
 * shadcn-ui/taxonomy and this repository, and moving each line until the one-file fixes, dependency
 * bumps and releases in that history read `single` while the cross-area features read `team`. That
 * is a calibration against four histories, not a measurement of outcomes: nobody has yet scored
 * whether a team did better on the tasks it recommends one for. Revisit with that evidence — eval
 * tasks run both ways — before treating any value as settled, and change them HERE: nothing else
 * may carry a copy.
 *
 * A signal crosses at or over its line. Any crossing recommends `team`.
 */
export const SIZING_THRESHOLDS = Object.freeze({
  // Distinct areas (`layerKeyFor`) holding the task's source files. Coarse on purpose and coarse in
  // fact: all of spring-petclinic's Java is one area (`src/main`), so the dependent lines below are
  // what size a cross-package change there.
  areas: 3,
  // The areas line when any of those areas carries a scoped brief — one somebody wrote invariants
  // down for. One briefed area alone is ordinary work in a repo that documents itself: 86% of this
  // repository's recent commits touch one.
  areasWithBrief: 2,
  // Production files importing a changed file directly (a floor): the call sites a changed contract
  // has to be carried to. 10 is where zustand's `vanilla.ts` and petclinic's model classes sit.
  directDependents: 10,
  // Production files depending on the changed ones at any depth (a floor). Well-tested hubs here
  // reach 21 on one-area fixes, and a covered radius is an ordinary change.
  dependents: 25,
  // Of those, the ones no test Cortex can see exercises (a floor). zustand's one-file
  // `getSnapshot` fix reached 5; on a repo with no tests this line and `dependents` are one number.
  untestedDependents: 10,
});

/** `categoryOf` values that are source a task changes, rather than what accompanies the change. */
const SOURCE_CATEGORIES = new Set(["code", "script", "schema", "markup"]);

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const list = (xs, cap = 5) =>
  xs.length > cap ? `${xs.slice(0, cap).join(", ")} and ${xs.length - cap} more` : xs.join(", ");

/**
 * The scoped briefs in an index — `<dir>/AGENTS.md` anywhere but the root — as `{ dir, path }`,
 * deepest first, so the first match for a file is the nearest brief governing it.
 */
export function scopedBriefs(index) {
  return index.files
    .map((f) => f.path)
    .filter((p) => p.endsWith("/AGENTS.md"))
    .map((path) => ({ dir: path.slice(0, -"/AGENTS.md".length), path }))
    .sort((a, b) => b.dir.length - a.dir.length || a.dir.localeCompare(b.dir));
}

/**
 * sizeTask(index, files, { root, thresholds }) → recommendation
 *
 * `files` are the paths the task will touch — the Architect's plan names them, or a change set.
 * `root` is optional and only enables coverage's mention signal (`lib/coverage.mjs`); without it
 * more dependents read as untested, which leans toward `team` — a question, not a regression.
 * `thresholds` exists for tests; callers take the default.
 *
 * Returns `{ recommendation, provisional: true, reasons, signals, thresholds }`. `recommendation`
 * is `"single"`, `"team"` or `null`; `reasons` holds one sentence per signal, crossings first, each
 * carrying its number.
 */
export function sizeTask(index, files, { root = null, thresholds = SIZING_THRESHOLDS } = {}) {
  const base = { provisional: true, thresholds };
  if (!index || !Array.isArray(index.files) || !Array.isArray(index.edges)) {
    return {
      ...base,
      recommendation: null,
      reasons: [
        "No index, so there is no evidence to size this task from. Build one with node index/cortex-index.mjs — Cortex will not guess.",
      ],
      signals: null,
    };
  }
  const paths = [...new Set((files || []).map((p) => normalizeChangedPath(p, root)).filter(Boolean))].sort();
  if (!paths.length) {
    return {
      ...base,
      recommendation: null,
      reasons: ["No files were named, so there is nothing to size. Name the files the task will touch."],
      signals: null,
    };
  }

  const T = thresholds;
  const byPath = new Map(index.files.map((f) => [f.path, f]));
  const isTest = (p) => (byPath.has(p) ? !!byPath.get(p).isTest : isTestPath(p));
  const langOf = (p) => byPath.get(p)?.lang ?? detectLanguage(p);

  // --- areas: where the task's source lives --------------------------------------------------------
  // Source that is not a test. Tests, documents and configuration travel with the change they
  // accompany. Counting them made every fix-plus-test a two-area task (the test lives in `tests/`
  // or `src/test`), every change with a CHANGELOG line touch the root area, and every dependency
  // bump or release — one manifest per package — a four-area refactor.
  const source = paths.filter((p) => !isTest(p) && SOURCE_CATEGORIES.has(categoryOf(langOf(p))));
  const areas = [...new Set(source.map(layerKeyFor))].sort();

  // --- critical: a scoped brief governs a source file ----------------------------------------------
  // The nearest brief above a file governs it. The root brief governs everything, so it
  // distinguishes nothing and is not one of these.
  const briefs = scopedBriefs(index);
  const critical = [
    ...new Set(source.map((p) => briefs.find((b) => p.startsWith(`${b.dir}/`))?.path).filter(Boolean)),
  ].sort();
  const areasLine = critical.length ? T.areasWithBrief : T.areas;

  // --- dependents and untested dependents: impactOf, read rather than recomputed -------------------
  const r = impactOf(index, paths, { root });
  const prodAffected = r.affected.filter((a) => !a.isTest);
  const direct = prodAffected.filter((a) => a.depth === 1).length;
  const untested = r.unverified.map((u) => u.path);

  // --- blind: files whose dependents Cortex cannot see at all --------------------------------------
  const blindFiles = paths.filter((p) => UNRESOLVED_LANGUAGES.has(langOf(p)));
  const blindLangs = [...new Set(blindFiles.map(langOf))].sort();

  const signals = {
    areas: {
      count: areas.length,
      names: areas,
      threshold: areasLine,
      crossed: areas.length >= areasLine,
    },
    critical: { count: critical.length, briefs: critical },
    dependents: {
      directAtLeast: direct,
      atLeast: prodAffected.length,
      directThreshold: T.directDependents,
      threshold: T.dependents,
      crossed: direct >= T.directDependents || prodAffected.length >= T.dependents,
    },
    untestedDependents: {
      atLeast: untested.length,
      paths: untested,
      threshold: T.untestedDependents,
      crossed: untested.length >= T.untestedDependents,
    },
    blind: { files: blindFiles, languages: blindLangs },
    unknown: r.unknown,
  };

  // --- the sentences, each with its number ---------------------------------------------------------
  const crossedReasons = [];
  const otherReasons = [];
  const say = (crossed, text) => (crossed ? crossedReasons : otherReasons).push(text);
  const vs = (crossed, t) => (crossed ? `at or over the team line of ${t}` : `under the team line of ${t}`);
  const s = signals;

  if (source.length) {
    const briefNote = critical.length ? " with a scoped brief among them" : "";
    say(
      s.areas.crossed,
      `Touches ${plural(s.areas.count, "area")} of source (${list(areas)})${briefNote} — ${vs(s.areas.crossed, areasLine)}.`,
    );
  } else {
    otherReasons.push(
      `Touches no source file — ${plural(paths.length, "file")} of tests, documents or configuration, which the area signal does not count.`,
    );
  }
  otherReasons.push(
    critical.length
      ? `${plural(critical.length, "scoped brief")} govern${critical.length === 1 ? "s" : ""} this work (${list(critical)}), so the areas line is ${T.areasWithBrief}, not ${T.areas}; read ${critical.length === 1 ? "it" : "each"} before starting.`
      : `No source file is under a scoped brief, so the areas line is ${T.areas}.`,
  );
  const d = s.dependents;
  say(
    d.crossed,
    `At least ${plural(d.atLeast, "production file")} depend${d.atLeast === 1 ? "s" : ""} on these, ${d.directAtLeast} directly — ` +
      (d.directAtLeast >= T.directDependents
        ? `at or over the team line of ${T.directDependents} direct.`
        : d.crossed
          ? `at or over the team line of ${T.dependents} in all.`
          : `under the team lines of ${T.directDependents} direct and ${T.dependents} in all.`),
  );
  say(
    s.untestedDependents.crossed,
    `At least ${s.untestedDependents.atLeast} of those ${s.untestedDependents.atLeast === 1 ? "is" : "are"} exercised by no test Cortex can see — ${vs(s.untestedDependents.crossed, T.untestedDependents)}.`,
  );
  if (blindFiles.length) {
    otherReasons.unshift(
      `Blind: Cortex cannot resolve ${blindLangs.join(", ")} imports, so the dependents of ${plural(blindFiles.length, "file")} (${list(blindFiles)}) are unseen — not small, unseen.`,
    );
  }
  if (r.unknown.length) {
    otherReasons.push(
      `${plural(r.unknown.length, "file")} not in the index (${list(r.unknown)}) — new, ignored or a typo; no dependents are counted for ${r.unknown.length === 1 ? "it" : "them"}.`,
    );
  }

  let recommendation;
  if (s.areas.crossed || s.dependents.crossed || s.untestedDependents.crossed) {
    // A floor over the line is over the line, whatever else is unseen.
    recommendation = "team";
  } else if (blindFiles.length) {
    // Nothing crossed — but for these files nothing was looked at, and `single` would be the
    // confident small answer from a signal that never ran.
    recommendation = null;
    otherReasons.push(
      "No signal crossed its line, but the graph is blind to part of this task, so Cortex will not call it single. Size it by reading the code.",
    );
  } else {
    recommendation = "single";
  }

  return { ...base, recommendation, reasons: [...crossedReasons, ...otherReasons], signals };
}
