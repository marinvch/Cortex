#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

interface WeekMetrics {
  weekStart: string;
  firstPassSuccessRate: number;
  toolCallSuccessRate: number;
  reworkRate: number;
  avgTimeToFixMinutes: number;
  contextHitRate: number;
  // Robustness KPIs (optional — populated when validation is run)
  skillContractPassRate?: number;
  startupProtocolCompliance?: number;
  severityReviewAdoption?: number;
  notes?: string;
  updatedAt: string;
}

interface ScorecardFile {
  version: number;
  updatedAt: string;
  weeks: WeekMetrics[];
}

const SCORECARD_PATH = path.resolve(import.meta.dirname, '../../.github/ai-os/metrics/scorecard.json');

function readScorecard(): ScorecardFile {
  if (!fs.existsSync(SCORECARD_PATH)) {
    return { version: 1, updatedAt: '', weeks: [] };
  }
  const raw = fs.readFileSync(SCORECARD_PATH, 'utf-8');
  const parsed = JSON.parse(raw) as Partial<ScorecardFile>;
  return {
    version: parsed.version ?? 1,
    updatedAt: parsed.updatedAt ?? '',
    weeks: Array.isArray(parsed.weeks) ? parsed.weeks : [],
  };
}

function writeScorecard(scorecard: ScorecardFile): void {
  fs.mkdirSync(path.dirname(SCORECARD_PATH), { recursive: true });
  fs.writeFileSync(SCORECARD_PATH, `${JSON.stringify(scorecard, null, 2)}\n`, 'utf-8');
}

function getArg(flag: string): string | undefined {
  return process.argv.find((arg) => arg.startsWith(`${flag}=`))?.slice(flag.length + 1);
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

function parsePercent(value: string | undefined, field: string): number {
  if (!value) {
    throw new Error(`Missing required argument: ${field}`);
  }
  const n = Number(value);
  if (!Number.isFinite(n)) {
    throw new Error(`Invalid numeric value for ${field}: ${value}`);
  }
  const normalized = n > 1 ? n / 100 : n;
  if (normalized < 0 || normalized > 1) {
    throw new Error(`${field} must be between 0 and 1 (or 0 and 100).`);
  }
  return Number(normalized.toFixed(4));
}

function parsePositive(value: string | undefined, field: string): number {
  if (!value) {
    throw new Error(`Missing required argument: ${field}`);
  }
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`${field} must be a non-negative number.`);
  }
  return Number(n.toFixed(2));
}

function resolveWeekStart(input: string | undefined): string {
  if (input) {
    const parsed = new Date(input);
    if (Number.isNaN(parsed.getTime())) {
      throw new Error(`Invalid date for --week: ${input}. Use YYYY-MM-DD.`);
    }
    return parsed.toISOString().slice(0, 10);
  }

  const now = new Date();
  const day = now.getUTCDay();
  const distanceToMonday = (day + 6) % 7;
  now.setUTCDate(now.getUTCDate() - distanceToMonday);
  return now.toISOString().slice(0, 10);
}

function showScorecard(scorecard: ScorecardFile): void {
  if (scorecard.weeks.length === 0) {
    console.log(`Scorecard has no weekly entries yet: ${SCORECARD_PATH}`);
    console.log('Add one with npm run scorecard:update -- --first-pass=0.8 --tool-success=0.95 --rework=0.15 --time-to-fix=30 --context-hit=0.7');
    return;
  }

  const latest = [...scorecard.weeks].sort((a, b) => b.weekStart.localeCompare(a.weekStart))[0];
  console.log(`Scorecard path: ${SCORECARD_PATH}`);
  console.log(`Last updated: ${scorecard.updatedAt}`);
  console.log(`Latest week: ${latest.weekStart}`);
  console.log(`- firstPassSuccessRate: ${(latest.firstPassSuccessRate * 100).toFixed(1)}%`);
  console.log(`- toolCallSuccessRate: ${(latest.toolCallSuccessRate * 100).toFixed(1)}%`);
  console.log(`- reworkRate: ${(latest.reworkRate * 100).toFixed(1)}%`);
  console.log(`- avgTimeToFixMinutes: ${latest.avgTimeToFixMinutes}`);
  console.log(`- contextHitRate: ${(latest.contextHitRate * 100).toFixed(1)}%`);
  if (latest.skillContractPassRate !== undefined) {
    console.log(`- skillContractPassRate: ${(latest.skillContractPassRate * 100).toFixed(1)}%`);
  }
  if (latest.startupProtocolCompliance !== undefined) {
    console.log(`- startupProtocolCompliance: ${(latest.startupProtocolCompliance * 100).toFixed(1)}%`);
  }
  if (latest.severityReviewAdoption !== undefined) {
    console.log(`- severityReviewAdoption: ${(latest.severityReviewAdoption * 100).toFixed(1)}%`);
  }
  if (latest.notes) {
    console.log(`- notes: ${latest.notes}`);
  }
}

function upsertWeek(scorecard: ScorecardFile): void {
  const weekStart = resolveWeekStart(getArg('--week'));
  const entry: WeekMetrics = {
    weekStart,
    firstPassSuccessRate: parsePercent(getArg('--first-pass'), '--first-pass'),
    toolCallSuccessRate: parsePercent(getArg('--tool-success'), '--tool-success'),
    reworkRate: parsePercent(getArg('--rework'), '--rework'),
    avgTimeToFixMinutes: parsePositive(getArg('--time-to-fix'), '--time-to-fix'),
    contextHitRate: parsePercent(getArg('--context-hit'), '--context-hit'),
    notes: getArg('--notes'),
    ...(getArg('--skill-contract') !== undefined ? { skillContractPassRate: parsePercent(getArg('--skill-contract'), '--skill-contract') } : {}),
    ...(getArg('--startup-protocol') !== undefined ? { startupProtocolCompliance: parsePercent(getArg('--startup-protocol'), '--startup-protocol') } : {}),
    ...(getArg('--severity-review') !== undefined ? { severityReviewAdoption: parsePercent(getArg('--severity-review'), '--severity-review') } : {}),
    updatedAt: new Date().toISOString(),
  };

  const existingIndex = scorecard.weeks.findIndex((w) => w.weekStart === weekStart);
  if (existingIndex >= 0) {
    scorecard.weeks[existingIndex] = entry;
  } else {
    scorecard.weeks.push(entry);
  }

  scorecard.weeks.sort((a, b) => a.weekStart.localeCompare(b.weekStart));
  scorecard.updatedAt = new Date().toISOString();
  writeScorecard(scorecard);
  console.log(`Updated weekly scorecard for ${weekStart} at ${SCORECARD_PATH}`);
}

function run(): void {
  const scorecard = readScorecard();

  if (hasFlag('--show')) {
    showScorecard(scorecard);
    return;
  }

  upsertWeek(scorecard);
}

try {
  run();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Scorecard update failed: ${message}`);
  process.exit(1);
}
