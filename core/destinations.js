// Approved destinations: on a `work` profile, nothing leaves the machine except to a place the
// company approved.
//
// The employer firewall on `home` (core/denylist.js) is about WHAT is written. This is about WHERE
// it goes. On a work machine the material is the company's by definition, so the question is not
// whether a note mentions the employer — it all does — but whether the host it is about to be
// pushed or posted to is one the company signed off. A team-brain on somebody's personal GitHub, a
// tracker URL with a typo in the tenant, a scheduled digest sent to an API the company never
// approved: each is company material on a machine it has no agreement with, and the person who ran
// the command is the one who answers for it. docs/adr/0030 holds the argument.
//
// The rules this module keeps:
//
//   - **The list lives outside any repository.** `CORTEX_DESTINATIONS` names it, else
//     `~/.cortex/allowed-destinations`. The company can deploy that file by device management. A
//     list inside the team-brain would be written by whoever owns the team-brain, which on a
//     personal remote is the very person the list exists to stop.
//   - **Policy is data.** `policy.destinations` (core/profile.js) is `any` on home, `approved` on
//     work and `none` on lab. A missing policy, or one with no `destinations`, throws: it is never
//     read as `any` — the same rule core/gate.js keeps for the publish gate.
//   - **`approved` fails closed.** No file at the default path, or a `CORTEX_DESTINATIONS` that names
//     no readable file, refuses every outward call, and the refusal says how to set the file up.
//     The opposite default would make every existing work install keep pushing anywhere until
//     somebody remembered to write a file, which is the leak this exists to close.
//   - **Matching is exact.** The host is compared case-insensitively and whole: `github.com` never
//     matches `evilgithub.com` or `github.com.evil.example`, because there is no suffix match at all.
//     A path prefix matches whole segments: `github.com/acme` matches `github.com/acme/brain` and not
//     `github.com/acme-evil/brain`. A `.` or `..` segment never matches anything.
//   - **The same machine is always allowed.** A local path, a `file://` URL, and http(s) on a
//     loopback host never leave the machine — a bare repository on disk is a complete git remote,
//     and the tests run on those and on loopback mock servers. A UNC path (`\\server\share`) is a
//     network share, so its server is the host and it is checked like any other. A loopback port
//     can be a tunnel to somewhere else; that is a choice the person made on their own machine, and
//     no address string can see it.
//   - **Inbound is not outbound.** A pull or a clone (`inbound: true`) sends nothing but the
//     request, so `none` (lab) allows it — lab is sealed outward, not cut off. `approved` still
//     checks it: contacting an unapproved host at all hands it the company's credentials and the
//     name of the repository.
//   - **A refusal names the host and path, never the userinfo or a credential.** It is built from
//     the normalised address only. An address that cannot be read is not repeated at all.
//   - **A bad line is reported, never fatal**, the same as the denylist: an unknown kind, an empty
//     value, a scheme, a wildcard or a port is a `problem` with its line number, and the good lines
//     still apply.

import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { RefusedWriteError } from "./scrub.js";

/** What a line may name: a git remote, an https endpoint, an npm registry. */
export const DESTINATION_KINDS = Object.freeze(["git", "https", "npm"]);

/** The values `policy.destinations` may hold. */
export const DESTINATION_MODES = Object.freeze(["any", "approved", "none"]);

const DESCRIBE = { git: "git remote", https: "https endpoint", npm: "npm registry" };

const LOOPBACK = new Set(["localhost", "[::1]"]);
const isLoopback = (host) => LOOPBACK.has(host) || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host);

// A host as a list line or an address may spell it: DNS labels, or a bracketed IPv6 literal.
const HOST_RE = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*|\[[0-9a-f:.]+\])$/;

/** Split a path into segments, refusing a dot segment or one that decodes to a separator. */
function segmentsOf(path) {
  const out = [];
  for (const raw of String(path ?? "").split(/[\\/]+/)) {
    if (!raw) continue;
    let seg;
    try {
      seg = decodeURIComponent(raw);
    } catch {
      return null;
    }
    if (seg === "." || seg === ".." || /[\\/]/.test(seg)) return null;
    out.push(seg.toLowerCase());
  }
  // `owner/repo.git` and `owner/repo` are one repository.
  if (out.length) out[out.length - 1] = out[out.length - 1].replace(/\.git$/, "");
  if (out.length && !out[out.length - 1]) out.pop();
  return out;
}

