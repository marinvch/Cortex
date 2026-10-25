# The architecture report page

One static HTML file in the OS temp directory. Tailwind and Mermaid load from CDNs; there is no
other script.

## Contents

- [Page skeleton](#page-skeleton)
- [Top of the page](#top-of-the-page)
- [A candidate card](#a-candidate-card)
- [Diagrams](#diagrams)
- [Visual style](#visual-style)
- [Wording](#wording)

## Page skeleton

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Architecture review: {{repo}}</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <script type="module">
      import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs";
      mermaid.initialize({ startOnLoad: true, theme: "neutral", securityLevel: "loose" });
    </script>
    <style>
      .seam { stroke-dasharray: 4 4; }      /* a seam is drawn dashed */
      .leak { stroke: #dc2626; }            /* a dependency crossing a seam it should not */
      .deep { background: #1e293b; color: #f8fafc; }
    </style>
  </head>
  <body class="bg-stone-50 text-slate-900">
    <main class="max-w-5xl mx-auto px-6 py-12 space-y-12">
      <header><!-- repo, date, legend --></header>
      <section id="candidates" class="space-y-10"><!-- one article per candidate --></section>
      <section id="first"><!-- the candidate to do first --></section>
    </main>
  </body>
</html>
```

## Top of the page

The repo name, the date, and a legend for the diagrams: a plain box is a module, a dashed line is a
seam, a red arrow is a leak, a dark heavy box is a deep module. No introduction; the candidates come
next.

The page ends with one larger card naming the candidate to do first, one sentence on why, and a link
to its card.

## A candidate card

One `<article>` per candidate, in this order:

| Part | Content |
|---|---|
| Title | the change, named: "Merge the Booking intake modules" |
| Badges | strength: `Strong` (emerald), `Worth exploring` (amber), `Speculative` (slate); and the dependency kind from [[codebase-design]]: `in-process`, `local-substitutable`, `ports & adapters` or `mock` |
| Files | the files involved, in `font-mono text-sm` |
| Before and after | two diagrams side by side. This is the main content of the card |
| Problem | one sentence on what the current shape costs |
| Change | one sentence on what would be different |
| Gains | short bullets, a few words each, in leverage and locality terms |
| ADR note | only if the candidate contradicts an ADR: one line in an amber box |

If the diagram needs a paragraph to explain it, draw a different diagram.

## Diagrams

Choose the type that shows this candidate's problem, and vary them across the page.

- **Mermaid flowchart or sequence.** For dependencies and call order: who calls whom, and where a
  call leaks across a seam. A sequence diagram shows "six round trips before, one after" well. Use
  `classDef` to colour leak edges red and the deep module dark, and put the diagram in a bordered
  white card.

  ```html
  <div class="rounded-lg border border-slate-200 bg-white p-4">
    <pre class="mermaid">
      flowchart LR
        A[BookingForm] --> B[BookingCheck]
        B --> C[BookingStore]
        C -.leak.-> D[RatesClient]
        classDef leak stroke:#dc2626,stroke-width:2px;
        class C,D leak
    </pre>
  </div>
  ```

- **Hand-drawn boxes.** `<div>` modules inside a relative container, with inline SVG lines for the
  arrows. Use this when Mermaid's automatic layout gets in the way, or when the "after" needs one
  heavy module with its old parts faded inside it.
- **Stacked layers.** Horizontal bands for the layers a call passes through: many thin bands before,
  one thick band after, labelled with what it is responsible for.
- **Interface against implementation.** Two bars per module, one for the size of the interface and
  one for the implementation. Shallow: the bars are nearly equal. Deep: a short interface bar over a
  tall implementation bar.
- **Collapsed call tree.** Before, the calls as nested boxes; after, one box with the same calls
  shown faded inside it.

## Visual style

- Plenty of white space; an editorial look, not a dashboard. Serif headings are fine.
- One accent colour (emerald or indigo), red only for leaks, amber only for warnings.
- Diagrams about 320px tall, so before and after fit side by side without scrolling.
- Labels inside diagrams in `text-xs uppercase tracking-wider`, so they read as a schematic.

## Wording

Short and plain. The architecture terms are the ones defined in [[codebase-design]]: module,
interface, implementation, depth, deep, shallow, seam, adapter, port, leverage, locality. Do not
swap in component, service or unit for module; API or signature for interface; boundary for seam;
or layer or wrapper when the word you mean is module.

Sentences that fit:

- "The Booking intake module is shallow: its interface is as large as its implementation."
- "Rate lookups leak across the seam."
- "Two adapters justify the seam: HTTP in production, in memory in tests."

Gains name the effect in those terms: "locality: booking bugs land in one module", "leverage: one
interface, nine call sites", "the interface shrinks and the wrappers move inside". "Easier to
maintain" and "cleaner" say nothing a reader can check, so leave them out.

Prefer a bullet to a sentence, and cutting a bullet to keeping a weak one. If a needed term is not
in [[codebase-design]], look there for one that fits before introducing a new word.
