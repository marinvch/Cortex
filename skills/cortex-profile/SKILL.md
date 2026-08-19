---
name: cortex-profile
description: Show or set which world this Cortex install serves — home, work or lab — which decides what the firewall refuses and whether anything is allowed to leave the machine. Use when setting up Cortex on a new machine, when a capture is refused and the user disagrees, or when they say "this is my work laptop", "which profile am I on", "why won't it let me write this", "set up cortex for work".
---

# /cortex-profile — which world this install serves

Cortex's firewall has always assumed a machine belongs to exactly one world. It just hardcoded that
world to *personal*, so every ritual restated the same rule in prose and no machine could say it was
anything else. The profile is that assumption, made declarable.

|  | refuses | can publish |
|---|---|---|
| **home** *(default)* | employer and client material | yes |
| **work** | personal material | yes |
| **lab** | nothing | **no** |

Three axes, and they move independently — see [ADR 0015](../../docs/adr/0015-a-profile-is-the-world-an-install-serves.md):

- **mode** — repo or vault. What kind of brain the root is.
- **audience** — solo, team or server. Who it serves.
- **profile** — home, work or lab. Which world it belongs to.

A work laptop can run a repo brain on a team; a lab box can hold a personal vault.

## 1. Report where things stand

```bash
node -e "import('./core/profile.js').then(m=>{const r=m.resolveProfile({env:process.env});console.log(r.profile, '('+r.source+')');console.log(r.policy.summary)})"
```

Or read it off the MCP server's startup line, which prints all three axes:

```
cortex: profile=home (default) audience=solo (...) mode=vault root=...
```

`source=default` means nobody declared one, so it fell back to `home`. Say that plainly — a default
is not a decision, and the user may not have realised they were relying on it.

## 2. Set it, if it is wrong

The profile is **declared, never detected**: a work laptop and a home laptop look identical on disk,
so there is nothing honest to infer. Set `CORTEX_PROFILE` where this machine's environment lives —
the shell profile, the MCP server entry in `~/.claude.json`, or the systemd unit on a server:

```bash
export CORTEX_PROFILE=work
```

A value that is not one of the three is a **hard failure**, not a fallback. `CORTEX_PROFILE=works`
would otherwise resolve quietly to `home` and look exactly like a correct home install while the
user believed the firewall pointed the other way.

## 3. Explain the consequence before they commit to it

Do not just set it. Say what changes, because a profile decides what Cortex will refuse to write:

- **home** — the firewall in `AGENTS.md`. Day-job material is refused and named, never sanitised and
  filed anyway. If they want work knowledge kept, it goes in a work install or the work repo's own
  `AGENTS.md` via `/install-project`.
- **work** — the same rule read from the other side. Employer material is expected; personal notes
  are what gets refused. The two installs never sync, so a private note filed into a work brain is
  the mirror of the leak `home` guards against.
- **lab** — nothing is refused, and *therefore* nothing is published: team push is disabled. Those
  two facts are one decision. A lab that refused nothing and still pushed would just be a way to
  switch the firewall off and keep leaking.

## 4. Check the profile matches the machine

A mismatch is the failure worth catching, and it is silent in both directions:

- `home` on a work laptop — every day-job capture is refused. Annoying, and safe. This is the
  intended failure direction.
- `work` on a personal machine — personal notes refused, and the brain fills with employer content
  on a machine that may sync to a personal remote. **Check `git remote -v` before leaving it set.**
- `lab` anywhere real — the firewall is off. Only correct on a machine whose contents are disposable.

If the user is unsure, `home` is the answer: it is the strictest about the material that causes the
most damage when it escapes.

## Don't

- **Never infer the profile from the repo, the hostname or the path.** A guess here is a guess about
  which secrets are safe to write down.
- **Never set `lab` to work around a refused write.** The refusal is the product working. If the
  content genuinely belongs somewhere, the answer is the other install, not a weaker firewall.
