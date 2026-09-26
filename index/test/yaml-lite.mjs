// The block-YAML subset a GitHub Actions workflow is written in, and nothing more: mappings,
// sequences, plain and quoted scalars, `[a, b]` flow lists, `|` literal blocks and comments.
//
// Test-only. Cortex has no runtime dependencies, so a template's shape is checked with this rather
// than with a YAML package. It throws on anything outside the subset instead of guessing, which is
// the point: a line it cannot place — an unfilled `{{PLACEHOLDER}}` in a step list, a step indented
// one space off — is exactly what makes GitHub reject a workflow before any job starts.

export function parseYaml(text) {
  const raw = text.replace(/\r\n?/g, "\n").split("\n");
  let i = 0;

  const indentOf = (line) => line.length - line.trimStart().length;
  const isSkippable = (line) => !line.trim() || line.trimStart().startsWith("#");

  // Advance past blank and comment lines; return the next meaningful line, or null at the end.
  function peek() {
    while (i < raw.length && isSkippable(raw[i])) i++;
    if (i >= raw.length) return null;
    if (raw[i].includes("\t")) throw new Error(`line ${i + 1}: a tab in indentation`);
    return { indent: indentOf(raw[i]), content: raw[i].trim(), line: i + 1 };
  }

  function stripComment(s) {
    let quote = null;
    for (let k = 0; k < s.length; k++) {
      const c = s[k];
      if (quote) { if (c === quote) quote = null; continue; }
      if (c === "'" || c === '"') quote = c;
      else if (c === "#" && (k === 0 || /\s/.test(s[k - 1]))) return s.slice(0, k).trimEnd();
    }
    return s;
  }

  function scalar(s, line) {
    s = stripComment(s).trim();
    if (s.startsWith("'") && s.endsWith("'") && s.length >= 2) return s.slice(1, -1).replace(/''/g, "'");
    if (s.startsWith('"') && s.endsWith('"') && s.length >= 2) return JSON.parse(s);
    if (s.startsWith("[") && s.endsWith("]")) {
      const body = s.slice(1, -1).trim();
      return body ? body.split(",").map((part) => scalar(part, line)) : [];
    }
    if (s.startsWith("{")) throw new Error(`line ${line}: flow mapping or unfilled placeholder: ${s}`);
    if (/^-?\d+$/.test(s)) return Number(s);
    if (s === "true" || s === "false") return s === "true";
    if (s === "" || s === "~" || s === "null") return null;
    return s;
  }

  // A `|` block: every following line that is blank or indented past the key, dedented.
  function literal(parentIndent) {
    const body = [];
    while (i < raw.length && (!raw[i].trim() || indentOf(raw[i]) > parentIndent)) body.push(raw[i++]);
    while (body.length && !body[body.length - 1].trim()) body.pop();
    const cut = Math.min(...body.filter((l) => l.trim()).map(indentOf));
    return body.map((l) => l.slice(cut)).join("\n") + "\n";
  }

  const KEY = /^((?:'[^']*'|"[^"]*"|[^\s'"#:][^:#]*?)):(?:\s+(.*))?$/;

  // The value after `key:` — inline, a literal block, or a nested block on the following lines.
  function value(rest, indent, line) {
    if (rest !== undefined && /^\|[-+]?$/.test(stripComment(rest).trim())) return literal(indent);
    if (rest !== undefined && stripComment(rest).trim() !== "") return scalar(rest, line);
    const next = peek();
    if (next && next.indent > indent) return block(next.indent);
    if (next && next.indent === indent && next.content.startsWith("-")) return sequence(indent);
    return null;
  }

  function mapping(indent, first) {
    const out = {};
    let cur = first ?? peek();
    while (cur && cur.indent === indent && !cur.content.startsWith("- ") && cur.content !== "-") {
      const m = KEY.exec(cur.content);
      if (!m) throw new Error(`line ${cur.line}: not a key: ${cur.content}`);
      const key = scalar(m[1], cur.line);
      if (Object.hasOwn(out, key)) throw new Error(`line ${cur.line}: duplicate key ${key}`);
      i = cur.line; // consume the key line
      out[key] = value(m[2], indent, cur.line);
      cur = peek();
    }
    if (cur && cur.indent > indent) throw new Error(`line ${cur.line}: unexpected indentation: ${cur.content}`);
    return out;
  }

  function sequence(indent) {
    const out = [];
    let cur = peek();
    while (cur && cur.indent === indent && (cur.content.startsWith("- ") || cur.content === "-")) {
      const rest = cur.content === "-" ? "" : cur.content.slice(2);
      i = cur.line;
      if (!rest.trim()) {
        const next = peek();
        out.push(next && next.indent > indent ? block(next.indent) : null);
      } else if (KEY.test(rest)) {
        // `- key: value` opens a mapping whose keys sit two columns in.
        out.push(mapping(indent + 2, { indent: indent + 2, content: rest, line: cur.line }));
      } else {
        out.push(scalar(rest, cur.line));
      }
      cur = peek();
    }
    if (cur && cur.indent > indent) throw new Error(`line ${cur.line}: unexpected indentation: ${cur.content}`);
    return out;
  }

  function block(indent) {
    const cur = peek();
    return cur.content.startsWith("- ") || cur.content === "-" ? sequence(indent) : mapping(indent);
  }

  const first = peek();
  if (!first) return null;
  const doc = block(first.indent);
  const rest = peek();
  if (rest) throw new Error(`line ${rest.line}: unexpected content: ${rest.content}`);
  return doc;
}
