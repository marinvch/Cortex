import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Score at or above which the optimizer fires. Tune here after reviewing docs/prompts/. */
export const THRESHOLD = 4;

const ACTION_VERBS =
  /\b(add|create|update|delete|fix|remove|migrate|refactor|write|build|review|audit|explain|document|test|tests|rename|move|debug|optimi[sz]e|install|scan|implement|generate|wire|split|merge|run)\b/i;

const DOMAIN_WORDS =
  /\b(auth|db|database|api|ui|schema|test|tests|hook|hooks|skill|skills|vault|graph|mcp|git|ci|cli|docs?|readme|agents?|prompt|prompts)\b/i;

/** Broad "you named something concrete" signal: path, filename, `backtick`, #123, URL. */
const COMPONENT_REF =
  /(`[^`]+`)|(\b[\w.-]+\/[\w./-]+)|(\b\w[\w-]+\.[A-Za-z][A-Za-z0-9]{0,4}\b)|(#\d+)|(https?:\/\/)/i;

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
  if (!COMPONENT_REF.test(p)) score += 1;
  if (!DOMAIN_WORDS.test(p)) score += 1;
  return score;
}

export function buildDirective(score) {
  return [
    `Prompt vagueness score ${score}/5.`,
    'Before acting, run the Prompt Optimization Protocol (skills/optimize-prompt/SKILL.md):',
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
