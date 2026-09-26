// Opening the brain: the one entry every adapter goes through.
//
// Cortex has two adapters over the same operations — `server.js` (MCP over stdio) and `ai-os.js`
// (the CLI). Both need the same four facts before they can do anything, and for a while only one of
// them assembled them. The CLI read `process.env.AI_OS_ROOT` raw and passed `args.team` straight
// through, so `ai-os catch-up --project x --since y` inside a repo with a `.cortex/connector.json`
// consulted no connector, found no team clone, and reported `commits: []` as a success. That is the
// same failure `mcp/AGENTS.md` already declares an invariant against for `capture` — "requiring the
// agent to pass `team` was the seam leaking" — arriving through the other adapter, because the seam
// existed as a convention rather than as a module and the second adapter re-derived it wrong.
//
// So: a second adapter is what makes a seam real, and a real seam is a module.
//
// ## It composes three answers. It does NOT merge the three questions.
//
//   mode      lib/mode.js      repo | vault           what KIND of brain this root is — from the
//                                                     root STRING, never configured
//   audience  lib/resolve.js   solo | team | server   WHO it serves — solo/team DETECTED from
//                                                     `.cortex/connector.json`, server DECLARED
//                                                     with CORTEX_AUDIENCE
//   profile   core/profile.js  home | work | lab      WHICH WORLD it belongs to — DECLARED with
//                                                     CORTEX_PROFILE and nothing else
//
// They stay three fields on the record and they must never become one enum. They are genuinely
// orthogonal: a work laptop can run a repo-mode brain on a team; a lab box can hold a personal
// vault nobody else sees. Welding any two together guarantees a future bug where changing one
// silently changes the other — the argument is in docs/adr/0008 for the first two and repeated in
// docs/adr/0015 for the third, and `core/test/profile.test.js` asserts that nothing about the root,
// the connector or the cwd may move the profile. Composing them here does not give this module
// licence to collapse them; it is a record with three fields, not a fourth question.
//
// Opening also means FAILING at entry. Both errors are thrown here, before a command picks a
// branch, so a missing root or a misspelt `CORTEX_PROFILE` fails the same way in both adapters
// rather than at whichever branch happens to look first. `ai-os.js` resolved the profile inside
// `team init` only, which is why `team add` never noticed a typo.

import { detectMode, REPO } from "./mode.js";
import { resolveBrain, NoRootError } from "./resolve.js";
import { resolveProfile, UnknownProfileError } from "../../core/profile.js";

export { NoRootError, UnknownProfileError };

/**
 * openBrain({ cwd, env }) → the brain this process is talking to.
 *
 * @param {{ cwd: string, env: Record<string,string|undefined> }} ctx
 * @returns {{
 *   root: string, mode: string, isRepo: boolean,
 *   audience: string, team: string|null, teamClone: string|null, project: string|null,
 *   profile: string, policy: object,
 *   sources: { audience: string, profile: string },
 *   describe: () => string,
 * }}
 * @throws {NoRootError} AI_OS_ROOT unset or blank — never guessed (docs/adr/0008)
 * @throws {UnknownProfileError} CORTEX_PROFILE set to something that is not a profile
 */
export function openBrain({ cwd, env }) {
  // The profile first. It needs no root, so settling it before the root means a misspelt
  // CORTEX_PROFILE is reported even by a caller that goes on to treat a missing root as a
  // degradation rather than a fatal — `ai-os catch-up`, which reads a plain repo without a vault.
  // Otherwise NoRootError would short-circuit it and the typo would ride along unnoticed.
  const world = resolveProfile({ env });
  const located = resolveBrain({ cwd, env });
  const mode = detectMode(located.root);

  const brain = {
    root: located.root,
    mode,
    // The boolean both adapters actually branch on, derived here rather than by each caller calling
    // `isRepoMode` on the root again. `mode` stays the answer; this is the same answer, typed.
    isRepo: mode === REPO,

    audience: located.audience,
    team: located.team,
    teamClone: located.teamClone,
    // The project this checkout is in the team-brain, from the connector — the default for a capture
    // or catch-up that names none, so an agent in a connected repo does not have to know it.
    project: located.project ?? null,

    profile: world.profile,
    // The policy object, not a copy of its fields: `lab` refusing nothing and publishing nothing is
    // ONE decision, and splitting it across the record is how the two halves drift apart.
    policy: world.policy,

    // A resolver that cannot explain its own answer is one nobody trusts the moment it is wrong.
    sources: { audience: located.source, profile: world.source },

    describe: () => describe(brain),
  };
  return brain;
}

/**
 * One line naming all three axes and the root, for the startup banner. stderr only in the server —
 * stdout is the protocol channel. Stated once so the two adapters cannot describe the same brain
 * differently.
 */
function describe(b) {
  return (
    `cortex: profile=${b.profile} (${b.sources.profile})` +
    ` audience=${b.audience} (${b.sources.audience})` +
    ` mode=${b.mode} root=${b.root}`
  );
}
