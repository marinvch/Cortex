# 🗄️ Archives

Old or superseded material from **your vault**. Move here; never delete — things resurface.

Everything in this folder is gitignored except this file. That is deliberate and it is the whole
point of the folder: whatever gets archived out of the personal layer keeps the privacy it had
there. `/cortex-audit` writes dated `archives/<name>-YYYY-MM-DD/` folders; `tools/cortex-rm.sh`
writes `archives/removed/`. Both create what they need, so an empty folder here is the normal
state.

**Archiving is not sanitizing.** Personal content moved into a tracked path is a leak, not a fix —
`git check-ignore -v <path>` is how you confirm it landed ignored.

The product's own history is **not** personal content: it is Cortex's git log and `CHANGELOG.md`.
It used to live here as files, which is why the ignore rules for this folder needed six lines and
two negations to say which half was shareable.
