## Deno Runtime Conventions

### Project Setup

- `deno.json` / `deno.jsonc` is the project config — defines tasks and imports
- Import maps in `deno.json` `"imports"` field instead of `node_modules`
- Use `deno task <name>` to run scripts (equivalent to npm scripts)
- No `package.json` required; use JSR (`jsr:`) or npm specifiers (`npm:`) where needed

### TypeScript

- Deno supports TypeScript natively — no compilation step in dev
- Strict TypeScript enabled by default; configure via `compilerOptions` in `deno.json`
- Top-level `await` supported natively in all modules

### Imports

- Use remote imports with explicit version pins: `import { serve } from "jsr:@std/http@1.0.3";`
- Prefer JSR (`jsr:`) over `deno.land/x` for new packages
- Use `npm:` prefix for npm-compatible packages: `import express from "npm:express@4";`

### Standard Library

- Import from `jsr:@std/*` — covers: path, fs, http, assert, testing, streams, etc.
- Use `Deno.readTextFile` / `Deno.writeTextFile` for file I/O
- `Deno.env.get("KEY")` for environment variables (requires `--allow-env`)

### Permissions (Principle of Least Privilege)

- Declare required permissions in `deno.json` `"tasks"` rather than `--allow-all`
- Common: `--allow-net=api.example.com`, `--allow-read=./data`, `--allow-env=PORT`
- Never use `--allow-all` in production

### Testing

- Built-in test runner: `deno test`
- `Deno.test("name", () => { ... })` syntax
- `assertEquals`, `assertRejects` from `jsr:@std/assert`
- Test files end in `_test.ts` or `.test.ts`

### HTTP Server (Deno.serve)

- `Deno.serve({ port: 3000 }, handler)` for low-level HTTP
- `Hono` or `Oak` for routing and middleware on Deno
