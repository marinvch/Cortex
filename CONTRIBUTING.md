# Contributing to Cortex

Cortex is a personal AI operating system. The repo root is the shareable userland;
`engine/` is the Cortex kernel (an npm package). See `AGENTS.md` for the operating manual.

## Prerequisites

- **Node.js ≥ 22** (Node 20 is EOL). The repo pins the version in `.nvmrc` — run
  `nvm use` (or `fnm use`) before working so your local toolchain matches CI.
- Engine work happens in `engine/`. Install with `npm ci` (not `npm install`) so your
  `node_modules` matches the committed lockfile exactly — the same thing CI does.

## Local development (engine)

```bash
cd engine
nvm use            # picks up .nvmrc → Node 22
npm ci             # clean, lockfile-faithful install
npm run build      # tsc — must succeed locally before you push
npm run test       # vitest unit suite
npm run validate   # regression suite (the pre-merge gate)
```

If `npm run build` fails locally with `TS2591: Cannot find name 'process'` / `node:*`
errors, your `node_modules` is out of sync with the lockfile — delete it and re-run
`npm ci` on Node ≥ 22. Do **not** edit the lockfile by hand; regenerate it with the
Node version in `.nvmrc` so local and CI agree.

## CI and merge discipline

Every PR runs the **Cortex Validate** workflow:

- `validate-fast` — build + lint + unit tests + scorecard + **regression suite** + smoke.
- `test-matrix` — `npm ci && npm run build && npm run test` across
  {ubuntu, windows, macos} × {Node 22, 24}. **This is the required check.**

**Never merge while any check is failing, pending, or UNSTABLE.** Two red-master
incidents were caused by merging PRs whose checks were still running or red. A green
PR means *all* required checks have completed successfully — wait for them.

When you change anything under `engine/src/templates/`, generated artifacts, or MCP
tool definitions, run `npm run gen-mcp-docs` and commit the result — CI fails if
`engine/docs/mcp-tools.md` is stale.

## The data boundary (non-negotiable)

Never write project/company data into `shared` template files or into
`context/` / `brain/` directly. A fact moves only `project → personal`, only via the
sanitized `promote_to_brain` gate. See `AGENTS.md` → "The data boundary".
