import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

/** True for turns that are command/system wrappers, not human prose. */
function isWrapper(text) {
  return /<command-(name|message|args)>|<\/command-|<local-command-stdout>|<system-reminder>/i.test(text);
}

/** Parse Claude Code transcript JSONL → array of genuine human-turn text. */
export function extractUserTurns(transcriptText) {
  const turns = [];
  for (const line of String(transcriptText).split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let obj;
    try { obj = JSON.parse(trimmed); } catch { continue; }
    if (!obj || obj.type !== 'user' || obj.isSidechain) continue;
    const content = obj.message?.content;
    let text = '';
    if (typeof content === 'string') {
      text = content;
    } else if (Array.isArray(content)) {
      text = content
        .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
        .map((b) => b.text)
        .join('\n');
    }
    text = text.trim();
    if (!text || isWrapper(text)) continue;
    turns.push(text);
  }
  return turns;
}

const PERSONAL_SIGNALS = [
  /\bi prefer\b/i, /\bi'?d prefer\b/i, /\bi like to\b/i, /\bi always\b/i,
  /\bi never\b/i, /\bi usually\b/i, /\bfrom now on\b/i, /\bgoing forward\b/i,
];
const PROJECT_SIGNALS = [
  /\bno,? actually\b/i, /\binstead of\b/i, /\brather than\b/i, /\bdon'?t\b/i,
  /\bdo not\b/i, /\bstop\b/i, /\balways\b/i, /\bnever\b/i, /\bmake sure\b/i,
  /\bbe sure to\b/i, /\bremember to\b/i,
];

function firstMatch(signals, sentence) {
  for (const re of signals) {
    const m = sentence.match(re);
    if (m) return m[0];
  }
  return null;
}

/** Turns → candidate drafts. Personal-preference signals win over project signals. */
export function mineTranscript(turns) {
  const drafts = [];
  const seen = new Set();
  for (const turn of turns) {
    const sentences = String(turn).split(/(?<=[.!?])\s+|\n+/);
    for (const raw of sentences) {
      const sentence = raw.trim();
      if (!sentence || sentence.length > 240) continue;
      const personal = firstMatch(PERSONAL_SIGNALS, sentence);
      const trigger = personal || firstMatch(PROJECT_SIGNALS, sentence);
      if (!trigger) continue;
      const text = sentence.slice(0, 240);
      if (seen.has(text)) continue;
      seen.add(text);
      drafts.push({ text, domain: personal ? 'personal' : 'project', trigger });
      if (drafts.length >= 5) return drafts;
    }
  }
  return drafts;
}

function newId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Append-only, boundary-safe. Writes ONLY <root>/brain/candidates.jsonl. */
export function appendCandidates(drafts, root) {
  if (!Array.isArray(drafts) || drafts.length === 0) return [];
  const file = join(root, 'brain', 'candidates.jsonl');
  const existing = existsSync(file) ? readFileSync(file, 'utf-8') : '';
  const seen = new Set(
    existing.split('\n').filter(Boolean).map((l) => {
      try { return JSON.parse(l).text; } catch { return null; }
    }).filter(Boolean),
  );
  const fresh = [];
  for (const d of drafts) {
    if (!d || !d.text || seen.has(d.text)) continue;
    seen.add(d.text);
    fresh.push({
      id: newId(),
      createdAt: new Date().toISOString(),
      text: d.text.trim(),
      domain: d.domain,
      trigger: String(d.trigger || '').trim(),
      needsSanitization: d.domain === 'project',
    });
  }
  if (fresh.length === 0) return [];
  mkdirSync(dirname(file), { recursive: true });
  const body = `${existing.replace(/\s*$/, '')}${existing.trim() ? '\n' : ''}` +
    `${fresh.map((c) => JSON.stringify(c)).join('\n')}\n`;
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, body);
  renameSync(tmp, file);
  return fresh;
}
