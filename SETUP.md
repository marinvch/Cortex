# Setup

## Requirements
- **Personal layer:** none. Just Claude Code (or any AGENTS.md-aware agent).
- **Engine (optional):** Node ≥ 20, for when you point Cortex at code.

## Steps
1. **Clone** this repo:
   ```bash
   git clone https://github.com/<user>/cortex.git cortex && cd cortex
   ```
2. **Open in Claude Code.**
3. **Run `/onboard`.** It interviews you and writes `context/*` (gitignored — never committed).
4. **(Optional) Enable the engine** for a code project:
   ```bash
   npx cortex --init --cwd projects/<name>
   ```

## What gets created
- `context/` — your identity (gitignored)
- `brain/` — your memory (gitignored)
- `decisions/` — your decision log (gitignored)

None of these are ever committed or published. Only the shared template is.
