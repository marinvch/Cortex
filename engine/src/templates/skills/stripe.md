# Stripe Billing Patterns — {{PROJECT_NAME}}

## Key Files

- Plans/limits: `{{PLANS_FILE}}`
- Stripe client + plan lookup: `{{STRIPE_LIB_FILE}}`
- Webhook handler: `{{WEBHOOK_FILE}}`

## Subscription Check

```typescript
import { getUserSubscriptionPlan } from '@/lib/stripe';

const plan = await getUserSubscriptionPlan();
// plan.isSubscribed — true if active paid subscription
// plan.name — 'Free' | 'Pro' | 'Enterprise'
// plan.maxFileSize — bytes limit for uploads
// plan.quota — max file count
// plan.messageLimit — max messages per file
```

## Checkout Session (tRPC)

```typescript
// src/trpc/index.ts — createStripeSession procedure
// Redirects user to Stripe Checkout, then back to /dashboard
```

## Webhook Signature Verification

```typescript
// CRITICAL: Use raw body, not parsed JSON
const rawBody = await req.text();
const sig = req.headers.get('stripe-signature')!;
const event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET!);
```

## Handled Webhook Events

| Event | What to update on User |
|-------|----------------------|
| `checkout.session.completed` | `stripeCustomerId` |
| `invoice.payment_succeeded` | `stripePriceId`, `stripeCurrentPeriodEnd` |
| `customer.subscription.deleted` | Clear all stripe fields |

## Local Testing

```bash
# Install Stripe CLI, then:
stripe listen --forward-to localhost:3000/api/webhooks/stripe
# Trigger test events:
stripe trigger checkout.session.completed
```

## isSubscribed Logic

```typescript
// User is subscribed if stripeCurrentPeriodEnd is in the future
const isSubscribed = !!(
  stripeSubscriptionId &&
  stripeCurrentPeriodEnd &&
  stripeCurrentPeriodEnd.getTime() > Date.now()
);
```
