---
type: reference
title: Codebase Design — deep modules, seams, and the words for them
updated: 2026-08-15
tags: [reference, framework, engineering]
---

# Codebase Design

How code should be *shaped*, and — more importantly — the vocabulary for arguing about it.
[[operating-principles]] governs **what to build**; this governs **what it should look like once
built**. Design **deep modules**: a lot of behaviour behind a small interface, placed at a clean
seam, testable through that interface.

> The aim is leverage for callers, locality for maintainers, and testability for everyone.

Use these terms **exactly**. Consistent language is the whole point — an agent that drifts into
"component", "service", "API", or "boundary" is no longer having the same conversation you are.

## Glossary

**Module** — anything with an interface and an implementation. Deliberately scale-agnostic: a
function, a class, a package, a tier-spanning slice. _Avoid_: unit, component, service.

**Interface** — everything a caller must know to use the module correctly. Not just the type
signature: also invariants, ordering constraints, error modes, required configuration, and
performance characteristics. _Avoid_: API, signature — both too narrow, they mean only the
type-level surface.

**Implementation** — what's inside a module. Distinct from **adapter**: a thing can be a small
adapter with a large implementation (a Postgres repo) or a large adapter with a small one (an
in-memory fake). Say "adapter" when the seam is the topic, "implementation" otherwise.

**Depth** — leverage at the interface: how much behaviour a caller or test can exercise per unit
of interface they must learn.

**Seam** *(Michael Feathers)* — a place where you can alter behaviour without editing in that
place; the *location* where a module's interface lives. Where to put the seam is its own decision,
separate from what goes behind it. _Avoid_: boundary — overloaded with DDD's bounded context.

**Adapter** — a concrete thing satisfying an interface at a seam. Names a *role* (which slot it
fills), not a substance (what's inside).

**Leverage** — what callers get from depth: more capability per unit of interface learned. One
implementation pays back across N call sites and M tests.

**Locality** — what maintainers get from depth: change, bugs, knowledge, and verification
concentrate in one place instead of spreading across callers. Fix once, fixed everywhere.

## Deep vs shallow

A **deep** module is a small interface over a large implementation. A **shallow** one has an
interface nearly as complex as what it hides — it makes you learn a thing to save you nothing.
Shallow modules are the default failure mode of "extract a function for testability".

When designing an interface, ask: can I reduce the number of methods? Simplify the parameters?
Hide more complexity inside?

## Principles

- **Depth is a property of the interface, not the implementation.** A deep module can be composed
  internally of small, swappable parts — they just aren't part of the interface. Modules have
  **internal seams** (private, used by their own tests) as well as the **external seam** at their
  interface. Don't expose an internal seam just because a test uses it.
- **The deletion test.** Imagine deleting the module. If complexity vanishes, it was a
  pass-through. If complexity *reappears across N callers*, it was earning its keep.
- **The interface is the test surface.** Callers and tests cross the same seam. Wanting to test
  *past* the interface means the module is the wrong shape.
- **One adapter means a hypothetical seam. Two adapters means a real one.** Don't introduce a seam
  unless something actually varies across it — typically production plus test. A single-adapter
  seam is just indirection.

## Designing for testability

1. **Accept dependencies, don't create them.** `processOrder(order, gateway)`, not a
   `new StripeGateway()` buried in the body.
2. **Return results, don't produce side effects.** `calculateDiscount(cart): Discount` beats
   `applyDiscount(cart): void`.
3. **Small surface area.** Fewer methods, fewer tests. Fewer parameters, simpler setup.

## Deepening, by dependency category

How a cluster of shallow modules gets merged depends on what it depends on:

| Category | Example | How it's tested across the seam |
|---|---|---|
| **In-process** | pure computation, in-memory state | always deepenable — merge and test through the new interface; no adapter |
| **Local-substitutable** | PGLite for Postgres, in-memory fs | deepenable if the stand-in exists; seam stays internal, no port at the external interface |
| **Remote but owned** | your own services over a network | define a **port** at the seam; in-memory adapter for tests, HTTP/gRPC/queue adapter for production |
| **True external** | Stripe, Twilio | inject as a port; tests supply a mock adapter |

**Replace tests, don't layer them.** Once tests exist at the deepened module's interface, the old
unit tests on the shallow pieces are waste — delete them. New tests assert on observable outcomes
through the interface, not internal state, so they survive refactors. A test that must change when
the implementation changes is testing past the interface.

## Rejected framings

- **Depth as a ratio of implementation lines to interface lines** — rewards padding the
  implementation. Depth-as-leverage instead.
- **"Interface" as the TypeScript `interface` keyword** or a class's public methods — far too
  narrow; the interface is every fact a caller must know.
- **"Boundary"** — say **seam** or **interface**.

---

Adapted from the `codebase-design` skill in
[mattpocock/skills](https://github.com/mattpocock/skills) (MIT), which draws on Ousterhout's
*A Philosophy of Software Design* and Feathers' *Working Effectively with Legacy Code*.
