# Next.js App Router Patterns — {{PROJECT_NAME}}

## Routing Rules

- Pages: `app/[route]/page.tsx`
- Layouts: `app/[route]/layout.tsx`  
- API routes: `app/api/[route]/route.ts`
- Loading: `app/[route]/loading.tsx`
- Error: `app/[route]/error.tsx`

## Server vs. Client Components

```typescript
// SERVER COMPONENT (default — no directive needed)
// ✅ Can: fetch data, access env vars, query DB
// ❌ Cannot: useState, useEffect, onClick, browser APIs
export default async function Page() {
  const data = await prisma.file.findMany();
  return <div>{/* render */}</div>;
}

// CLIENT COMPONENT
'use client';
// ✅ Can: useState, hooks, events, browser APIs
// ❌ Cannot: direct DB access, server-only imports
export function InteractiveWidget() {
  const [val, setVal] = useState('');
  return <input value={val} onChange={e => setVal(e.target.value)} />;
}
```

## Data Access Hierarchy

```
Server Component  →  direct DB/service call
Client Component  →  tRPC hook (useQuery/useMutation)
Streaming route   →  fetch('/api/chat') with EventSource/reader
```

## Auth-Guarded Page Pattern

```typescript
// app/dashboard/page.tsx
import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';

export default async function DashboardPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/auth/signin');
  return <DashboardClient />;
}
```

## Route Handler (API Route)

```typescript
// app/api/items/route.ts
import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return new NextResponse('Unauthorized', { status: 401 });
  
  const body = await req.json(); // or req.text() for raw body (webhooks)
  const validated = MyValidator.parse(body);
  // ...
  return NextResponse.json({ success: true });
}
```

## Dynamic Route with Params

```typescript
// app/dashboard/[fileId]/page.tsx
export default async function FilePage({
  params,
}: {
  params: Promise<{ fileId: string }>; // Async in Next.js 15+
}) {
  const { fileId } = await params;
  // ...
}
```

## Image + Font Optimization

```typescript
import Image from 'next/image';
import { Inter } from 'next/font/google';

// Always use next/image — not <img>
<Image src="/logo.png" alt="Logo" width={100} height={100} />

// next/font at layout level
const inter = Inter({ subsets: ['latin'] });
```
