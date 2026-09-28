// placeholders.mjs — what a Cortex template placeholder is, and how a template is filled.
//
// One definition, two readers. `tools/cortex-placeholders.mjs` asks which placeholders a stamped
// file still holds; `stamps.mjs` renders a template from recorded values so a file can be updated
// when its template changes. If those two disagreed about what `{{…}}` means, the check would pass a
// file the renderer fills differently — so the rule lives here and both import it.
//
// The rule: `{{…}}` is a placeholder unless a `$` sits directly before it. `${{ github.ref }}` is
// GitHub Actions syntax in a workflow template and is never touched. A placeholder's name is its
// inner text, trimmed — `NIT_CAP` in the loop templates, a phrase like `test command` in the prose
// ones.
//
// Rendering is a substitution and nothing cleverer, so it can be reproduced exactly:
//
//   - a value replaces its token verbatim, every occurrence, in one pass — a value is never scanned
//     for placeholders of its own;
//   - a placeholder with no value is left exactly as written. That is how `intent/TEMPLATE.md`
//     keeps `{{TITLE}}`, and why every template renders to itself with no values;
//   - a placeholder alone on its line (whitespace around it is allowed) whose value is empty
//     removes the whole line, newline included. That is how "replace the `{{SETUP_STEPS}}` line, or
//     delete it" is written down. An empty value inside a line only empties the token;
//   - a multi-line value is inserted at the token, so the line's indentation prefixes its first
//     line only — continuation lines carry their own;
//   - CRLF in the template or a value becomes LF: what Cortex writes into a repo is LF.
//
// Pure: no filesystem, no clock.

const TOKEN = /\{\{([\s\S]*?)\}\}/g;

/** Every placeholder occurrence: `{ index, token, name }`, in order. `${{ … }}` is skipped. */
export function placeholderMatches(text) {
  const out = [];
  for (const m of String(text).matchAll(TOKEN)) {
    if (m.index > 0 && text[m.index - 1] === "$") continue;
    out.push({ index: m.index, token: m[0], name: m[1].trim() });
  }
  return out;
}

/** Each distinct placeholder token, as written, in order of first appearance. */
export function placeholdersOf(text) {
  return [...new Set(placeholderMatches(text).map((m) => m.token))];
}

const lf = (s) => String(s).replace(/\r\n/g, "\n");

/** Fill `text` from `values` (name → string), by the rules in the header. Returns LF text. */
export function renderTemplate(text, values = {}) {
  const t = lf(text);
  let out = "";
  let last = 0;
  for (const m of placeholderMatches(t)) {
    if (!Object.hasOwn(values, m.name)) continue;
    const value = lf(values[m.name]);
    const end = m.index + m.token.length;
    const lineStart = t.lastIndexOf("\n", m.index - 1) + 1;
    const nl = t.indexOf("\n", end);
    const lineEnd = nl === -1 ? t.length : nl;
    const alone = /^[ \t]*$/.test(t.slice(lineStart, m.index)) && /^[ \t]*$/.test(t.slice(end, lineEnd));
    if (value === "" && alone) {
      out += t.slice(last, lineStart);
      last = nl === -1 ? t.length : nl + 1;
      continue;
    }
    out += t.slice(last, m.index) + value;
    last = end;
  }
  return out + t.slice(last);
}

/** The names of placeholders in `text` that `values` does not fill, each once, in order. */
export function unfilledPlaceholders(text, values = {}) {
  return [...new Set(placeholderMatches(lf(text)).map((m) => m.name).filter((n) => !Object.hasOwn(values, n)))];
}
