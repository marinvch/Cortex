// Date formatting shared by everything that writes a dated artifact: memory files, findings
// reports, digests. It lives in core so that a CLI needing today's stamp does not have to import
// the memory module to get one — reaching through a feature module for a helper is how packages
// grow dependencies they do not actually have.

function pad(n) {
  return String(n).padStart(2, "0");
}

/** `YYYY-MM-DD`. Takes an explicit Date so callers and tests stay deterministic. */
export function stamp(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** `HH:MM`, local time. */
export function clock(date = new Date()) {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
