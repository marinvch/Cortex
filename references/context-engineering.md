---
type: reference
title: Context Engineering
updated: 2026-08-04
tags: [reference, framework, agents]
---

# Context Engineering

How to write context an AI agent reads well. Applies to any `AGENTS.md`, `CLAUDE.md`, skill body,
or rules file — in this vault or in a repo Cortex installs into.

The premise: newer models handle ambiguity well, so exhaustive rules cost tokens without buying
behavior. Every byte in an always-loaded file is re-read every session; the cost recurs while the
value decays.

## Rule 1 — Trust judgment over enumeration
Write the principle ("match the surrounding style"), not every case. Be prescriptive only where a
mistake is destructive or unrecoverable.

## Rule 2 — Progressive disclosure
Detail loads at the moment it's used, not every session. Long templates, reference tables and
worked examples go in a `templates/` or `reference/` file the body points at. Nested `AGENTS.md`
leaves ([[nested-briefs]]) are this rule applied to directories.

## Rule 3 — Don't restate what's discoverable
Cut what the agent can read from the code itself: file trees, dependency lists, script names,
framework versions. **Test per line, not per section** — a directory listing is waste, but one line
inside it saying "do not touch, still imported by billing" is the most valuable line in the file.

## Rule 4 — One canonical copy
A fact lives in exactly one file; everything else points at it. Shims hold a pointer, never their
own copy — copies drift silently.

## Rule 5 — Repetition is sometimes load-bearing
Deliberate repetition of a safety control is not redundancy. Before cutting a repeated rule, ask
what breaks if only one copy survives. Rules 1–4 never override this one.

## Applying it
`/optimize-context` audits a repo against these rules. `/skill-creator` follows them when writing a
new ritual. `/scope-area` is Rule 2 for directories.

Related: [[vault-architecture]] · [[nested-briefs]] · [[operating-principles]]
