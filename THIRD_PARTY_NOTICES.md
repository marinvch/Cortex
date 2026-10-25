# Third-party notices

Cortex is MIT-licensed ([LICENSE](LICENSE)), © 2026 Marin Cholakov. This file lists the material in
it that comes from someone else, under what terms, and the terms that apply to what Cortex writes
into your repositories.

## mattpocock/skills — MIT

Several rituals are adapted from [mattpocock/skills](https://github.com/mattpocock/skills). Each
file says what is upstream and what Cortex added, in its closing attribution paragraph.

| File | What is adapted |
|---|---|
| `skills/diagnosing-bugs/SKILL.md` | Phases 1–6, lightly reworded |
| `skills/domain-modeling/SKILL.md` | the ritual body |
| `skills/domain-modeling/CONTEXT-FORMAT.md`, `skills/domain-modeling/ADR-FORMAT.md` | vendored |
| `skills/grilling/SKILL.md` | the design-tree and frontier method, unmodified |
| `skills/handoff/SKILL.md` | the instruction body |
| `skills/improve-codebase-architecture/SKILL.md` | the ritual body |
| `skills/resolving-merge-conflicts/SKILL.md` | the ritual body |
| `skills/wizard/SKILL.md`, `skills/wizard/template.sh` | the ritual body; `template.sh` vendored unmodified |
| `skills/writing-for-agents/SKILL.md`, `skills/writing-for-agents/SKILL-MECHANICS.md` | the reference body, unmodified apart from bullets marked in place |
| `references/codebase-design.md` | the vocabulary, which draws on Ousterhout and Feathers |

The licence, as published in that repository:

```text
MIT License

Copyright (c) 2026 Matt Pocock

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Graphify — Apache-2.0

Cortex's graph analysis ports methods from [Graphify](https://github.com/Graphify-Labs/graphify),
read at commit `92741d1`. Graphify is Python and Cortex is Node, so nothing is copied verbatim.
What is adapted is the method, its constants and its labels, listed in
[`docs/specs/2026-10-25-graph-port-design.md`](docs/specs/2026-10-25-graph-port-design.md). Each
file below names the Graphify module it follows in its header, and says what Cortex changed. The
main change is that every step is deterministic, with no random seed.

| File | Adapted from |
|---|---|
| `index/lib/clusters.mjs` | `graphify/cluster.py` |
| `index/lib/graph-report.mjs` | `graphify/analyze.py` |
| `mcp/lib/graph.js` | `graphify/serve.py` (the tool set) |
| `index/lib/symbols.mjs` | `graphify/extract.py` and `graphify/extractors/` |

These files arrive one PR at a time, in the order the spec gives. Graphify's licence is in
[`LICENSES/graphify-Apache-2.0.txt`](LICENSES/graphify-Apache-2.0.txt). Its NOTICE file reads:

```text
Graphify
Copyright 2026 Safi Shamsi and the Graphify contributors.

This product is licensed under the Apache License, Version 2.0 (see LICENSE).

Portions of this software were contributed under the MIT License prior to the
relicensing and remain available under those terms. The original MIT license
text is retained in LICENSE-MIT.
```

The optional code parsers ([ADR 0029](docs/adr/0029-code-parsers-are-an-add-on-the-user-installs.md))
are not part of Cortex. `tools/cortex-parsers.mjs install` downloads them to your machine on
request: `web-tree-sitter` and the tree-sitter grammar packages, each MIT-licensed by its
authors. Their licences ship inside the packages it downloads.

## Anthropic documentation — quoted, not licensed here

`core/claude-code.js` holds, for each Claude Code rule Cortex checks, an `evidence` string: a short
sentence quoted from Anthropic's documentation (code.claude.com and platform.claude.com), with the
page it came from, so anyone can verify the rule. Those quotations are © Anthropic. They are cited
for verification and are **not** licensed under Cortex's MIT licence; the code around them is.
`tools/claude-docs-seen.json` lists page addresses only. Shorter quotations of the same pages appear
in a few rituals and ADRs, cited to their page, on the same terms.

## Files Cortex writes into your repository — MIT-0

`/cortex`, `/cortex-scaffold`, `/cortex-brief`, `/cortex-skills` and the other rituals write files
into **your** repository from `templates/` and from the rituals' own text: `AGENTS.md`, `REVIEW.md`,
hooks, workflows, agent files, ADR and `CONTEXT.md` skeletons, skills. Those files are yours.

To the extent they carry Cortex's copyrightable text, Cortex grants them to you under the
**MIT No Attribution licence (MIT-0)**: use, modify and redistribute them, in any project, under any
licence, with **no attribution and no notice required**. Nothing has to be added to the files, and
Cortex adds no licence header to them — a header would change their bytes and make every repository
that stamped them before read as edited.

```text
MIT No Attribution

Copyright (c) 2026 Marin Cholakov

Permission is hereby granted, free of charge, to any person obtaining a copy of this
software and associated documentation files (the "Software"), to deal in the Software
without restriction, including without limitation the rights to use, copy, modify,
merge, publish, distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED,
INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

This grant covers what Cortex wrote. It does not cover the quotations from Anthropic's
documentation described above, should a stamped file carry one, and it does not change the licence
of Cortex itself.
