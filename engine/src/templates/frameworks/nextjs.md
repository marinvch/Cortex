## Next.js App Router Conventions

### Architecture
- Pages live in `app/` using **file-system routing** (App Router, Next.js 13+)
- Layouts in `app/layout.tsx`, pages in `app/[route]/page.tsx`
- API routes in `app/api/[route]/route.ts`
- Server Components are the **default** — only add `'use client'` when hooks or browser APIs are needed

### Component Rules
- `'use client'` only for: `useState`, `useEffect`, event handlers, browser APIs
- Server Components fetch data directly (no useEffect + fetch)
- Shared UI primitives in `components/ui/`; feature components in `components/`
- **Never** call `fetch('/api/...')` from Server Components — use direct service/DB calls

### Data Fetching
- Server data: fetch in Server Components or `generateMetadata`
- Client mutations: use server actions or `fetch` to API routes
- Revalidation: `revalidatePath()` / `revalidateTag()` after mutations

### TypeScript
- Strict mode enabled — no implicit `any`
- Use `Awaited<ReturnType<...>>` for async function return types
- Page props: `{ params, searchParams }` typed via `PageProps` convention

### Performance
- Prefer `next/image` over `<img>` for all images
- Prefer `next/font` for font optimization
- Use `React.Suspense` + `loading.tsx` for async boundaries
- Use `dynamic()` for heavy client-only components

### Routing
- Auth-guarded pages: redirect in Server Component using `redirect()`
- Never use `useRouter().push()` in Server Components
