# Remix Patterns — {{PROJECT_NAME}}

## Route & Loader Pattern

```typescript
// app/routes/items.$id.tsx — server-side data loading
import { json, type LoaderFunctionArgs } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';

export async function loader({ params }: LoaderFunctionArgs) {
  const item = await getItem(params.id!);
  if (!item) throw new Response('Not Found', { status: 404 });
  return json({ item });
}

export default function ItemPage() {
  const { item } = useLoaderData<typeof loader>();
  return <div>{item.name}</div>;
}
```

## Action & Form Pattern

```typescript
// app/routes/items.new.tsx — mutation with progressive enhancement
import { redirect, type ActionFunctionArgs } from '@remix-run/node';
import { Form, useActionData } from '@remix-run/react';
import { z } from 'zod';

const schema = z.object({ name: z.string().min(1) });

export async function action({ request }: ActionFunctionArgs) {
  const form = Object.fromEntries(await request.formData());
  const result = schema.safeParse(form);
  if (!result.success) {
    return json({ errors: result.error.flatten().fieldErrors }, { status: 400 });
  }
  await createItem(result.data);
  return redirect('/items');
}

export default function NewItem() {
  const actionData = useActionData<typeof action>();
  return (
    <Form method="post">
      <input name="name" />
      {actionData?.errors?.name && <p>{actionData.errors.name[0]}</p>}
      <button type="submit">Create</button>
    </Form>
  );
}
```

## Error Boundary

```typescript
import { isRouteErrorResponse, useRouteError } from '@remix-run/react';

export function ErrorBoundary() {
  const error = useRouteError();
  if (isRouteErrorResponse(error)) {
    return <h1>{error.status} — {error.data}</h1>;
  }
  return <h1>Something went wrong</h1>;
}
```

## Optimistic UI with useFetcher

```typescript
const fetcher = useFetcher();
const isDeleting = fetcher.state !== 'idle';

<fetcher.Form method="post" action={`/items/${id}/delete`}>
  <button disabled={isDeleting}>{isDeleting ? 'Deleting…' : 'Delete'}</button>
</fetcher.Form>
```
