---
type: reference
title: Codebase Design — deep modules, seams, and the words for them
updated: 2026-10-25
tags: [reference, framework, engineering]
---

# Codebase Design

The words Cortex uses for the shape of code, and the tests that go with them.
[[operating-principles]] decides what to build; this page is for judging what the result looks
like. The target is a **deep module**: much behaviour behind a small interface, placed at a seam
where something actually varies, and tested through that interface.

Use these words with the meanings below and no others. A review that says "component" in one
paragraph and "service" in the next is not comparing like with like, and an agent that reads it
cannot tell whether two sentences are about the same thing.

## Terms

**Module.** A unit of code with an interface and an implementation. Size does not matter: a
function, a class, a file, a package and a vertical slice through several tiers are all modules.
_Avoid_: unit, component, service.

**Interface.** Everything a caller has to know to use a module correctly. The type signature is
part of it; so are the invariants, the required call order, the errors it raises, the configuration
it expects and how it performs. _Avoid_: API, signature. Both suggest only the typed surface.

**Implementation.** The code inside the module that the interface hides.

**Depth.** How much behaviour a caller or test gets for each thing it must learn about the
interface. A **deep** module has a small interface over a large implementation. A **shallow** one
has an interface about as complicated as the code behind it, so learning it saves the caller
almost nothing.

**Seam.** A point where behaviour can be changed without editing the code at that point, because
something else can be substituted there. A module's interface sits at a seam. Choosing where the
seam goes is a separate decision from choosing what goes behind it. _Avoid_: boundary, which also
means a bounded context in domain modelling.

**Adapter.** A concrete piece of code that fills a seam by satisfying its interface: the Postgres
repository, the in-memory fake. The word names the role, not the size. An adapter can be thin over
a large implementation or large over a small one. Say *adapter* when the subject is the seam, and
*implementation* otherwise.

**Port.** The interface defined at a seam so that more than one adapter can fill it.

**Leverage.** What depth gives callers: one implementation does the work for every call site and
every test that uses it.

**Locality.** What depth gives maintainers: a change, a bug, or the knowledge of how something
works sits in one module instead of being spread across its callers. Fixed there, it is fixed
everywhere.

## Tests for a module's shape

- **Delete it in your head.** If the complexity disappears with it, it was a pass-through and the
  callers would be simpler without it. If the complexity would reappear in every caller, the module
  is doing its job.
- **Test through the interface.** Callers and tests should use the same seam. A test that needs to
  reach inside a module to check it is a sign the interface is in the wrong place.
- **Count the adapters.** A seam with one adapter is speculative; it adds indirection and nothing
  varies across it. A seam earns its place when there are two, usually production and test.
- **Depth belongs to the interface.** A deep module may be built from many small parts with their
  own internal seams and their own tests. Those stay private. Exposing an internal seam because one
  test wants it makes the module shallower.
- **Shrink the interface first.** When reshaping a module, look for methods to remove, parameters to
  drop and decisions to move inside before adding anything.

Extracting small functions only so each can be unit-tested is the most common way to produce
shallow modules: the tests pass, and the bugs live in how the pieces are called.

## Writing code that is easy to test

1. **Take dependencies as arguments.** `chargeCard(order, gateway)`, not a gateway constructed
   inside the function.
2. **Return a value instead of changing state.** `priceFor(basket): Price` is easier to check than
   `applyPrice(basket): void`.
3. **Keep the interface small.** Each method and parameter is something every test must set up.

## Merging shallow modules, by what they depend on

How a group of shallow modules can be merged into one deep module depends on the kind of dependency
behind it:

| Dependency | Example | How the merged module is tested |
|---|---|---|
| **In-process** | pure computation, in-memory state | merge freely and test through the new interface; no adapter needed |
| **Local stand-in** | an embedded database for Postgres, an in-memory file system | merge when the stand-in exists; the seam stays internal and no port is exposed |
| **Remote, owned by you** | your own services over the network | put a port at the seam; an in-memory adapter for tests, the network adapter in production |
| **External** | a payment provider, an SMS gateway | inject a port; tests use a mock adapter |

The report in `/architecture-review` tags each candidate with one of these as
`in-process`, `local-substitutable`, `ports & adapters` or `mock`.

**Replace the old tests; do not stack new ones on them.** Once tests exist at the merged module's
interface, the unit tests on the old shallow pieces are dead weight and should go. Assert on what a
caller can observe, not on internal state, so the tests survive the next refactor. A test that has
to change whenever the implementation changes is testing past the interface.

## Comparing interface designs

When the shape of a deepened module is open, do not refine the first design. Dispatch two or three
sub-agents in parallel, each told to design the interface under a different constraint: the fewest
methods, the most common call made trivial, every dependency behind a port. Put the results side by
side and compare them on depth, on what each makes a test do, and on what each leaks. The design
the user picks is usually a combination.

## Framings Cortex does not use

- **Depth as implementation lines divided by interface lines.** It rewards padding the
  implementation. Depth is measured by leverage.
- **Interface as the `interface` keyword or a class's public methods.** Too narrow: the interface
  includes everything a caller must know.
- **Boundary.** Say seam or interface.
