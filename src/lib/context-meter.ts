/** Warn thresholds: green below 70%, amber below 90%, red at/above 90%. */
export const CONTEXT_WARN_PERCENT = 70;
export const CONTEXT_CRITICAL_PERCENT = 90;

/**
 * Bar fill color for a context-usage percentage. Pure helper so tests can pin
 * the green → amber → red ladder without rendering.
 */
export function contextMeterBarClass(percentage: number): string {
  if (percentage >= CONTEXT_CRITICAL_PERCENT) return 'bg-red-500/90';
  if (percentage >= CONTEXT_WARN_PERCENT) return 'bg-amber-500/90';
  return 'bg-emerald-500/90';
}
