# Cortex history

Superseded parts of the product, kept because they explain why the current shape exists. Nothing
here runs, and nothing here is loaded by an agent — `.cortexignore` excludes `docs/`.

| File | Was | Superseded by |
|---|---|---|
| `cortex-init.mjs.legacy` | the Node installer | `tools/cortex-init.sh` — see [ADR 0004](../adr/0004-no-runtime-dependencies.md) |
| `package.json.node-legacy`, `tools-package.json.node-legacy` | manifests from the Node era | the dependency-free tree |
| `alive-os-framework.md`, `getting-started.md`, `quick-reference.md` | the engine-era framework docs | [`references/`](../../references/) |
| `00-AUDIT-AND-PLAN.md` | the audit that started the plain-files rewrite | the rewrite itself |
| `retired-views/` | the first graph viewers | `tools/cortex.sh` |
| `stale-engine/` | `.chatprompt.md` files the retired engine ran | `skills/` |

This is **product** history, not personal content. It is tracked and shareable, which is exactly
what distinguishes it from [`archives/`](../../archives/) — that folder is your vault's, and it is
ignored in full.
