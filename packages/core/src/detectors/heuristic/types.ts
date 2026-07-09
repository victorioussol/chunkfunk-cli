import type { JsonObject } from "../../schemas/json";
import type { MappingV1 } from "../../schemas/mapping";
import type { FindingSeverity, FindingV1, SuggestedRepair } from "../../schemas/report";

/**
 * One chunk as seen by detectors. The reader NEVER exposes full document text —
 * only an in-process 500-char sample for private heuristics, plus a hash and
 * length computed from the normalized content (§5). Detectors must not place
 * the sample in report evidence.
 */
export interface ChunkRecord {
  ref: string;
  /** sha256 of normalized content (see normalize.ts). */
  contentHash: string;
  /** First 500 chars of the RAW content, for private text heuristics only. */
  contentSample: string;
  /** Normalized content length. */
  length: number;
  metadata: JsonObject | null;
  /** Embedding dimensionality for this row; null when the embedding is NULL. */
  embeddingDims: number | null;
  /** ISO timestamp of the mapped updatedAt column/path; null when unmapped. */
  updatedAt: string | null;
  /** True when a mapped source URL or document id is present; null when unmapped. */
  sourceLocatorPresent: boolean | null;
}

/** A nearest-neighbor pair produced server-side by pgvector (§5.2). */
export interface NearNeighborPair {
  ref: string;
  neighborRef: string;
  similarity: number;
  refContentHash: string;
  neighborContentHash: string;
}

export interface ArchitectureSignal {
  severity: FindingSeverity;
  title: string;
  evidence: JsonObject;
  suggestedRepair?: SuggestedRepair | null;
  affectedCount?: number;
}

/** A watcher signal snapshot for a source (§5.5). */
export interface SourceSnapshot {
  locator: string;
  signalKind: string;
  signalValue: string;
  observedAt: string;
  /** True when this signal differs from the previously stored snapshot. */
  changed: boolean;
}

/**
 * Read-only access to the user's RAG database. Implemented by the CLI reader
 * (PR-04) and by test readers here. Detectors depend only on this interface.
 */
export interface DetectorReader {
  countChunks(): Promise<number>;
  /**
   * Streams chunk records. Implementations MUST NOT buffer the whole table.
   * When `maxChunks` is provided and the corpus is larger, a deterministic
   * sample (seeded by system id) of that size is streamed instead.
   */
  streamChunks(options?: { maxChunks?: number }): AsyncIterable<ChunkRecord>;
  /**
   * Server-side pgvector probe: for up to `probeLimit` sampled chunks, the
   * single nearest other chunk by cosine similarity. Returns null capability
   * when there is no usable embedding column.
   */
  probeNearestNeighbors(probeLimit: number): AsyncIterable<NearNeighborPair>;
  /** Whether an embedding column exists and is populated for at least one row. */
  hasEmbeddings(): Promise<boolean>;
  /** Optional read-only catalog checks provided by concrete readers. */
  inspectArchitecture?(): Promise<ArchitectureSignal[]>;
}

export interface DetectorThresholds {
  nearDuplicateCosine: number;
  thinChunkMinChars: number;
  linkNavDensity: number;
}

export interface DetectorLimits {
  maxChunks: number;
  nearDupProbes: number;
}

export interface InventoryExpectations {
  minChunks?: number;
  minDocuments?: number;
  /** Null when document counts cannot be measured because no document id is mapped. */
  observedDocuments?: number | null;
}

export const DEFAULT_THRESHOLDS: DetectorThresholds = {
  nearDuplicateCosine: 0.97,
  thinChunkMinChars: 120,
  linkNavDensity: 0.6,
};

export const DEFAULT_LIMITS: DetectorLimits = {
  maxChunks: 50_000,
  nearDupProbes: 2_000,
};

export interface DetectorContext {
  systemId: string;
  mapping: MappingV1;
  reader: DetectorReader;
  sourceSnapshots: SourceSnapshot[];
  thresholds: DetectorThresholds;
  limits: DetectorLimits;
  /** Set by the orchestrator when the corpus exceeded maxChunks and was sampled. */
  sampled?: boolean;
  /** Corpus size (pre-sampling), used for corpus-rate calculations. */
  totalChunks: number;
  /** Optional operator-provided inventory expectations; never inferred. */
  inventory?: InventoryExpectations;
}

export interface Detector {
  id: string;
  run(ctx: DetectorContext): Promise<FindingV1[]>;
}
