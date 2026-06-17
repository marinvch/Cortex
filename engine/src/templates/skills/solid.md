# SolidJS Patterns — {{PROJECT_NAME}}

## Signal & Reactivity

```typescript
import { createSignal, createMemo, createEffect } from 'solid-js';

// Signal — always call getter inside JSX or effects
const [count, setCount] = createSignal(0);
const doubled = createMemo(() => count() * 2); // derived, not re-computed unnecessarily

createEffect(() => {
  console.log('count changed:', count()); // auto-tracked
});
```

## Component Structure

```typescript
// Never destructure props — preserves reactivity
interface Props {
  title: string;
  onClose: () => void;
  isLoading?: boolean;
}

export function MyComponent(props: Props) {
  return (
    <Show when={!props.isLoading} fallback={<Spinner />}>
      <div>{props.title}</div>
      <button onClick={props.onClose}>Close</button>
    </Show>
  );
}
```

## Control Flow (use Solid built-ins)

```typescript
import { Show, For, Switch, Match } from 'solid-js';

// Conditional — NOT ternary or && in JSX
<Show when={isLoggedIn()} fallback={<Login />}>
  <Dashboard />
</Show>

// List — NOT .map()
<For each={items()}>
  {(item) => <ItemCard item={item} />}
</For>

// Multi-branch
<Switch fallback={<NotFound />}>
  <Match when={status() === 'loading'}><Spinner /></Match>
  <Match when={status() === 'error'}><ErrorMessage /></Match>
  <Match when={status() === 'success'}><Content /></Match>
</Switch>
```

## Store for Nested State

```typescript
import { createStore, produce } from 'solid-js/store';

const [state, setState] = createStore({ items: [] as Item[], filter: '' });

// Granular update — only affected subscribers re-run
setState('items', (items) => [...items, newItem]);
setState(produce(s => { s.filter = 'active'; }));
```

## Props Utilities

```typescript
import { splitProps, mergeProps } from 'solid-js';

// Split own props from HTML-passthrough props
const [local, rest] = splitProps(props, ['class', 'onClick']);

// Default values — do NOT use destructuring defaults
const merged = mergeProps({ variant: 'primary', size: 'md' }, props);
```
