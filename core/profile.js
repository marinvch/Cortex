// Which world this install serves — home, work, or lab.
//
// The employer firewall in AGENTS.md already presupposes exactly this: "One vault instance holds
// exactly one world." It then hardcodes that world to *personal*, and every ritual restates the
// consequence in prose. So the profile is not a new concept — it is the one the firewall has always
// assumed, made declarable, with the single piece a machine can actually enforce moved into code.
//
// Three axes now, and conflating any two of them would weld together questions that move
// independently (docs/adr/0008 makes this argument for the first two):
//
//   mode      (mcp/lib/mode.js)     repo | vault    what KIND of brain this root is
//   audience  (mcp/lib/resolve.js)  solo | team | server   WHO it serves
//   profile   (this file)           home | work | lab      WHICH WORLD it belongs to
//
// They are genuinely orthogonal: a work laptop can run a repo-mode brain on a team (work/repo/team),
// and a lab box can hold a personal vault nobody else sees (lab/vault/solo).

export const HOME = "home";
export const WORK = "work";
export const LAB = "lab";

/**
 * What each profile means, as data rather than as branches. `refuses` is the firewall's direction —
 * the thing rituals consult; `outwardSync` is the part code enforces.
 */
const POLICY = {
  [HOME]: {
    label: "home",
    refuses: "employer",
    outwardSync: true,
    summary:
      "A personal second brain. Day-job material — employer or client names, work tickets, " +
      "colleagues, internal architecture — is refused, and the refusal is the point: it belongs in " +
      "a work install, not sanitised and filed here.",
  },
  [WORK]: {
    label: "work",
    refuses: "personal",
    outwardSync: true,
    summary:
      "A work machine. Employer material is expected here; personal notes are what gets refused. " +
      "The rule is the same one read from the other side — the two installs never sync, so a " +
      "private note filed into a work brain is the mirror of the leak home guards against.",
  },
  [LAB]: {
    label: "lab",
    refuses: "nothing",
    // The load-bearing half. "No firewall" is only safe on a machine that cannot publish: a lab
    // install refuses outward sync entirely, so permissive-locally and sealed-outward are one
    // decision rather than two that can drift apart. Without this, `lab` would just be a way to
    // switch the firewall off and keep pushing — which is the leak with extra steps.
    outwardSync: false,
    summary:
      "Scratch and experiments. Nothing here is real, so nothing is refused — and because nothing " +
      "is refused, nothing leaves: team push is disabled. Permissive locally, sealed outward.",
  },
};

export class UnknownProfileError extends Error {
  constructor(value) {
    super(
      `unknown CORTEX_PROFILE: ${JSON.stringify(value)}. Expected one of: ${Object.keys(POLICY).join(", ")}`,
    );
    this.name = "UnknownProfileError";
    this.code = "unknown_profile";
  }
}

/**
 * resolveProfile({ env }) → { profile, source, policy }
 *
 * **Declared, never detected.** A machine leaves no filesystem trace of which world it belongs to —
 * a work laptop and a home laptop have the same shape — so there is nothing honest to detect, and
 * the same reasoning that made `server` a declared audience applies here (docs/adr/0008).
 *
 * Defaults to `home`, and the default is chosen to fail SAFE rather than convenient: an undeclared
 * work machine gets the strict-about-employer-content firewall, which at worst refuses a write
 * someone wanted. The opposite default would let a work machine quietly behave like a lab.
 *
 * An unrecognised value THROWS rather than falling back. A typo — `CORTEX_PROFILE=works` — silently
 * resolving to `home` would look identical to a correct home install while the user believed the
 * firewall was pointed the other way.
 */
export function resolveProfile({ env = {} } = {}) {
  const raw = env.CORTEX_PROFILE;

  if (raw === undefined || raw === null || String(raw).trim() === "") {
    return { profile: HOME, source: "default", policy: POLICY[HOME] };
  }

  const value = String(raw).trim().toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(POLICY, value)) throw new UnknownProfileError(raw);

  return { profile: value, source: "CORTEX_PROFILE", policy: POLICY[value] };
}

/** The policy for a profile id. Throws on an unknown one, for the same reason resolveProfile does. */
export function policyFor(profile) {
  if (!Object.prototype.hasOwnProperty.call(POLICY, profile)) throw new UnknownProfileError(profile);
  return POLICY[profile];
}

/** Every profile id, for help text and for tests that must cover the whole set. */
export function profiles() {
  return Object.keys(POLICY);
}
