# ADR 0015 — a profile is the world an install serves

**Status:** accepted · 2026-08-19 · Cortex 2.12.0

## Context

The employer firewall is the hardest rule Cortex has. It opens by stating a premise:

> **One vault instance holds exactly one world.**

and then immediately fixes that world to *personal*: "This instance is the personal machine." Every
ritual restates the consequence — `/onboard` never asks for employer detail, `/capture` refuses
day-job material, `/audit` treats employer content as a critical finding.

Two problems followed from the premise being true and the value being hardcoded.

**A work machine could not say so.** The manual's own answer is "a separate vault instance on the
work machine", but nothing in the product could express that. The work install ran the same rituals,
carrying the same prose telling it to refuse the very material it existed to hold.

**The rule was prose everywhere and code nowhere.** Grepping `core/`, `index/` and `mcp/` for
"firewall" returns one hit, in an unrelated test. `core/scrub.js` refuses credentials, which is a
different rule. So the firewall was enforced entirely by agents reading and obeying twelve
restatements of it.

## Decision

**A profile declares which world an install belongs to: `home`, `work` or `lab`.**
`core/profile.js` owns it.

|  | refuses | outward sync |
|---|---|---|
| `home` (default) | employer and client material | yes |
| `work` | personal material | yes |
| `lab` | nothing | **no** |

`home` and `work` are the same rule read from opposite sides. `work` is not "the firewall off" — it
is the firewall pointed the other way, because a private note filed into a work brain is the mirror
of the leak `home` guards against, and the two installs never sync.

### `lab` refusing nothing and publishing nothing is one decision

A profile that refused nothing locally and still pushed would be a way to switch the firewall off
and keep leaking — the leak with extra steps. So `lab` seals outward sync, and that is the half a
machine can actually enforce: `mcp/lib/capture.js` still *writes* the team note (sealing must not
lose work) and returns `pushed: false, error: "outward_sync_disabled"` rather than a silent success.

Permissive-locally and sealed-outward are stored as one policy object precisely so they cannot drift
apart later.

### Declared, never detected

A work laptop and a home laptop have the same shape on disk. There is nothing honest to detect, so
`CORTEX_PROFILE` declares it — the same reasoning that made `server` a declared audience in
[ADR 0008](0008-three-audiences-one-seam.md), for the same reason.

Inferring the profile from a hostname or a path would be a guess about which secrets are safe to
write down.

### The default is `home`, and it fails safe

An undeclared work machine gets the strict-about-employer-content firewall. The worst case is a
refused write someone wanted. The opposite default would let an undeclared machine behave like a
lab, which is a leak rather than an inconvenience.

### An unknown value is fatal

`CORTEX_PROFILE=works` throws instead of falling back. A typo resolving quietly to `home` looks
identical to a correct home install while the user believes the firewall points the other way — a
silent wrong answer, which is the failure mode this whole area exists to avoid.

## The third axis

```
mode      mcp/lib/mode.js      repo | vault           what KIND of brain this root is
audience  mcp/lib/resolve.js   solo | team | server   WHO it serves
profile   core/profile.js      home | work | lab      WHICH WORLD it belongs to
```

ADR 0008 argues that welding `mode` and `audience` together would guarantee a future bug where
changing one silently changes the other. The same argument applies to the third: a work laptop can
run a repo-mode brain on a team, and a lab box can hold a personal vault nobody else sees. All three
combinations are real, so all three axes stay independent. `core/profile.js` reads **only**
`CORTEX_PROFILE` — nothing about the root, the connector or the cwd can move it, and a test asserts
that.

## Why `core/` and not `mcp/lib/`

`mode` and `audience` are MCP-server concerns, resolved to serve tools. A profile is **policy**, and
it sits beside `core/scrub.js` — the other policy gate — because rituals, the server and any future
CLI all need the same answer. `core/` depends on nothing, so nothing is welded by putting it there.

## Consequences

- The server's startup line now prints all three axes, so a mismatch is visible at a glance rather
  than inferred from behaviour.
- `/cortex-profile` reports and sets it, and is required to explain the consequence before setting —
  a profile decides what Cortex will refuse to write.
- The firewall's prose can now say *which* profile it describes instead of asserting one world.
- **Twelve ritual restatements are still prose.** This ADR does not make the firewall
  code-enforced — detecting "employer content" deterministically is not possible, and pretending
  otherwise would be worse than the honest prose. What moved into code is the axis and the one
  enforceable consequence.
