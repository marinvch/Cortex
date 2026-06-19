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
