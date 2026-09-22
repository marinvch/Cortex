# intent/

Where an idea becomes a committed artifact.

This folder is the start of the chain. An idea lands here as `intent.md`, a product owner accepts
it, and that acceptance is what triggers the design pass. The chain runs:

```
intent.md  →  spec.md  →  plan.md  →  the diff and its tests  →  the PR  →  the release
     ↑                                                                          │
     └──────────────  a breached control band writes the next one  ─────────────┘
```

Every stage ends by committing a file the next stage reads, so the git history is the audit trail:
who asked for what, what the agent produced, and who approved it.

## How to add one

Copy `TEMPLATE.md` to `<short-name>.md` and write it in your own words. Brainstorm with Claude
first if it helps — describe what you cannot do today, who is affected, what better looks like, and
what is out of scope. Then correct whatever Claude misunderstood, and commit.

You do not need to be an engineer and you do not need to use git directly; a version-control
connector lets Claude commit the file for you.

## Who accepts one

{{OWNER}} reviews and accepts. The accept-or-reject decision is recorded as the merge or the
closing review — that record is the governance evidence, so decisions are not made in chat.

## Where the record lives

This repo is the source of truth for intent. {{LEGACY_NOTE}}
