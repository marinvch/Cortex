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
