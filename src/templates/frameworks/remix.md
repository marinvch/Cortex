## Remix Conventions

### Project Structure

- `app/routes/` — file-based routing (flat file or folder convention)
- `app/root.tsx` — root layout, global `<Links>`, `<Meta>`, error boundary
- `app/entry.client.tsx` / `app/entry.server.tsx` — hydration entry points (can omit to use defaults)
- Public assets in `public/`

### Data Loading

- `loader()` runs on the server per-route — fetch data, return `json()` or `redirect()`
- `useLoaderData<typeof loader>()` in the component for type-safe data access
- `clientLoader()` for client-side fetching (opt-in); prefer server `loader()` by default
- Pass `request` into `loader` and `action` — never read `window` or `document` in loaders

### Forms & Mutations

- `action()` handles form submissions on the server — return `json()` or `redirect()`
- Use native `<Form>` from Remix, not `<form>` — handles progressive enhancement
- `useFetcher()` for non-navigation mutations (optimistic UI, background saves)
- Validate with Zod in actions; return field errors as `json({ errors })` with status 400

### Error Handling

- Each route can export `ErrorBoundary` to catch route-level errors
- Use `isRouteErrorResponse()` to distinguish HTTP errors from unexpected throws
- Root `ErrorBoundary` catches all unhandled errors

### Styling

- Any CSS approach works; Remix supports CSS Modules, Tailwind, Vanilla Extract
- Import CSS in route modules or `root.tsx` — Remix handles `<link>` injection
- `links()` export for per-route stylesheets and preloads

### Meta & SEO

- `meta()` export per route — returns array of `{ title }`, `{ name, content }` descriptors
- Root `meta()` is the fallback — child routes merge or override

### Performance

- Deferred data: `defer()` in loader + `<Await>` + `<Suspense>` for non-critical data
- Prefetching: `<Link prefetch="intent">` or `"render"` for anticipatory loads
- Use `shouldRevalidate()` to skip unnecessary re-runs of loaders after mutations
