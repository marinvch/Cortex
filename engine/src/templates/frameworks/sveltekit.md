## SvelteKit Conventions

### Architecture
- Pages in `src/routes/` using file-system routing (`+page.svelte`, `+layout.svelte`)
- Server-side logic in `+page.server.ts` (load functions, form actions)
- API routes as `+server.ts` files under `src/routes/api/`
- Shared components in `src/lib/components/`, utilities in `src/lib/`

### Data Loading
- Use `load()` in `+page.server.ts` for server-only data (DB, secrets)
- Use `load()` in `+page.ts` for data that can run on client AND server
- Return plain objects from `load()` — they are serialized via `devalue`
- Use `$page.data` to access loaded data in components

### Form Actions
- Prefer `<form>` + `use:enhance` + server actions over manual `fetch` calls
- Define actions in `+page.server.ts` with `actions: { default, namedAction }`
- Progressive enhancement: forms work without JS, enhanced with `use:enhance`

### State Management
- Svelte stores for shared app state (`writable`, `readable`, `derived`)
- Avoid global stores for data that belongs to a route — use `load()` instead
- `$state` (Svelte 5 runes) preferred for component-local reactive state

### TypeScript
- Full TypeScript everywhere — `src/app.d.ts` for global type augmentation
- Generated types in `.svelte-kit/types/` — do not edit manually
- `PageData`, `LayoutData`, `ActionData` types generated per route

### Testing
- Vitest for unit/logic tests; Playwright for end-to-end tests
- `@testing-library/svelte` for component tests
- Mock `fetch` in server load function tests
