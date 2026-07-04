export {
  normalizeContent,
  hashContent,
  normalizedLength,
} from "./normalize";
export {
  DEFAULT_THRESHOLDS,
  DEFAULT_LIMITS,
  type ChunkRecord,
  type NearNeighborPair,
  type SourceSnapshot,
  type DetectorReader,
  type DetectorThresholds,
  type DetectorLimits,
  type DetectorContext,
  type Detector,
} from "./types";
export { runExactDuplicate, type ExactDuplicateResult } from "./exact-duplicate";
export { runNearDuplicate, type NearDuplicateResult } from "./near-duplicate";
export { runThinChunk, type ThinChunkResult } from "./thin-chunk";
export { runRiskyChunk, type RiskyChunkResult } from "./risky-chunk";
export { runFreshness, type FreshnessResult } from "./freshness";
export {
  runEmbeddingIntegrity,
  type EmbeddingIntegrityResult,
} from "./embedding-integrity";
export { runHeuristicDetectors, type HeuristicRunResult } from "./run";
