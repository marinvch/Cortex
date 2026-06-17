# NextAuth.js Patterns — {{PROJECT_NAME}}

## Config File

`{{AUTH_CONFIG_FILE}}`

## Session Helper

```typescript
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/authOptions';

// In Server Components, API routes, tRPC procedures:
const session = await getServerSession(authOptions);
if (!session) redirect('/auth/signin'); // or throw TRPCError
const userId = session.user.id;
```

## JWT Flow

```
signIn → signIn callback (upsert User in DB) → JWT callback (inject user.id) → session callback (expose user.id)
```

## Adding an OAuth Provider

```typescript
// authOptions.ts — conditionally include if env vars present
...(process.env.GITHUB_CLIENT_ID ? [
  GithubProvider({
    clientId: process.env.GITHUB_CLIENT_ID,
    clientSecret: process.env.GITHUB_CLIENT_SECRET!,
  })
] : []),
```

Required env vars: `*_CLIENT_ID`, `*_CLIENT_SECRET`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL`

## Protecting a Page (Server Component)

```typescript
// app/dashboard/page.tsx
import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';

export default async function DashboardPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/auth/signin');
  // session.user.id is available
}
```

## Protecting a tRPC Procedure

Use `privateProcedure` — it automatically handles auth.

## Session Shape

```typescript
session.user.id    // string — DB user ID
session.user.name  // string | null
session.user.email // string | null
session.user.image // string | null
```

## Debugging

- Verify `NEXTAUTH_SECRET` is set (any long random string)
- Verify `NEXTAUTH_URL` matches the app URL exactly (including protocol)
- Check OAuth app callback URL: `{NEXTAUTH_URL}/api/auth/callback/{provider}`
