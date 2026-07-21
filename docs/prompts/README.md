# docs/prompts/

Optimized prompts, one file per sharpened ask, written by `/optimize-prompt`.

Filename: `YYYY-MM-DD-<slug>.md` — slug is kebab-case from the optimized prompt.

**These files are gitignored.** Real prompts name real clients, repos, and plans, so they stay on
your machine — only this README is committed, so a fork inherits the convention and none of the
content. See the privacy rule in `AGENTS.md`.

Each file records the raw prompt, the clarifying questions and answers, and the final optimized
prompt. Over time the folder becomes a corpus for tuning the vagueness threshold in
`.claude/hooks/optimize-prompt.mjs`.
