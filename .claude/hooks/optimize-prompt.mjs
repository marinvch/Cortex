import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Score at or above which the optimizer fires. Tune here after reviewing docs/prompts/. */
export const THRESHOLD = 4;

/**
 * The word lists are exported so the test can hold skills/optimize-prompt/SKILL.md to them — the
 * skill restates them for agents without this hook, and a copy nobody checks drifts.
 *
 * Verbs match with an inflection (`merged`, `fixing`). The second half of the list came from real
 * misfires: "restore last session and give me what was done" scored as having no action at all.
 */
export const ACTION_VERB_LIST = [
  'add', 'create', 'update', 'delete', 'fix', 'remove', 'migrate', 'refactor', 'write', 'build',
  'review', 'audit', 'explain', 'document', 'test', 'rename', 'move', 'debug', 'optimi[sz]e',
  'install', 'scan', 'implement', 'generate', 'wire', 'split', 'merge', 'run',
  'restore', 'resume', 'continue', 'investigate', 'research', 'interview', 'check', 'verify',
  'compare', 'analy[sz]e', 'summari[sz]e', 'plan', 'ship', 'commit', 'push', 'deploy', 'clean',
  'finish', 'list', 'find', 'search', 'show',
];

export const DOMAIN_WORD_LIST = [
  'auth', 'db', 'database', 'api', 'ui', 'schema', 'tests?', 'hooks?', 'skills?', 'vault', 'graph',
  'mcp', 'git', 'ci', 'cli', 'docs?', 'readme', 'agents?', 'prompts?',
  'sessions?', 'prs?', 'branch(es)?', 'commits?', 'worktrees?', 'plugins?', 'rituals?', 'cortex',
  'memory', 'index', 'evals?', 'changelog', 'repos?', 'releases?',
];

const ACTION_VERBS = new RegExp(`\\b(${ACTION_VERB_LIST.join('|')})(s|es|d|ed|ing)?\\b`, 'i');
const DOMAIN_WORDS = new RegExp(`\\b(${DOMAIN_WORD_LIST.join('|')})\\b`, 'i');

