#!/usr/bin/env node
/**
 * Cortex session reflection — SessionEnd hook.
 *
 * Two jobs at the end of a session:
 *   1. Harvest gotchas an agent recorded and append them to `.cortex/memory/gotchas.md`,
 *      through the secret guard.
 *   2. Regenerate `.cortex/map.md` if the code drifted away from it.
 *
 * Gotcha extraction is deliberately deterministic: it collects lines the agent explicitly
 * marked `GOTCHA:`, rather than trying to infer lessons from the transcript. A hook has no
 * model available, and a guessed "lesson" committed to a team's repo is worse than no lesson
 * at all. AGENTS.md tells agents to emit the marker when they learn something the hard way.
 *
 * This file is a script AND a module: the work lives in exported functions and the main path
 * runs only when the file is executed directly. Importing it must never harvest anything.
 *
 * Vendored into the repo by `npx cortex-init` — edit `.cortex/lib/` to change the guard.
 */
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const repoRoot = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();

/** Resolve a vendored module in the target repo. Loaded lazily so importing this file is inert. */
const libUrl = (root, name) => pathToFileURL(join(root, '.cortex', 'lib', name));

function readStdin() {
  try {
    return readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

/**
 * The marker must OPEN the line, allowing markdown emphasis, bullets and blockquotes around it.
 *
 * Matching it mid-line recorded sentences *about* the convention — "I will use GOTCHA: markers
 * next time" committed `markers next time.` as tribal knowledge — while requiring whitespace
 * before it lost `**GOTCHA: the build needs Node 18**` entirely. Same root cause, both directions.
 */
const MARKER = /^[\s>*_+#-]*GOTCHA:\s*(.+?)\s*$/;

/**
 * One entry is one line, because `.cortex/memory/*.md` merges with `merge=union`. Without a cap a
 * pasted stack trace commits a single 20,000-character line into a file people have to read.
 *
 * 500 is far above a real lesson — they run well under 200 — and far below any paste. Truncated
 * rather than dropped: losing the opening of a genuine gotcha is the worse of the two failures,
 * and the ellipsis leaves the cut visible to whoever prunes the file later.
 */
const MAX_GOTCHA_LENGTH = 500;

function cleanGotcha(text) {
  const trimmed = text.replace(/[*_\s]+$/, '').trim();
  if (trimmed.length <= MAX_GOTCHA_LENGTH) return trimmed;
  const cut = trimmed.slice(0, MAX_GOTCHA_LENGTH);
  const space = cut.lastIndexOf(' ');
  return `${(space > MAX_GOTCHA_LENGTH / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** Pull `GOTCHA:` lines out of a Claude Code transcript (JSONL). */
export function extractGotchas(transcriptText) {
  const found = [];
  for (const rawLine of String(transcriptText).split('\n')) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;
    let obj;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (!obj || obj.type !== 'assistant') continue;

    const content = obj.message?.content;
    const text = Array.isArray(content)
      ? content.filter((b) => b?.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('\n')
      : typeof content === 'string'
        ? content
        : '';

    for (const line of text.split('\n')) {
      const m = line.match(MARKER);
      if (!m?.[1]) continue;
      const entry = cleanGotcha(m[1]);
      if (entry) found.push(entry);
    }
  }
  return found;
}

/**
 * Keep the committed map honest. A map that drifts from the code is worse than no map,
 * because agents trust it. Regeneration is quiet by design: the hash covers structure only,
 * so a comment or a renamed local produces no diff and the committed file stays stable.
 *
 * The `root` parameter exists so tests can point it at a fixture repo rather than the hook's
 * own project directory.
 */
export async function refreshMapIfStale(root = repoRoot) {
  try {
    const mod = await import(libUrl(root, 'map.mjs'));
    if (!mod.isStale(root)) return { refreshed: false };
    const { markdown } = mod.buildMap(root);
    writeFileSync(join(root, mod.MAP_REL), markdown);
    return { refreshed: true };
  } catch (err) {
    return { refreshed: false, reason: err.message };
  }
}

async function main() {
  const mapResult = await refreshMapIfStale();
  if (mapResult.refreshed) console.error('cortex: structural map refreshed (.cortex/map.md)');

  let payload = {};
  try {
    payload = JSON.parse(readStdin() || '{}');
  } catch {
    payload = {};
  }

  const transcriptPath = payload.transcript_path;
  if (!transcriptPath) return;

  let transcript;
  try {
    transcript = readFileSync(transcriptPath, 'utf8');
  } catch {
    return;
  }

  const candidates = extractGotchas(transcript);
  if (!candidates.length) return;

  let lib;
  try {
    lib = await import(libUrl(repoRoot, 'memory.mjs'));
  } catch (err) {
    console.error(`cortex: reflection failed — cannot load the vendored guard (${err.message})`);
    return;
  }

  try {
    const res = lib.appendGotchas(repoRoot, candidates, { source: 'session' });
    if (res.written.length) {
      console.error(`cortex: recorded ${res.written.length} gotcha(s) in .cortex/memory/gotchas.md`);
    }
    if (res.blocked.length) {
      console.error(
        `cortex: BLOCKED ${res.blocked.length} entr(ies) — possible secret. Nothing was written for those.`,
      );
      for (const b of res.blocked) {
        for (const f of b.findings) console.error(`  ${f.rule}: ${f.detail}`);
      }
    }
  } catch (err) {
    if (err instanceof lib.SecretBlockedError) {
      console.error(`cortex: ${err.message}`);
    } else {
      console.error(`cortex: reflection failed — ${err.message}`);
    }
  }
}

/**
 * True only when this file is the script Node was told to run.
 *
 * `argv[1]` is the path as invoked, but `import.meta.url` is the realpath — Node resolves the
 * main module through symlinks unless `--preserve-symlinks-main`. Comparing them raw makes this
 * guard false for any repo reached through a symlink or a Windows junction, and the hook then
 * exits 0 having done nothing: no gotchas harvested, no map refresh, no error anywhere.
 *
 * `realpathSync` throws on a path that does not exist, which cannot happen for a script Node is
 * executing — but it must not turn an ordinary import into a crash, so it fails closed.
 */
function isMainModule() {
  if (!process.argv[1]) return false;
  try {
    return pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url;
  } catch {
    return false;
  }
}

// Run only when executed as a hook. Importing this file for its functions must be side-effect free.
if (isMainModule()) {
  await main();
  process.exit(0);
}
