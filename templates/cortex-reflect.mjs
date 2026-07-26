#!/usr/bin/env node
/**
 * Cortex session reflection — SessionEnd hook.
 *
 * Harvests gotchas an agent recorded during the session and appends them to
 * `.cortex/memory/gotchas.md`, through the secret guard.
 *
 * Extraction is deliberately deterministic: it collects lines the agent explicitly
 * marked `GOTCHA:`, rather than trying to infer lessons from the transcript. A hook
 * has no model available, and a guessed "lesson" committed to a team's repo is worse
 * than no lesson at all. AGENTS.md tells agents to emit the marker when they learn
 * something the hard way.
 *
 * Vendored into the repo by `npx cortex-init` — edit `.cortex/lib/` to change the guard.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const repoRoot = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();

const { appendGotchas, SecretBlockedError } = await import(
  new URL(`file://${join(repoRoot, '.cortex/lib/memory.mjs').replace(/\\/g, '/')}`)
);

function readStdin() {
  try {
    return readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

const MARKER = /(?:^|\s)GOTCHA:\s*(.+?)\s*$/;

/** Pull `GOTCHA:` lines out of a Claude Code transcript (JSONL). */
function extractGotchas(transcriptText) {
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
      if (m?.[1]) found.push(m[1].trim());
    }
  }
  return found;
}

let payload = {};
try {
  payload = JSON.parse(readStdin() || '{}');
} catch {
  payload = {};
}

const transcriptPath = payload.transcript_path;
if (!transcriptPath) process.exit(0);

let transcript;
try {
  transcript = readFileSync(transcriptPath, 'utf8');
} catch {
  process.exit(0);
}

const candidates = extractGotchas(transcript);
if (!candidates.length) process.exit(0);

try {
  const res = appendGotchas(repoRoot, candidates, { source: 'session' });
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
  if (err instanceof SecretBlockedError) {
    console.error(`cortex: ${err.message}`);
  } else {
    console.error(`cortex: reflection failed — ${err.message}`);
  }
}

process.exit(0);
