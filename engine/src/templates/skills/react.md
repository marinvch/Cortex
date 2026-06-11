# React Patterns — {{PROJECT_NAME}}

## Component Structure

```typescript
// Feature component (PascalCase file + export)
interface MyComponentProps {
  title: string;
  onClose: () => void;
  isLoading?: boolean; // boolean props: is/has/show prefix
}

export function MyComponent({ title, onClose, isLoading = false }: MyComponentProps) {
  return (/* ... */);
}
```

## State Patterns

```typescript
// Local UI state — useState
const [isOpen, setIsOpen] = useState(false);

// Derived state — compute from props/state, don't sync
const filteredItems = items.filter(i => i.active); // NOT useState

// Shared state — lift to parent or use {{STATE_MANAGEMENT_COMMENT}}
```

## Custom Hooks

```typescript
// hooks/useDebounce.ts — reusable logic extracted from components
export function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debouncedValue;
}
```

## Event Handlers

```typescript
// handle prefix for all event handlers
const handleSubmit = (e: React.FormEvent) => {
  e.preventDefault();
  // ...
};

const handleDeleteFile = async (id: string) => {
  await deleteFile.mutateAsync({ id });
};
```

## Rendering Patterns

```typescript
// Conditional render — early return
if (isLoading) return <Skeleton />;
if (error) return <ErrorBoundary error={error} />;

// List render — always provide stable keys
{items.map(item => <Card key={item.id} item={item} />)}

// Null check before rendering
{user && <Avatar user={user} />}
```

## Performance

```typescript
// Only memoize when you have profiled a real problem
const expensive = useMemo(() => heavyComputation(data), [data]); // justified
const handler = useCallback(() => doSomething(), []); // justified for stable refs

// Lazy load heavy components
const PDFViewer = dynamic(() => import('./PDFViewer'), { ssr: false });
```
