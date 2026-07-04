import { describe, expect, it } from "vitest";
import {
  DEFAULT_LIMITS,
  DEFAULT_THRESHOLDS,
  runHeuristicDetectors,
  type ChunkRecord,
  type DetectorContext,
  type DetectorReader,
  type NearNeighborPair,
} from "../src/detectors/heuristic";
import { hashContent, normalizedLength } from "../src/detectors/heuristic/normalize";
import type { MappingV1 } from "../src/schemas/mapping";

/**
 * Generates 100k synthetic chunks on the fly WITHOUT ever holding them all in
 * memory, proving the detectors stream (§9 PR-03: heap stays < 512 MB). A tiny
 * fraction are duplicates/thin/secret-bearing so every code path executes.
 */
class SyntheticReader implements DetectorReader {
  constructor(private readonly count: number) {}

  async countChunks(): Promise<number> {
    return this.count;
  }

  async hasEmbeddings(): Promise<boolean> {
    return true;
  }

  private content(i: number): string {
    if (i % 5000 === 0) return "Recurring duplicate paragraph that appears periodically across the corpus.";
    if (i % 3333 === 0) return "tiny";
    if (i % 7777 === 0) return "token sk-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 leaked into the docs somewhere.";
    return `Healthy chunk number ${i} with enough descriptive text to comfortably clear the thin-chunk length threshold and end properly.`;
  }

  async *streamChunks(): AsyncIterable<ChunkRecord> {
    for (let i = 0; i < this.count; i += 1) {
      const text = this.content(i);
      yield {
        ref: `r${i}`,
        contentHash: hashContent(text),
        contentSample: text,
        length: normalizedLength(text),
        metadata: null,
        embeddingDims: 1536,
        updatedAt: null,
      };
    }
  }

  async *probeNearestNeighbors(): AsyncIterable<NearNeighborPair> {
    // Near-duplicate probing is server-side in production; skip for the heap test.
    // No pairs yielded — the async generator simply completes.
    for (const pair of [] as NearNeighborPair[]) yield pair;
  }
}

const mapping: MappingV1 = {
  version: 1,
  dialect: "pgvector",
  table: "public.synthetic",
  columns: {
    content: "content",
    embedding: "embedding",
    metadata: null,
    documentId: null,
    sourceUrl: null,
    updatedAt: null,
  },
};

describe("streaming / memory safety", () => {
  it("processes 100k chunks with heap growth well under 512 MB", async () => {
    const count = 100_000;
    const ctx: DetectorContext = {
      systemId: "synthetic",
      mapping,
      reader: new SyntheticReader(count),
      sourceSnapshots: [],
      thresholds: DEFAULT_THRESHOLDS,
      limits: { ...DEFAULT_LIMITS, maxChunks: count },
      totalChunks: count,
    };

    if (global.gc) global.gc();
    const before = process.memoryUsage().heapUsed;
    const result = await runHeuristicDetectors(ctx);
    const after = process.memoryUsage().heapUsed;

    const growthMb = (after - before) / (1024 * 1024);
    expect(result.stats.totalChunks).toBe(count);
    expect(result.findings.length).toBeGreaterThan(0);
    expect(growthMb).toBeLessThan(512);
  }, 120_000);
});
