#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

interface WeekMetrics {
  weekStart: string;
  skillContractPassRate?: number;
  startupProtocolCompliance?: number;
  severityReviewAdoption?: number;
}

interface ScorecardFile {
  weeks: WeekMetrics[];
}

const SCORECARD_PATH = path.resolve(import.meta.dirname, '../../.github/ai-os/metrics/scorecard.json');

// Minimum thresholds for robustness KPIs (when present in the scorecard entry)
const ROBUSTNESS_THRESHOLDS: Record<keyof Omit<WeekMetrics, 'weekStart'>, number> = {
  skillContractPassRate: 0.9,
  startupProtocolCompliance: 0.8,
  severityReviewAdoption: 0.7,
};

function getArgValue(flag: string): string | undefined {
  return process.argv.find((arg) => arg.startsWith(`${flag}=`))?.slice(flag.length + 1);
}

function parseMaxAgeDays(): number {
  const raw = getArgValue('--max-age-days');
  if (!raw) {
    return 14;
  }

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error('--max-age-days must be a positive integer.');
  }

  return parsed;
}

function readScorecard(): ScorecardFile {
  if (!fs.existsSync(SCORECARD_PATH)) {
    throw new Error(`Scorecard file not found: ${SCORECARD_PATH}`);
  }

  const raw = fs.readFileSync(SCORECARD_PATH, 'utf-8');
  const parsed = JSON.parse(raw) as Partial<ScorecardFile>;

  if (!Array.isArray(parsed.weeks)) {
    throw new Error('Scorecard file is missing a valid weeks array.');
  }

  return { weeks: parsed.weeks };
}

function checkRobustnessKpis(latest: WeekMetrics): void {
  const kpiKeys = Object.keys(ROBUSTNESS_THRESHOLDS) as Array<keyof typeof ROBUSTNESS_THRESHOLDS>;
  const failures: string[] = [];

  for (const key of kpiKeys) {
    const value = latest[key];
    if (value === undefined) continue; // KPI not yet tracked — skip without failing
    const threshold = ROBUSTNESS_THRESHOLDS[key];
    const pct = (value * 100).toFixed(1);
    const thresholdPct = (threshold * 100).toFixed(1);
    if (value < threshold) {
      failures.push(`${key}: ${pct}% is below threshold ${thresholdPct}%`);
    } else {
      console.log(`  Robustness KPI ${key}: ${pct}% ✓ (threshold ${thresholdPct}%)`);
    }
  }

  if (failures.length > 0) {
    throw new Error(`Robustness KPI threshold failures:\n${failures.map(f => `  - ${f}`).join('\n')}`);
  }
}

function daysSince(isoDate: string): number {
  const start = new Date(`${isoDate}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime())) {
    throw new Error(`Invalid weekStart date: ${isoDate}`);
  }

  const now = new Date();
  const diffMs = now.getTime() - start.getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

function getLatestWeekStart(weeks: WeekMetrics[]): string {
  if (weeks.length === 0) {
    throw new Error('Scorecard has no weekly entries.');
  }

  const sorted = [...weeks]
    .map((w) => w.weekStart)
    .sort((a, b) => b.localeCompare(a));

  return sorted[0];
}

function run(): void {
  const maxAgeDays = parseMaxAgeDays();
  const scorecard = readScorecard();
  const latestWeekStart = getLatestWeekStart(scorecard.weeks);
  const ageDays = daysSince(latestWeekStart);

  if (ageDays > maxAgeDays) {
    throw new Error(
      `Latest scorecard week (${latestWeekStart}) is ${ageDays} days old. Update metrics with npm run scorecard:update.`
    );
  }

  console.log(
    `Scorecard freshness check passed: latest week ${latestWeekStart} is ${ageDays} days old (max ${maxAgeDays}).`
  );

  const latest = scorecard.weeks.find(w => w.weekStart === latestWeekStart);
  if (latest) {
    checkRobustnessKpis(latest);
  }
}

try {
  run();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Scorecard check failed: ${message}`);
  process.exit(1);
}
