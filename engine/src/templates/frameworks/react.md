## React (Vite/CRA) Conventions

### Component Rules
- Functional components only (no class components)
- `'use client'` / hooks always in `.tsx` files
- One component per file, filename matches component name (PascalCase)
- Custom hooks in `hooks/` with `use` prefix (e.g., `useAuth`, `useLocalStorage`)

### State Management
- Local UI state: `useState` / `useReducer`
- Server/async state: React Query (`useQuery`, `useMutation`) or SWR
- Global state (if needed): Zustand or Context API — never add Redux without discussion
- Form state: React Hook Form + Zod, or uncontrolled inputs

### Data Fetching
- All API calls go through a service layer in `lib/api/` or `services/`
- Never call raw `fetch` directly in components — wrap in a service function
- Handle loading and error states explicitly

### Styling
- Prefer Tailwind CSS utility classes
- CSS Modules for component-scoped styles if Tailwind not used
- No inline styles except for dynamic values

### Performance
- `React.memo` for pure presentational components with expensive renders
- `useMemo` / `useCallback` only when profiling shows a need (don't pre-optimize)
- Lazy load routes with `React.lazy` + `Suspense`