const cleanHost = (h) => String(h ?? "").trim().toLowerCase().replace(/\.$/, "");

/**
 * Read an address as `{ local: true }`, or `{ scheme, host, segments }`, or null when it cannot be
 * read. Never returns the userinfo; never throws.
 *
 *   /srv/brain.git  C:\brains\team  ./brain  file:///srv/brain      local
 *   \\server\share\brain  //server/share/brain                       host `server`
 *   https://user:token@github.com/acme/brain.git                     github.com · acme/brain
 *   ssh://git@gitlab.acme.example:2222/team/brain                    gitlab.acme.example · team/brain
 *   git@github.com:acme/brain.git                                    github.com · acme/brain
 */
export function parseTarget(target) {
  const s = String(target ?? "").trim();
  if (!s) return null;

  // `\\?\C:\…` and `\\.\…` are Windows' own spellings of a local path, not a server called `?`.
  if (/^\\\\[?.]\\/.test(s)) return { local: true };

  // UNC, before anything else: `\\server\share` and `//server/share` name another machine.
  const unc = s.match(/^(?:\\\\|\/\/)([^\\/]+)[\\/]?(.*)$/);
  if (unc) {
    const host = cleanHost(unc[1].replace(/^[^@]*@/, ""));
    const segments = segmentsOf(unc[2]);
    if (!HOST_RE.test(host) || !segments) return null;
    return { scheme: "unc", host, segments };
  }

  // A URL with a scheme.
  const scheme = s.match(/^([a-z][a-z0-9+.-]*):\/\//i);
  if (scheme) {
    const proto = scheme[1].toLowerCase();
    let u;
    try {
      u = new URL(s);
    } catch {
      return null;
    }
    // `file:///srv/x` is this machine. `file://server/share/x` is a network share, read like UNC.
    if (proto === "file") {
      const fileHost = cleanHost(u.hostname);
      if (!fileHost || fileHost === "localhost") return { local: true };
      const segments = segmentsOf(u.pathname);
      if (!HOST_RE.test(fileHost) || !segments) return null;
      return { scheme: "unc", host: fileHost, segments };
    }
    const host = cleanHost(u.hostname);
    const segments = segmentsOf(u.pathname);
    if (!host || !HOST_RE.test(host) || !segments) return null;
    return { scheme: proto, host, segments };
  }

  // A Windows drive path: one letter, a colon, a separator. Before the scp check, which would
  // otherwise read `C:/x` as host `C`.
  if (/^[a-z]:(?:[\\/]|$)/i.test(s)) return { local: true };

  // git's scp-like form, `[user@]host:path`: a colon before the first slash.
  const colon = s.indexOf(":");
  const slash = s.search(/[\\/]/);
  if (colon > 0 && (slash < 0 || colon < slash)) {
    const host = cleanHost(s.slice(0, colon).replace(/^[^@]*@/, "").replace(/^\[(.*)\]$/, "[$1]"));
    const segments = segmentsOf(s.slice(colon + 1));
    if (!host || !HOST_RE.test(host) || !segments) return null;
    return { scheme: "scp", host, segments };
  }

  // Anything else is a path on this machine, as git reads it.
  return { local: true };
}

/** `host/seg/seg`, for a message. Built from the normalised parts, so no userinfo can be in it. */
export function describeTarget(t) {
  return t && !t.local ? [t.host, ...t.segments].join("/") : "a path on this machine";
}

/**
 * Parse a destinations list. `{ entries: [{ kind, line, host, segments }], problems: [{ line, why }] }`.
 * Never throws.
 *
 *   # comment
 *   git: github.com/acme-corp
 *   git: gitlab.acme.internal
 *   https: acme.service-now.com
 *   https: api.anthropic.com
 *   npm: registry.npmjs.org
 */
export function parseDestinations(text) {
  const entries = [];
  const problems = [];
  String(text ?? "").split(/\r?\n/).forEach((raw, i) => {
    const line = i + 1;
    const s = raw.trim();
    if (!s || s.startsWith("#")) return;
    const colon = s.indexOf(":");
    if (colon < 0) {
      problems.push({ line, why: `has no kind — write it as one of ${DESTINATION_KINDS.join(", ")}, a colon, then host[/path]` });
      return;
    }
    const kind = s.slice(0, colon).trim().toLowerCase();
    const value = s.slice(colon + 1).trim();
    if (!DESTINATION_KINDS.includes(kind)) {
      problems.push({ line, why: `names an unknown kind — expected one of ${DESTINATION_KINDS.join(", ")}` });
      return;
    }
    if (!value) {
      problems.push({ line, why: "has no value" });
      return;
    }
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
      problems.push({ line, why: "carries a scheme — write the host and path alone, as in `github.com/your-org`" });
      return;
    }
    if (value.includes("*")) {
      problems.push({ line, why: "has a wildcard — there is no wildcard or suffix match; list each host" });
      return;
    }
    if (value.includes("@")) {
      problems.push({ line, why: "carries a user — write the host and path alone" });
      return;
    }
    const cut = value.search(/[\\/]/);
    const host = cleanHost(cut < 0 ? value : value.slice(0, cut));
    if (/:\d+$/.test(host) && !host.startsWith("[")) {
      problems.push({ line, why: "has a port — ports are not matched; write the host alone" });
      return;
    }
    const segments = segmentsOf(cut < 0 ? "" : value.slice(cut + 1));
    if (!HOST_RE.test(host)) {
      problems.push({ line, why: "is not a host name" });
      return;
    }
    if (!segments) {
      problems.push({ line, why: "has a `.` or `..` segment in its path" });
      return;
    }
    entries.push({ kind, line, host, segments });
  });
  return { entries, problems };
}

