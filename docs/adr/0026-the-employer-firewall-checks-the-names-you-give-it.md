# 0026. The employer firewall checks the names you give it

**Date:** 2026-10-24
**Status:** accepted

## Context

The `home` profile refuses employer and client material ([ADR 0015](0015-a-profile-is-the-world-an-install-serves.md)).
Until now, code enforced one consequence of that and prose enforced the rest. The code was the
project-file link check in `core/project-file.js`: a link whose host is a private network or a
tenant of a hosted work tool is refused on `home`. Everything else was twelve rituals told to refuse.

That left the most direct leaks with no check at all:

- The **text** of `capture`, `remember`, `ask` and `answer` was never compared with anything
  employer-shaped. A note naming the employer, a ticket key, or a client went through the gate,
  which looks only for credentials, and was committed or pushed.
- A **work repository on a public forge** has the same shape as a personal one, so the link check
  passes it, and says so: it is a floor.

ADR 0015 is right that employer content cannot be *detected*. Nothing can tell from a sentence that
it describes someone's day job. But the person knows the names that matter: the employer, its
domains, the ticket prefix, the organisation that owns the repos. A machine can match those exactly.

## Decision

**On a profile whose policy refuses employer material (`home`), every published write is refused
when its text matches an entry in the person's employer denylist.**

- **The list lives outside every repository.** `CORTEX_DENYLIST` names the file; otherwise it is
  `~/.cortex/employer-denylist`. A denylist is a list of exactly the names the firewall keeps out,
  so committing it anywhere — a vault included — would be the leak. `tools/test/no-private-names.test.sh`
  learned this about repo names: a denylist that must be published to work is the disclosure.
- **One entry per line, `kind: value`.** `org`, `domain` and `owner` are literal and match whole
  words, case-insensitively; a domain also matches its subdomains and an address at it. `ticket`
  is a case-sensitive regular expression (`EXC-\d+`), and `pattern` a case-insensitive one.
  `#` starts a comment.
- **It is applied at the gate, not by a ritual.** `core/gate.js` holds the publish gate, and both
  of its callers run the denylist: `append()` in `core/memory.js`, so `remember` and the
  `cortex-memory.mjs` CLI, and `assertPublishable` in `mcp/lib/tools.js`, so every tool declared
  `PUBLISHED` (`remember`, `capture`, `ask`, `answer`) and the `ai-os ask` / `answer` CLI.
  `core/project-file.js`'s writers and `publishContract` run it beside their own credential scan.
- **A refusal names the entry's kind and its line in the denylist**, never the text it matched and
  never the entry. The person has the file and can look; a log, a transcript or a CI annotation
  does not need the name.
- **Only `home` applies it.** The check reads `policy.refuses === "employer"`, the same question
  `profileRefusal` asks. `work` expects employer material — the firewall there points the other way,
  and "personal material" has no list a person could write. `lab` refuses nothing and publishes
  nothing, so there is nothing for a denylist to protect.
- **No file is no check, and is said.** With no file at the default path, nothing is compared and
  `cortex-preflight.mjs` prints `denylist  empty`, so `/cortex-profile` and every ritual that runs
  preflight can say the code check is off.
- **A `CORTEX_DENYLIST` that names no readable file refuses every published write on `home`.**
  Somebody asked for a list and is not getting it. A typo quietly meaning "check nothing" is the
  silent wrong answer ADR 0015 refuses for an unknown profile.
- **A bad line never crashes anything.** A regular expression that does not compile, an unknown
  kind, an empty value, or a pattern that matches empty text is a problem with its line number. The
  other lines still apply, preflight lists the problems, and each published write passes them on as
  a warning.

## Alternatives rejected

| Option | Why not |
|---|---|
| Detect employer content heuristically (company suffixes, "sprint", "standup") | ADR 0015's argument stands: a guess about which notes are safe. It would refuse ordinary personal notes and pass the ones that matter, and teach people to ignore it |
| Keep the denylist in the vault, beside `context/` | The vault is a git repo with a remote. The list of employer names would be committed to it — the exact content the firewall keeps out |
| Apply it on `work` too, as a list of personal names | A person cannot list their private life the way they can list an employer's domains, and a refusal on `work` would block the material that install exists for |
| A missing `CORTEX_DENYLIST` file means no check | A misspelt path would switch the check off while the person believes it runs |
| Echo the matched name in the refusal, to help | The refusal is read by a model and lands in transcripts; the person can open their own file |
| Fail every write while the list has a bad line | One typo would block all capture. A skipped line, reported every time, is visible without being a wall |

## Consequences

- The firewall now has a code-enforced half for the text people actually write, and the prose says
  which half is which: `templates/vault-AGENTS.md` and the README list what code refuses and what is
  still a ritual's floor.
- **It is only as good as the list.** An employer the person never wrote down, a nickname, a client
  named in passing — all still pass. The rituals' judgment stays the floor above it.
- Every published write on `home` reads one small file. That is a file read per call, accepted
  because a cached list would miss an edit the person just made.
- A denylist entry that is also an ordinary word (`org: Apple`) refuses every note that uses the
  word. That is the person's call to make, and the refusal names the line so it can be narrowed.
