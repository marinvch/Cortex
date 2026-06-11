# Cortex — your personal AI brain

Cortex is a personal AI operating system. Clone it, open it in Claude Code, run `/onboard`.
It learns who you are and how you work, then **keeps itself alive** — when you point it at
code, the `ai-os` engine re-scans, refreshes context, and reconciles memory for you.

> Not affiliated with `nateherkai/AIS-OS`. Cortex is the `ai-os` engine (kernel) plus a
> clone-and-go userland.

## Why Cortex
- **Alive** — it maintains itself (engine-backed), not a static folder of notes.
- **Bounded** — a strict three-domain data model; company/client data never leaks upward.
- **Sovereign** — plain files, MIT, forkable, no cloud lock-in.

## Quick start
1. Clone and open in Claude Code.
2. Run `/onboard`. (No Node needed for the personal layer.)
3. Use `/audit` weekly and `/level-up` biweekly to grow it.

See `SETUP.md` to begin and `references/getting-started.md` for the walkthrough.

## For developers
The kernel is a TypeScript engine that scans any repo and generates AI-context artifacts.
Its full docs and source live in [`engine/`](./engine/README.md).

## License
MIT — covers both the userland and the engine.
