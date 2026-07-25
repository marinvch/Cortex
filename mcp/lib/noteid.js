// Team captures are one-file-per-note (`<date>-<id>.md`) and written with writeFileSync, so a
// duplicate id silently overwrites an earlier note in an append-only store. Timestamp+pid alone
// collides when two captures land in the same millisecond; the counter makes ids unique for the
// lifetime of the process, which is the only window where the other two components are equal.
let counter = 0;

/** Filesystem-safe by construction (base36 → [0-9a-z] + hyphen). Sorts by capture time. */
export function genNoteId(now = Date.now(), pid = process.pid) {
  const n = counter++;
  return `${now.toString(36)}-${pid.toString(36)}-${n.toString(36)}`;
}

/** Test seam — resets the per-process sequence. */
export function _resetCounter() {
  counter = 0;
}
