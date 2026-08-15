<!--
  The repo's domain glossary. Copied into a target repo as CONTEXT.md.

  One purpose: make a word mean exactly one thing in this codebase. Where two words compete, pick
  one and record the loser under _Avoid_ so it stops coming back in review.

  Seed it from terms that actually appear in the code, then sharpen as arguments arise. A term
  nobody disputes does not need an entry.
-->

# Domain glossary

## {{Term}}

{{One or two sentences. What it IS in this system, not what the word means in English. If it maps
to a type, table or module, name it.}}

_Avoid_: {{the word people reach for instead, and why it is wrong here}}

---

## Worked example — delete this section

## Order

A customer's confirmed intent to buy, after payment authorisation. An Order always has a captured
or authorised payment; before that it is a **Cart**. Persisted in `orders`, modelled by
`src/billing/order.ts`.

_Avoid_: "purchase" (ambiguous — could be the Order or the Payment), "transaction" (that is the
payment-provider record, not ours).

---

## Notes

- Terms only. Decisions go in `docs/adr/`, not here.
- If a definition needs more than a short paragraph, it is probably a decision wearing a
  definition's clothes — write the ADR instead and link it.
- When code and this file disagree, one of them is a bug. Say which.
