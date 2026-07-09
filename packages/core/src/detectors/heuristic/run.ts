import {
  computeHealthScore,
  duplicationSubscore,
  freshnessSubscore,
  qualitySubscore,
  riskSubscore,
} from "../../health";
import { HEALTH_SCORE_VERSION } from "../../health";
import type { FindingV1, HealthSubscores } from "../../schemas/report";
import { runArchitecture } from "./architecture";
import { runEmbeddingIntegrity } from "./embedding-integrity";
import { runExactDuplicate } from "./exact-duplicate";
import { runFreshness } from "./freshness";
import { runNearDuplicate } from "./near-duplicate";
import { runRiskyChunk } from "./risky-chunk";
import { runThinChunk } from "./thin-chunk";
import type { DetectorContext } from "./types";

export interface HeuristicRunResult {
  findings: FindingV1[];
  subscores: HealthSubscores;
  score: number;
  scoreVersion: number;
  stats: {
    totalChunks: number;
    exactDuplicateGroups: number;
    exactDuplicateRows: number;
    exactDuplicatePct: number;
    nearDuplicatePairs: number;
    nearDuplicatePct: number;
    thinChunks: number;
    thinPct: number;
    riskyCritical: number;
    riskyWarning: number;
    nullEmbeddings: number;
    distinctEmbeddingDims: number[];
    largeChunksPct: number;
    staleDocsPct: number | null;
  };
}

/**
 * Runs every heuristic detector (§5) against the context, aggregates the findings,
 * and derives the v1 health subscores + score (§5.7). Coverage starts with
 * metadata filterability; richer retrieval tests can refine it later.
 */
export async function runHeuristicDetectors(
  ctx: DetectorContext,
): Promise<HeuristicRunResult> {
  // Sequential: each detector streams the corpus (or probes) over the reader's
  // single connection; concurrent queries on one pg client are unsafe.
  const exact = await runExactDuplicate(ctx);
  const near = await runNearDuplicate(ctx);
  const thin = await runThinChunk(ctx);
  const risky = await runRiskyChunk(ctx);
  const freshness = await runFreshness(ctx);
  const embedding = await runEmbeddingIntegrity(ctx);
  const architecture = await runArchitecture(ctx);

  const findings = [
    ...exact.findings,
    ...near.findings,
    ...thin.findings,
    ...risky.findings,
    ...freshness.findings,
    ...embedding.findings,
    ...architecture.findings,
  ];

  const subscores: HealthSubscores = {
    freshness:
      freshness.staleDocsPct === null ? null : freshnessSubscore(freshness.staleDocsPct),
    duplication: duplicationSubscore(exact.corpusPct, near.estimatedCorpusPct),
    quality: architecture.emptyTable ? 0 : qualitySubscore(thin.corpusPct + architecture.largeChunkPct),
    risk: riskSubscore(risky.criticalCount, risky.warningCount),
    coverage: architecture.coverageScore,
  };

  return {
    findings,
    subscores,
    score: computeHealthScore(subscores),
    scoreVersion: HEALTH_SCORE_VERSION,
    stats: {
      totalChunks: ctx.totalChunks,
      exactDuplicateGroups: exact.groups,
      exactDuplicateRows: exact.memberRows,
      exactDuplicatePct: exact.corpusPct,
      nearDuplicatePairs: near.pairs,
      nearDuplicatePct: near.estimatedCorpusPct,
      thinChunks: thin.thinCount,
      thinPct: thin.corpusPct,
      riskyCritical: risky.criticalCount,
      riskyWarning: risky.warningCount,
      nullEmbeddings: embedding.nullEmbeddings,
      distinctEmbeddingDims: embedding.distinctDims,
      largeChunksPct: architecture.largeChunkPct,
      staleDocsPct: freshness.staleDocsPct,
    },
  };
}
