// Which skills this repo would actually benefit from, chosen from what the index detected.
//
// `/cortex-scaffold` shipped the same two skills into every repo — `plan-feature` and
// `investigate-bug` — because nothing downstream of the index could tell a Next.js app with Prisma
// and no tests apart from a Rust CLI. The context layer was tailored and the skills were not.
//
// Declarative on purpose, the way `offers()` already is: every candidate states its own trigger as
// `when(stack, stats)`, so the full set is enumerable without reading any bodies and a new one is a
// row rather than another branch in a growing if-chain. Severity ordering is control flow here for
// the same reason it is in findings (ADR 0006) — the wizard walks this list top-down, so rank
// decides which skill a user is offered first.
//
// What this module does NOT do is write skill bodies. It names candidates and says why each was
// surfaced; the ritual writes the body, because a useful body quotes this repo's real commands and
// real paths, and inventing those is exactly the failure a deterministic module cannot detect.

const has = (list, id) => Array.isArray(list) && list.includes(id);

/**
 * Every skill Cortex can propose. Each row is:
 *   id       — the skill's directory name in .claude/skills/
 *   title    — what it does, one line, shown in the offer
 *   rank     — lower is offered first. Ties broken by id, so the order is deterministic.
 *   why(s)   — the evidence sentence. Must name what was DETECTED, never a generality:
 *              "no test runner in package.json" is checkable; "testing is important" is noise.
 *   when(s)  — s = { stack, stats }. Pure predicate over the index.
 *   brief    — what the ritual should put in the body. Instructions to the writer, not the body.
 */
export const SKILL_CANDIDATES = [
  {
    id: "write-first-test",
    // Titled for both cases. "Set up a test runner" is visibly wrong to a reader whose package.json
    // already names one, and a report that is visibly wrong once is not trusted on the parts the
    // reader cannot check. The why says which case this repo is in.
    title: "Get a real test running for the first time",
    rank: 10,
    // Zero tests is the whole trigger — a declared runner does not change it. A scaffold that ships
    // jest in devDependencies and no test files (create-expo-app, CRA, and most starters) used to
    // fall past this row into add-test, and be told to extend a convention that does not exist yet.
    when: (s) => s.stats.tests === 0 && s.stats.files > 5,
    why: (s) =>
      s.stack.test.length > 0
        ? `${s.stack.test.join(", ")} is in a manifest but no test file exists — the runner is installed, not used`
        : "no test files and no test runner in any manifest — every change here is unverified",
    brief:
      "If no runner is declared, pick the one that matches the stack rather than a favourite and wire " +
      "the script into the manifest. If one IS declared, use it — a second runner alongside an unused " +
      "first is worse than either. Either way write ONE real test against existing behaviour: a first " +
      "test asserting true === true passes forever and proves nothing, and the goal is a red-green a " +
      "human can watch.",
  },
  {
    id: "add-test",
    title: "Add a test using this repo's existing conventions",
    rank: 20,
    // Both halves matter: a runner to extend, AND an existing test to read the convention off.
    // Without the second, there is no convention and write-first-test is the honest offer.
    when: (s) => s.stack.test.length > 0 && s.stats.tests > 0,
    why: (s) => `${s.stack.test.join(", ")} already set up — new work should extend it, not invent a second way`,
    brief:
      "Name the runner, the exact command to run one file, and where tests live relative to source " +
      "in THIS repo (co-located vs a test/ directory — read it, do not assume). A second testing " +
      "convention is worse than none, because now every reader has to decide which one applies.",
  },
  {
    id: "verify-webhook",
    title: "Add or change a payment webhook safely",
    rank: 30,
    when: (s) => has(s.stack.services, "stripe"),
    why: () => "Stripe is a dependency — webhook handlers must verify the signature against the RAW body",
    brief:
      "Lead with the invariant: signature verification needs the unparsed body, so any framework " +
      "body-parser must be disabled on that route. This is the single most common way an agent " +
      "breaks billing while the code still looks correct — it fails only against real webhooks. " +
      "Include how to replay one locally, and the idempotency rule: providers retry, so a handler " +
      "must be safe to run twice on the same event id.",
  },
  {
    id: "add-migration",
    title: "Change the database schema and migrate",
    rank: 40,
    when: (s) => s.stack.data.length > 0,
    why: (s) => `${s.stack.data.join(", ")} owns the schema — schema edits and migrations must move together`,
    brief:
      "The exact generate/migrate commands from this repo's manifest scripts, the real schema path " +
      "(read it — a generated client is often NOT at the library default), and the rule that a " +
      "schema edit without its migration is a broken deploy that passes review.",
  },
  {
    id: "add-route",
    title: "Add an API route end to end",
    rank: 50,
    when: (s) => has(s.stack.frameworks, "next") || has(s.stack.frameworks, "express") ||
                 has(s.stack.frameworks, "nest") || has(s.stack.frameworks, "fastapi") ||
                 has(s.stack.frameworks, "flask") || has(s.stack.frameworks, "django"),
    why: (s) => `${s.stack.frameworks.join(", ")} — a new endpoint touches routing, validation and the data layer together`,
    brief:
      "Trace one EXISTING endpoint in this repo and describe that path, so the skill teaches the " +
      "convention already in use rather than the framework's tutorial. Name where validation " +
      "happens, where the handler calls into services, and what the error shape is.",
  },
  {
    id: "check-auth",
    title: "Work on authentication without weakening it",
    rank: 60,
    when: (s) => has(s.stack.services, "nextauth") || has(s.stack.services, "supabase"),
    why: (s) => `${s.stack.services.filter((x) => x === "nextauth" || x === "supabase").join(", ")} handles sessions — auth edits fail open if the guard is wrong`,
    brief:
      "Where the session is read, which routes are protected and by what mechanism, and the " +
      "failure mode that matters: an auth bug fails OPEN and looks like a working page. Say how to " +
      "test the unauthenticated path, because that is the one nobody clicks by accident.",
  },
  {
    id: "type-check",
    title: "Keep types honest",
    rank: 70,
    when: (s) => has(s.stack.languages, "typescript"),
    why: () => "TypeScript is configured — the checker is only useful if it is actually run and not escaped",
    brief:
      "The real type-check command from the manifest scripts, and the rule about escape hatches: " +
      "`any` and `@ts-expect-error` are sometimes right, but each one is a claim that needs a " +
      "reason on the same line. Never widen a type to make an error go away.",
  },
  {
    id: "ship-it",
    title: "Get a change through CI and out",
    rank: 80,
    when: (s) => has(s.stack.delivery, "githubActions") || has(s.stack.delivery, "docker"),
    why: (s) => `${s.stack.delivery.join(", ")} — the path from a green local run to a deployed change is worth writing down once`,
    brief:
      "The actual workflow files and what each gate checks, in order. If the pipeline has a step " +
      "that commonly fails, name it and its fix — that is the whole value of the skill.",
  },
];

