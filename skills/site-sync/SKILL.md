---
name: site-sync
description: Bring Cortex's own public docs site back in line with the source after a release — refresh its site-facts.json, redraft only the pages whose sources changed, show the diff, and open a PR on the site repo once the user approves. Use when a `site-drift` issue is open, when `cortex-site-facts.mjs --check` reports drift, or on "sync the site", "the site is out of date", "update the docs site". Maintains the Cortex site only, not a user's docs.
capability: judgment
---

# /site-sync — keep the public site true to the code

The public site restates facts that live in this repository, and a copy with no check drifts: it sat
at v0.15 for four months while the product became something else (#415). The facts pages now render
from `site-facts.json`, so they only need that file refreshed. The prose pages still need a person —
this ritual drafts them from what changed and stops before anything is published.

The site repo is `marinvch/cortex-site` unless `CORTEX_SITE_REPO` names another. Its `main` branch
deploys to the public site. **Never push to it** — every change goes through a PR the user merges.

## 1. Is there drift

Clone the site into the OS temp dir — never inside this repository, which holds the product and
nothing else — and compare:

```bash
site="${CORTEX_SITE_REPO:-marinvch/cortex-site}"
dir="$(mktemp -d)/site"
gh repo clone "$site" "$dir" -- --depth 50
node "${CLAUDE_PLUGIN_ROOT}/tools/cortex-site-facts.mjs" --check "$dir/site-facts.json"
```

Exit `0`: say the site matches the source, name the version it matches, and **stop**. Exit `2`: the
facts could not be read from this checkout — report the message; that is a Cortex bug, not drift.
Exit `1`: each line it prints is one changed fact. Keep them; they are the change list.

## 2. What changed since the site's version

The `version` in the site's `site-facts.json` is the release the site was last synced to. Read what
landed after it, in the files a page is written from:

```bash
was="$(node -e 'console.log(require(process.argv[1]).version)' "$dir/site-facts.json")"
git log --oneline "v$was..HEAD" -- README.md CONTEXT.md AGENTS.md docs/ skills/ mcp/AGENTS.md index/AGENTS.md tools/README.md
```

Read the `CHANGELOG.md` entries above `## [$was]` as well — they say **why**, which the page prose
needs and the log does not carry. If the tag `v$was` does not exist, fall back to the changelog and
say so.

## 3. Which pages it touches

[PAGES.md](PAGES.md) maps every route to the source files it is written from. A page is affected
when one of its sources appears in step 2's log, or when step 1 named a fact it shows.

- **Facts pages** need nothing but the refreshed file:
  `node "${CLAUDE_PLUGIN_ROOT}/tools/cortex-site-facts.mjs" --out "$dir/site-facts.json"`.
- **Prose pages** need a draft. Read the changed sources and the page as it stands; change only the
  sentences the source change made false or incomplete. Keep the page's voice and structure — this
  is an update, not a rewrite.

A changed source that no route lists is a gap in PAGES.md, not a page to invent. Say which file it
was and stop there for that change.

## 4. Show the diff, then stop

Build the site to prove the drafts compile, then show the user everything that would change:

```bash
(cd "$dir" && npm ci && npm run build) && git -C "$dir" diff --stat && git -C "$dir" diff
```

List each page with a one-line reason tied to a source change or a fact line from step 1. Then
**stop and ask** — the same consent gate `/cortex-install` holds. Nothing is committed, pushed or
opened until the user says which changes to keep. A dropped page is reverted in the clone, not
edited around.

## 5. On approval, open a PR

```bash
git -C "$dir" switch -c "sync/v$(cat "${CLAUDE_PLUGIN_ROOT}/VERSION")"
git -C "$dir" commit -am "Sync the site to Cortex v$(cat "${CLAUDE_PLUGIN_ROOT}/VERSION")"
git -C "$dir" push -u origin HEAD
gh pr create --repo "$site" --fill
```

Give the user the PR URL and the pages it changes. If a `site-drift` issue is open on this
repository, comment the PR link on it; CI closes the issue once the site's facts match again.

## What this ritual does not do

It does not merge the PR, deploy the site, or rename its repo — those publish, and the user does
them. It does not keep a user's own docs site in sync; it knows one site and one mapping.
