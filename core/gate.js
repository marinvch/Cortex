// The publish gate: every check a write must pass before it leaves this machine, in one call.
//
// Three checks, in this order, each refusing rather than sanitising:
//
//   1. a credential            core/scrub.js `assertWritable`    always
//   2. an employer name        core/denylist.js `assertNotDenied` on a profile that refuses employer
//                                                                 material (home), when a list exists
//   3. personal data           core/scrub.js `gatePersonal`      CORTEX_PII: warn (default) | refuse | off
//
// Two callers, and they are the two halves of "the gate" in CONTEXT.md: `append()` in memory.js,
// which every memory write goes through, and `assertPublishable` in mcp/lib/tools.js, which every
// publishing tool's declaration routes through. Each used to call `assertWritable` alone; a fourth
// check added to one of them and not the other is the drift this module exists to prevent.
//
// Returns `{ warnings }` — sentences for the caller to pass on to the person: a personal-data
// warning in `warn` mode, and a line for each denylist entry that could not be used.

import { assertWritable, gatePersonal } from "./scrub.js";
import { assertNotDenied, denylistProblemNotes } from "./denylist.js";

/**
 * Throws `RefusedWriteError` (a credential), `DeniedWriteError` (the employer denylist) or
 * `PersonalDataError` (CORTEX_PII=refuse) — all three are `RefusedWriteError`s — before anything is
 * written. `policy` is the profile's (`core/profile.js`), and is required: a missing policy is never
 * read as "refuses nothing".
 */
export function assertPublished(text, { policy, env = process.env, list } = {}) {
  assertWritable(text);
  const deny = assertNotDenied(text, { policy, env, list });
  const pii = gatePersonal(text, { env });
  const warnings = denylistProblemNotes(deny.problems);
  if (pii.warning) warnings.push(pii.warning);
  return { warnings };
}