/**
 * proposeSkills(index) → ranked candidates that fit this repo.
 *
 * Pure. Takes the index, returns data. Writing is the ritual's job — see index/AGENTS.md: nothing
 * here may modify a target repository.
 */
export function proposeSkills(index) {
  // An index written before stack detection existed has no `stack` key. Falling back to an empty
  // stack would let candidates fire on `stats` alone — and their evidence would be a lie: a repo
  // with vitest configured would be told "no test runner in any manifest" when nothing ever read a
  // manifest. Every candidate's `why` presumes detection ran, so if it did not, propose nothing and
  // let the caller re-index.
  if (!index || !index.stack) return [];

  const stack = { languages: [], frameworks: [], data: [], services: [], test: [], delivery: [], manifests: [], ...index.stack };
  const stats = index.stats || { files: 0, tests: 0 };
  const s = { stack, stats };

  return SKILL_CANDIDATES
    .filter((c) => {
      try {
        return c.when(s);
      } catch {
        // A predicate that throws on an odd index must not take the whole proposal down with it.
        return false;
      }
    })
    .map((c) => ({ id: c.id, title: c.title, rank: c.rank, why: c.why(s), brief: c.brief }))
    .sort((a, b) => a.rank - b.rank || a.id.localeCompare(b.id));
}

/**
 * Candidates already present in the repo are reported separately rather than filtered away: an
 * offer list that silently omits them looks like Cortex judged them unnecessary, when in fact they
 * are the ones already doing their job.
 */
export function partitionExisting(proposed, existingIds) {
  const have = new Set(existingIds || []);
  return {
    missing: proposed.filter((p) => !have.has(p.id)),
    present: proposed.filter((p) => have.has(p.id)),
  };
}
