# Security policy

## Supported versions

Cortex is maintained by one person and released often. Security fixes land on `master` and ship in
the next release; only the **latest minor release** receives them. If you are on an older release,
the fix is to update (`claude plugin marketplace update cortex`, then `claude plugin update
cortex@cortex`).

## Reporting a vulnerability

**Please do not open a public issue for a vulnerability.**

Report it privately through GitHub: on [marinvch/Cortex](https://github.com/marinvch/Cortex), open
the **Security** tab and choose **Report a vulnerability**
([direct link](https://github.com/marinvch/Cortex/security/advisories/new)). That creates a private
security advisory only the maintainer can see.

If that button is not available to you, open a public issue that says only that you have a security
report and asks for a private channel — no details, no proof of concept.

Useful to include: the Cortex version (`VERSION`), what you ran, what happened, and what you
expected. If it involves a secret, a name or personal data, describe its shape, never the value.

## What to expect

- An acknowledgement when the report has been read. This is a personal project, so that is
  best-effort, typically within a week, not a contractual response time.
- A fix, or an explanation of why the behaviour is intended, in the private advisory before
  anything is made public. You are credited in the advisory and the changelog unless you ask not to
  be.
- No bounty. There is no budget for one.

## Scope

In scope — the code in this repository and what it writes into other repositories:

- the secret gate, the employer denylist and the personal-data scan (`core/scrub.js`,
  `core/denylist.js`, `core/gate.js`): anything that lets a credential, a denylisted name or
  personal data be published while the gate says it refused, or that makes a refusal echo the value;
- path safety: a write or delete that escapes its root (`core/paths.js`, `tools/_cortex-lib.sh`);
- the MCP server (`mcp/`): a tool that writes, pushes or reads outside what its declaration says;
- the files `/cortex` stamps (`templates/loop/`): a workflow or hook that runs code a team did not
  review, leaks a secret, or can be steered by a pull request from a fork;
- `tools/server/cortex-cron.sh`: anything it sends or pushes past the scrubber.

Out of scope:

- vulnerabilities in Claude Code, GitHub Actions, git or Node themselves — report those to their
  owners;
- what a model does with instructions in a repository's own files (prompt injection by the
  repository's own authors);
- the absence of a check that the documentation already calls a floor — for example an employer
  name you did not put in your denylist, or personal data with no detectable shape.

## Installing safely

Install Cortex as a Claude Code plugin, or from a clone of a **tagged release**. Do not pipe a
script from `master` into a shell: it runs whatever the branch holds at that minute. The workflows
`/cortex` stamps pin Cortex to a release and verify its code against a digest taken at stamp time
([ADR 0028](docs/adr/0028-stamped-ci-verifies-cortex-by-content-digest.md)), and install Claude Code
by a pinned npm version.