/** Broad "you named something concrete" signal: path, filename, `backtick`, #123, URL. */
const COMPONENT_REF =
  /(`[^`]+`)|(\b[\w.-]+\/[\w./-]+)|(\b\w[\w-]+\.[A-Za-z][A-Za-z0-9]{0,4}\b)|(#\d+)|(https?:\/\/)/i;

/** A `/ritual` named mid-sentence. At the start of a prompt it already bypasses. */
const SLASH_RITUAL = /(^|\s)\/[a-z][\w-]*[a-z]\b/i;

/**
 * Hyphenated ritual names (`cortex-review`, `weekly-review`), read from the skills/ directory two
 * levels up. Single-word names — ship, daily, capture — are ordinary English and would ground any
 * sentence, so only the hyphenated ones count when written bare. No skills/ directory, no names.
 */
function hyphenatedRituals() {
  try {
    return readdirSync(new URL('../../skills/', import.meta.url), { withFileTypes: true })
      .filter((d) => d.isDirectory() && d.name.includes('-'))
      .map((d) => d.name);
  } catch { return []; }
}
const RITUALS = hyphenatedRituals();
const RITUAL_NAME = RITUALS.length ? new RegExp(`\\b(${RITUALS.join('|')})\\b`, 'i') : null;

function namesComponent(p) {
  return COMPONENT_REF.test(p) || SLASH_RITUAL.test(p) || Boolean(RITUAL_NAME?.test(p));
}

/** Narrow "you named the exact file" signal — precise enough to skip the optimizer entirely. */
const FILE_LOCATOR = /(\b[\w.-]+\/[\w./-]+\.\w+\b)|(\b[\w.-]+\.\w+:\d+\b)/;

/**
 * Pronoun-anchored status check ("is it done", "did it work"). Asking the user to clarify one of
 * these improves nothing — it reports on work already in flight. Deliberately narrow: it requires a
 * pronoun subject, so "why is auth broken" and "is the auth flow broken" still reach scoring.
 */
const STATUS_QUESTION =
  /^(is|are|was|were|did|does|do|has|have)\s+(it|this|that|we|they|everything|all)\b/i;

const BYPASS_WORDS = /\b(just|quickly|only|typo|rename)\b/i;
const STEER_WORDS =
  /^(y|yes|no|ok|okay|sure|continue|go ahead|proceed|stop|undo|next|thanks|ty)\b/i;

/**
 * A go-ahead with a tail — "go ahead do all of them", "ok merge it", "yes do both". It points at a
 * proposal already on the table, so asking what it means improves nothing. Capped at 8 words:
 * past that the tail is a new request and earns a score. A bare "continue" + task is deliberately
 * absent — "continue building the thing" is a task, not a go-ahead.
 */
const STEER_PHRASE =
  /^(go ahead|carry on|sounds good|agreed?|lgtm|ok(ay)?[,\s]+(do|go|merge|ship|proceed|fix|run)|yes[,\s]+(do|go|please|merge|ship|fix|run)|do (it|all|them|that|this|both|everything|the rest))\b/i;

export function wordCount(s) {
  return String(s ?? '').trim().split(/\s+/).filter(Boolean).length;
}

export function shouldBypass(prompt, env = process.env) {
  const p = String(prompt ?? '').trim();
  if (!p) return true;
  if (env.CORTEX_NO_OPTIMIZE === '1') return true;
  if (p.startsWith('/')) return true;                     // an explicit ritual is already named
  if (p.length > 2000) return true;                        // whitespace-poor paste (base64/minified) — word count won't catch it
  if (wordCount(p) > 60) return true;                       // already detailed
  if (STEER_WORDS.test(p) && wordCount(p) <= 2) return true; // "yes", "continue" — SHORT mid-flow steering only
  if (STEER_PHRASE.test(p) && wordCount(p) <= 8) return true; // "go ahead do all of them" — a go-ahead, not a new ask
  if (STATUS_QUESTION.test(p) && wordCount(p) <= 8) return true; // "is it done" — a status check, not a work request
  if (BYPASS_WORDS.test(p)) return true;                    // user signalled "small, don't ceremony this"
  if (FILE_LOCATOR.test(p)) return true;                    // exact target named
  return false;
}

export function scoreVagueness(prompt) {
  const p = String(prompt ?? '');
  let score = 0;
  if (wordCount(p) < 10) score += 2;
  if (!ACTION_VERBS.test(p)) score += 1;
  if (!namesComponent(p)) score += 1;
  if (!DOMAIN_WORDS.test(p)) score += 1;
  return score;
}

export function buildDirective(score) {
  return [
    `Prompt vagueness score ${score}/5.`,
    'Before acting, run /optimize-prompt (skills/optimize-prompt/SKILL.md):',
    "ask at most 2 questions grounded in this repo's real file and folder names,",
    'synthesize one precise prompt as [ACTION] [COMPONENT] [in DOMAIN] [with CONSTRAINTS] -> [RITUAL],',
    'show it and wait for a one-word confirmation,',
    'save it to docs/prompts/YYYY-MM-DD-<slug>.md, then hand off to the named ritual.',
  ].join(' ');
}

export function evaluate(prompt, env = process.env) {
  if (shouldBypass(prompt, env)) return null;
  const score = scoreVagueness(prompt);
  if (score < THRESHOLD) return null;
  return {
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext: buildDirective(score),
    },
  };
}

function main() {
  try {
    let payload = {};
    try { payload = JSON.parse(readFileSync(0, 'utf-8')); } catch { /* no/invalid stdin */ }
    const result = evaluate(payload && payload.prompt);
    if (result) process.stdout.write(JSON.stringify(result));
  } catch { /* never disrupt the session */ }
  process.exit(0);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
