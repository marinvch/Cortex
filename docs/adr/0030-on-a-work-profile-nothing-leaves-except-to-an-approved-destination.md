# 0030. On a work profile, nothing leaves the machine except to a destination the company approved

**Date:** 2026-10-25
**Status:** accepted

## Context

A `work` profile ([ADR 0015](0015-a-profile-is-the-world-an-install-serves.md)) holds company
material by definition. Its firewall points at personal notes, and nothing in code asked where the
company material went once it was written. Cortex sends it to five kinds of place:

- the team-brain's git remote, on every `capture`, `ask`, `answer`, project file, contract and
  member change, and on `team init`;
- the same remote when it pulls or clones;
- the trackers a team selected (#624): GitHub, a ServiceNow instance, a Jira site;
- the Anthropic API, when `tools/server/cortex-cron.sh` summarises the day;
- the brain's remote again, when the cron pushes its digest.

Any of these can point somewhere the company never approved, and nothing would notice: a
team-brain created on someone's personal GitHub, a tracker URL with a typo in the tenant, a
remote rewritten by an `insteadOf` in a global git config, a cron on a box whose `CORTEX_API_URL`
was copied from an example. The material is the employer's. The person who ran the command is the
one who answers for it, and for an employee that can be their job. For the employer it is a
disclosure to a party it has no agreement with.

The secret gate and the employer denylist look at the text. This is a question about the address.

## Decision

**On a profile whose policy says `destinations: "approved"` (`work`), every outward call is made
only when its destination is on the company's approved list.**

- **The policy is data** in `core/profile.js`: `destinations` is `any` on `home`, `approved` on
  `work` and `none` on `lab`, beside `outwardSync`. Lab's `none` is the same seal as its
  `outwardSync: false`, stated as a destination rule; a pull or a clone (inbound) is still allowed
  there, as it always was.
- **The list lives outside every repository**: `CORTEX_DESTINATIONS`, else
  `~/.cortex/allowed-destinations`, so IT can deploy it by device management. One
  `<kind>: <host>[/<path-prefix>]` per line: `git: github.com/your-org`,
  `https: your-org.service-now.com`, `npm: registry.npmjs.org`. A bad line is a problem with its
  line number and the others still apply, the way the denylist works (ADR 0026).
- **`core/destinations.js` `assertDestination` is the one check**, and every outward point calls it
  before it starts: `pull`, `commitAndPush` and `pushHead` in `mcp/lib/gitsync.js` (over every URL
  git resolves for the clone's remotes, push URLs for a push), `cloneTeamBrain` and the push in
  `initTeamBrain`, and `request` in `mcp/lib/trackers/http.js`. The policy is a required option, so
  a caller that forgets it fails in its tests rather than pushing unchecked. The shell half asks
  `tools/cortex-destinations.mjs`, and `cortex-cron.sh` checks before the pull, the API call and
  the push.
- **It fails closed.** No file, or a `CORTEX_DESTINATIONS` that names no readable file, refuses
  every outward call on `work`. The refusal says how to write the file, and
  `tools/cortex-preflight.mjs` reports the state.
- **Matching is exact.** The host is compared whole and case-insensitively. A path prefix matches
  whole segments. There is no wildcard and no suffix match. An address that cannot be parsed is
  refused, not guessed at.
- **The same machine is always allowed**: a local path, a `file://` URL, and http(s) on a loopback
  host. A UNC path is another machine, and its server is the host.
- **A refusal keeps the local work.** A capture or an ask is still written and committed; the
  result says `pushed: false` with `unapproved_destination: …` and the host and path, never the
  userinfo or a credential.
- **Personal data is refused on `work` by default** (`pii: "refuse"`); the amendment to
  [ADR 0027](0027-personal-data-in-committed-memory-is-warned-about-and-erasable.md) records it.

## Alternatives rejected

| Option | Why not |
|---|---|
| Keep the approved list in the team-brain itself | Whoever owns the team-brain writes the list. On a personal remote that is the very person the list exists to stop, and their brain would carry a permissive list of its own |
| Warn and push anyway | The push is the harm. A warning after the material is on someone else's server tells the person what they can no longer undo |
| Match a domain suffix (`*.acme.com`, or `acme.com` approving its subdomains) | A suffix match is how `github.com` ends up approving `evilgithub.com` or `github.com.evil.example`, and how one approved tenant on a shared host approves every other tenant on it |
| No file means no check, as the denylist does | The denylist is a list of what to refuse, so an empty one refuses nothing and is safe. This is a list of what to allow; treating an empty one as "allow everything" makes every existing work install keep pushing anywhere until someone remembers to write a file |
| Check `origin`'s fetch URL only | A `pushurl`, an `insteadOf` rewrite or an upstream on another remote is where a push actually goes. git resolves those for `remote get-url --all --push`, and the check reads that |
| Read the profile name at each call site | Policy as data is what keeps `lab`'s two halves one decision (ADR 0015). A call site that tests `profile === "work"` is the next one that forgets |

## Consequences

- **Existing work installs stop pushing until the file exists.** Captures, asks and answers are
  still written and committed locally, and each result says why it was not pushed. Pulls and
  clones are refused as well, since they hand the remote the company's credentials and the
  repository's name. `tools/cortex-preflight.mjs` and `node tools/cortex-destinations.mjs status`
  say what to write.
- A work team that syncs asks to GitHub issues must approve `https: api.github.com` as well as the
  git host: the API is a different destination from the remote.
- A cron server with only `cortex-cron.sh` copied onto it, and no checker, sends nothing on `work`
  or `lab`. That is the same choice the scrubber made: nothing unchecked leaves.
- `lab`'s cron no longer pushes to a remote host. It used to, which was the seal leaking.
- **The check is about addresses, not intent.** A loopback port can be a tunnel to somewhere else,
  and an approved host can be misused. The list is only as good as what the company put on it.
- Every outward call on `work` reads one small file. A cached list would miss an edit IT just
  deployed.
- A new outward path must call `assertDestination` too. `docs/changing-cortex.md` says so, and
  `mcp/test/destinations.test.js` pins the ones that exist.
