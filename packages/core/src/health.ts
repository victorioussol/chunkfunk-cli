import type { HealthSubscores } from "./schemas/report";

export const HEALTH_SCORE_VERSION = 1;

/**
 * Health score v1 weights (§5.7):
 * score = round(0.30*freshness + 0.20*duplication + 0.20*quality + 0.10*risk + 0.20*coverage)
 */
export const HEALTH_WEIGHTS: Record<keyof HealthSubscores, number> = {
  freshness: 0.3,
  duplication: 0.2,
  quality: 0.2,
  risk: 0.1,
  coverage: 0.2,
};

/**
 * Combine subscores into the 0-100 health score. When a nullable subscore
 * (freshness, coverage) is unmeasurable (null), its weight is redistributed
 * proportionally across the measured subscores (§5.7).
 */
export function computeHealthScore(subscores: HealthSubscores): number {
  const measured = (
    Object.keys(HEALTH_WEIGHTS) as (keyof HealthSubscores)[]
  ).flatMap((key) => {
    const value = subscores[key];
    return value === null ? [] : [{ weight: HEALTH_WEIGHTS[key], value }];
  });
  const totalWeight = measured.reduce((sum, entry) => sum + entry.weight, 0);
  const score = measured.reduce(
    (sum, entry) => sum + (entry.weight / totalWeight) * entry.value,
    0,
  );
  return Math.round(score);
}

/** freshness = 100 − min(100, stale_docs_pct*2); pct is 0-100. */
export function freshnessSubscore(staleDocsPct: number): number {
  return 100 - Math.min(100, staleDocsPct * 2);
}

/** duplication = 100 − min(100, (exact_dup_pct + near_dup_est_pct)*2.5); pcts are 0-100. */
export function duplicationSubscore(
  exactDupPct: number,
  nearDupEstPct: number,
): number {
  return 100 - Math.min(100, (exactDupPct + nearDupEstPct) * 2.5);
}

/** quality = 100 − min(100, thin_pct*2); pct is 0-100. */
export function qualitySubscore(thinPct: number): number {
  return 100 - Math.min(100, thinPct * 2);
}

/** risk = 100 − (25 per critical risky finding, 5 per warning), floor 0. */
export function riskSubscore(
  criticalCount: number,
  warningCount: number,
): number {
  return Math.max(0, 100 - 25 * criticalCount - 5 * warningCount);
}

/** coverage = tests passed/total*100; null until tests exist. */
export function coverageSubscore(
  passed: number,
  total: number,
): number | null {
  if (total <= 0) {
    return null;
  }
  return (passed / total) * 100;
}
