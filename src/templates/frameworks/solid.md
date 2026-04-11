## SolidJS Conventions

### Core Principles

- Solid is **not** React — do not use React mental models
- Reactivity is based on **signals**, not virtual DOM diffing
- Components run once; only reactive primitives (`createSignal`, `createEffect`, etc.) re-run

### Reactivity Primitives

- `createSignal<T>(initial)` → `[get, set]` tuple — call `get()` to read inside JSX
- `createMemo(() => derived)` for computed values — replaces useMemo
- `createEffect(() => { ... })` for side effects — automatically tracks dependencies
- `createStore(obj)` for nested reactive objects via Solid Store with `produce()`
- Never destructure props — `props.name` preserves reactivity; `const { name } = props` breaks it

### Control Flow (use Solid built-ins, not JS expressions)

- `<Show when={condition()}>` — conditional rendering (not `{cond && <A/>}`)
- `<For each={list()}>` — keyed list rendering (not `.map()`)
- `<Switch>` / `<Match when={...}>` — multi-branch conditional
- `<Suspense>` for async boundaries

### Component Patterns

- Prefer typed props interface: `interface Props { name: string; onClick: () => void; }`
- `splitProps(props, ['class'])` to separate own props from spread-through props
- `mergeProps(defaults, props)` for default prop values — do not use destructuring defaults

### Routing (SolidStart or @solidjs/router)

- File-based routing with SolidStart: `src/routes/` directory
- `useParams()`, `useSearchParams()`, `useNavigate()` from `@solidjs/router`
- Data fetching: `createResource(fetcher)` or SolidStart `createServerData$()`

### Styling

- Any CSS approach works: CSS Modules, Tailwind, UnoCSS
- `class:` directive for conditional classes: `<div class:active={isActive()}>`
- `classList={{ active: isActive() }}` for object-style conditional classes

### Testing

- `@solidjs/testing-library` + Vitest
- Wrap assertions in `act()` or flush effects manually when testing reactive code