/** The list's path, and which setting named it. Reads the strings it is handed, never the disk. */
export function destinationsPath({ env = {} } = {}) {
  const set = String(env.CORTEX_DESTINATIONS ?? "").trim();
  if (set) return { path: set, from: "CORTEX_DESTINATIONS" };
  const home = String(env.HOME ?? "").trim() || String(env.USERPROFILE ?? "").trim() || homedir();
  return { path: join(home, ".cortex", "allowed-destinations"), from: "default" };
}

/**
 * Read the list. `{ path, from, state, entries, problems }`, where `state` is
 *
 *   ok         the file was read; `entries` and `problems` say what it holds
 *   absent     no file at the default path — on `approved`, every outward call is refused
 *   missing    CORTEX_DESTINATIONS names no readable file — refused the same way, and said so
 *
 * Never throws.
 */
export function loadDestinations({ env = {} } = {}) {
  const { path, from } = destinationsPath({ env });
  let text;
  try {
    if (!statSync(path).isFile()) throw new Error("not a file");
    text = readFileSync(path, "utf8");
  } catch {
    const state = from === "CORTEX_DESTINATIONS" ? "missing" : "absent";
    return { path, from, state, entries: [], problems: [] };
  }
  return { path, from, state: "ok", ...parseDestinations(text) };
}

/** The first entry of `kind` that allows `t`, or null. Host exact; path by whole segments. */
export function matchDestination(t, kind, list) {
  if (!t || t.local) return null;
  for (const e of list?.entries ?? []) {
    if (e.kind !== kind || e.host !== t.host) continue;
    if (e.segments.length > t.segments.length) continue;
    if (e.segments.every((seg, i) => t.segments[i] === seg)) return e;
  }
  return null;
}

/** An outward call refused because its destination is not approved. Names host and path only. */
export class DestinationRefusedError extends RefusedWriteError {
  constructor({ reason, kind, target, policy, list }) {
    super([{ kind: "unapproved destination", line: 0 }]);
    this.name = "DestinationRefusedError";
    this.code = "unapproved_destination";
    this.reason = reason;
    this.destinationKind = kind;
    this.host = target && !target.local ? target.host : null;
    this.path = target && !target.local ? target.segments.join("/") : null;
    const where = target ? describeTarget(target) : "an address that cannot be read as a host and path";
    const profile = policy?.label ?? "this";
    const head = `refusing to reach ${where} (${DESCRIBE[kind] ?? kind}): `;
    const tail = " Nothing was sent.";
    const how =
      `Write one line per approved destination — \`git: github.com/your-org\`, \`https: your-tenant.service-now.com\` — ` +
      `to ${list?.path ?? "~/.cortex/allowed-destinations"}, or have IT deploy it there; CORTEX_DESTINATIONS names another file. ` +
      "`node tools/cortex-destinations.mjs status` shows what is read.";
    switch (reason) {
      case "sealed":
        this.message = `${head}the ${profile} profile sends nothing off this machine.${tail}`;
        break;
      case "no_list":
        this.message = `${head}the ${profile} profile sends company material only to approved destinations, and there is no list at ${list?.path}.${tail} ${how}`;
        break;
      case "missing_list":
        this.message = `${head}CORTEX_DESTINATIONS names ${list?.path}, which is not a readable file, so nothing can be checked.${tail} Fix the path, or unset CORTEX_DESTINATIONS to use ~/.cortex/allowed-destinations.`;
        break;
      case "unreadable":
        this.message = `${head}the ${profile} profile checks every destination, and this one cannot be checked.${tail}`;
        break;
      default:
        this.message =
          `${head}it is not on the approved list at ${list?.path}. The ${profile} profile sends company material only to approved destinations.${tail} ` +
          `If your company approved it, add \`${kind}: ${where}\` (or its owner) to that file; ` +
          `\`node tools/cortex-destinations.mjs check ${kind} <url>\` checks again.`;
    }
  }
}

