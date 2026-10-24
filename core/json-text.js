// json-text.js — insert one entry into a JSON file's text without re-serialising the file.
//
// Two writers put a Cortex entry into a JSON file other people own: `index/lib/shared-plugin.mjs`
// (`.claude/settings.json`) and `tools/cortex-setup.mjs` (`.vscode/mcp.json`,
// `.gemini/settings.json`). Both keep one discipline, and this file is the mechanical half of it:
//
//   - the caller parses the text first and refuses a file that is not a JSON object;
//   - an entry is inserted as text at the end of its object, in the file's own indentation and line
//     endings, so every other byte stays what it was — `JSON.stringify` would reflow every inline
//     array the team wrote, and a merge whose diff touches forty lines is not one anyone can review;
//   - the caller parses the result again and compares it with what it meant to write.
//
// This file is the scanner and the insertion only. It never decides what to add or whether an
// existing entry is kept; that is each caller's policy. Text in, text out: no I/O, no clock.

const WS = new Set([" ", "\t", "\n", "\r"]);

/** The offset of the next character that is not JSON whitespace. */
export const skipWs = (t, i) => {
  while (i < t.length && WS.has(t[i])) i++;
  return i;
};

function skipString(t, i) {
  for (i++; i < t.length && t[i] !== '"'; i++) if (t[i] === "\\") i++;
  return i + 1;
}

function skipValue(t, i) {
  if (t[i] === '"') return skipString(t, i);
  if (t[i] === "{" || t[i] === "[") {
    let depth = 0;
    for (; i < t.length; i++) {
      if (t[i] === '"') { i = skipString(t, i) - 1; continue; }
      if (t[i] === "{" || t[i] === "[") depth++;
      else if ((t[i] === "}" || t[i] === "]") && --depth === 0) return i + 1;
    }
  }
  while (i < t.length && !WS.has(t[i]) && t[i] !== "," && t[i] !== "}" && t[i] !== "]") i++;
  return i;
}

/**
 * The members of the object whose `{` is at `open`, and where its `}` is. Only for text that has
 * already parsed as JSON: it finds where things are and never judges them.
 */
export function objectAt(t, open) {
  const members = [];
  let i = skipWs(t, open + 1);
  if (t[i] === "}") return { members, close: i };
  for (;;) {
    // Unreachable on text that parsed as an object; it stops a broken caller from scanning forever.
    if (t[i] !== '"') throw new Error(`no object member at offset ${i}`);
    const keyStart = i;
    const keyEnd = skipString(t, i);
    const valueStart = skipWs(t, skipWs(t, keyEnd) + 1);
    const valueEnd = skipValue(t, valueStart);
    members.push({ key: JSON.parse(t.slice(keyStart, keyEnd)), keyStart, valueStart, valueEnd });
    i = skipWs(t, valueEnd);
    if (t[i] === "}") return { members, close: i };
    i = skipWs(t, i + 1);
  }
}

/** The whitespace a line starts with — the indentation of whatever sits at `pos`. */
function lineIndent(t, pos) {
  const start = t.lastIndexOf("\n", pos - 1) + 1;
  let end = start;
  while (t[end] === " " || t[end] === "\t") end++;
  return t.slice(start, end);
}

/**
 * `{ eol, unit }` for a text whose top-level `{` is at `root`: its line ending, and its indent unit
 * read off the first top-level member — two spaces for a file with none, or all on one line.
 */
export function textStyle(t, root) {
  const first = objectAt(t, root).members[0];
  return {
    eol: t.includes("\r\n") ? "\r\n" : "\n",
    unit: first && t.slice(root + 1, first.keyStart).includes("\n") ? lineIndent(t, first.keyStart) || "  " : "  ",
  };
}

/** Insert `"name": value` as the last member of the object at `open`, in the file's own style. */
export function insertMember(t, open, name, value, style) {
  const { members, close } = objectAt(t, open);
  const key = JSON.stringify(name);
  if (!members.length) {
    const outer = lineIndent(t, open);
    const indent = outer + style.unit;
    const body = JSON.stringify(value, null, style.unit).split("\n").join(style.eol + indent);
    return t.slice(0, open + 1) + style.eol + indent + `${key}: ${body}` + style.eol + outer + t.slice(close);
  }
  const last = members[members.length - 1];
  const between = t.slice(open + 1, members[0].keyStart);
  if (!between.includes("\n")) {
    // A one-line object stays one line.
    return t.slice(0, last.valueEnd) + `, ${key}: ${JSON.stringify(value)}` + t.slice(last.valueEnd);
  }
  const indent = lineIndent(t, members[0].keyStart);
  const body = JSON.stringify(value, null, style.unit).split("\n").join(style.eol + indent);
  return t.slice(0, last.valueEnd) + "," + style.eol + indent + `${key}: ${body}` + t.slice(last.valueEnd);
}

/**
 * Put `name: value` inside the top-level object `key` of the object at `root`: as its last member
 * when `key` is there (the last occurrence, which is the one `JSON.parse` keeps), otherwise as a new
 * `key: { name: value }` at the end of the root. The caller has checked `key` holds an object.
 */
export function insertUnder(t, root, key, name, value, style) {
  const top = objectAt(t, root).members.filter((m) => m.key === key).pop();
  return top ? insertMember(t, top.valueStart, name, value, style) : insertMember(t, root, key, { [name]: value }, style);
}