/**
 * The gate on every outward call. Returns `{ allowed: true, why, target }` and throws
 * `DestinationRefusedError` when the call may not be made. `policy` is required: a missing one, or
 * one with no `destinations`, throws a TypeError rather than being read as `any`.
 *
 * `list` is for a caller that already loaded the list, and for tests; without it the file is read.
 * `inbound` marks a pull or a clone, which `none` allows (see the header).
 */
export function assertDestination(target, { kind, policy, env = process.env, list, inbound = false } = {}) {
  if (!policy || !DESTINATION_MODES.includes(policy.destinations)) {
    throw new TypeError("assertDestination: a profile policy with `destinations` is required");
  }
  if (!DESTINATION_KINDS.includes(kind)) throw new TypeError(`assertDestination: kind must be one of ${DESTINATION_KINDS.join(", ")}`);

  const t = parseTarget(target);
  if (t?.local) return { allowed: true, why: "local", target: t };
  if (t && (t.scheme === "http" || t.scheme === "https") && isLoopback(t.host)) return { allowed: true, why: "loopback", target: t };

  const mode = policy.destinations;
  if (mode === "any") return { allowed: true, why: "any", target: t };
  if (mode === "none") {
    if (inbound) return { allowed: true, why: "inbound", target: t };
    throw new DestinationRefusedError({ reason: "sealed", kind, target: t, policy });
  }

  const l = list ?? loadDestinations({ env });
  if (l.state === "missing") throw new DestinationRefusedError({ reason: "missing_list", kind, target: t, policy, list: l });
  if (l.state !== "ok") throw new DestinationRefusedError({ reason: "no_list", kind, target: t, policy, list: l });
  if (!t) throw new DestinationRefusedError({ reason: "unreadable", kind, target: t, policy, list: l });
  // An https endpoint is approved as https. The same host over plain http carries the same material
  // in the clear, so it is not the destination that was approved.
  if (kind === "https" && t.scheme !== "https") throw new DestinationRefusedError({ reason: "unlisted", kind, target: t, policy, list: l });
  const entry = matchDestination(t, kind, l);
  if (!entry) throw new DestinationRefusedError({ reason: "unlisted", kind, target: t, policy, list: l });
  return { allowed: true, why: "approved", target: t, entry: { kind: entry.kind, line: entry.line } };
}

/** What the list holds and whether it applies, for preflight and `cortex-destinations.mjs status`. */
export function destinationStatus({ policy, env = process.env } = {}) {
  if (!policy || !DESTINATION_MODES.includes(policy.destinations)) {
    throw new TypeError("destinationStatus: a profile policy with `destinations` is required");
  }
  const l = loadDestinations({ env });
  const kinds = {};
  for (const e of l.entries) kinds[e.kind] = (kinds[e.kind] ?? 0) + 1;
  return {
    mode: policy.destinations,
    applies: policy.destinations === "approved",
    path: l.path,
    from: l.from,
    state: l.state,
    entries: l.entries.length,
    kinds,
    problems: l.problems,
  };
}

/** One sentence per problem, for a caller to pass on. Never repeats the line's text. */
export function destinationNotes(problems) {
  return (problems ?? []).map((p) => `approved-destinations line ${p.line} ${p.why}.`);
}
