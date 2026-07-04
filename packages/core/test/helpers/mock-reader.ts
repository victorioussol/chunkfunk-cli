import type { JsonObject } from "../../src/schemas/json";
import { hashContent, normalizedLength } from "../../src/detectors/heuristic/normalize";
import type {
  ChunkRecord,
  DetectorReader,
  NearNeighborPair,
} from "../../src/detectors/heuristic/types";

export interface MockChunk {
  ref: string;
  content: string;
  embedding?: number[] | null;
  metadata?: JsonObject | null;
  updatedAt?: string | null;
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

/** In-memory DetectorReader for unit tests; mirrors the pg reader's contract. */
export class MockReader implements DetectorReader {
  constructor(private readonly chunks: MockChunk[]) {}

  private toRecord(chunk: MockChunk): ChunkRecord {
    const embedding = chunk.embedding ?? null;
    return {
      ref: chunk.ref,
      contentHash: hashContent(chunk.content),
      contentSample: chunk.content.slice(0, 500),
      length: normalizedLength(chunk.content),
      metadata: chunk.metadata ?? null,
      embeddingDims: embedding === null ? null : embedding.length,
      updatedAt: chunk.updatedAt ?? null,
    };
  }

  async countChunks(): Promise<number> {
    return this.chunks.length;
  }

  async hasEmbeddings(): Promise<boolean> {
    return this.chunks.some((c) => (c.embedding ?? null) !== null);
  }

  async *streamChunks(options?: { maxChunks?: number }): AsyncIterable<ChunkRecord> {
    let source = this.chunks;
    const max = options?.maxChunks;
    if (max !== undefined && this.chunks.length > max) {
      // Deterministic sample: stable ref order, take the first `max`.
      source = [...this.chunks].sort((a, b) => a.ref.localeCompare(b.ref)).slice(0, max);
    }
    for (const chunk of source) {
      yield this.toRecord(chunk);
    }
  }

  async *probeNearestNeighbors(probeLimit: number): AsyncIterable<NearNeighborPair> {
    const withEmbeddings = this.chunks.filter((c) => (c.embedding ?? null) !== null);
    const probes = withEmbeddings.slice(0, probeLimit);
    for (const probe of probes) {
      let best: MockChunk | null = null;
      let bestSim = Number.NEGATIVE_INFINITY;
      for (const candidate of withEmbeddings) {
        if (candidate.ref === probe.ref) continue;
        const sim = cosine(probe.embedding as number[], candidate.embedding as number[]);
        if (sim > bestSim) {
          bestSim = sim;
          best = candidate;
        }
      }
      if (best === null) continue;
      yield {
        ref: probe.ref,
        neighborRef: best.ref,
        similarity: bestSim,
        refContentHash: hashContent(probe.content),
        neighborContentHash: hashContent(best.content),
      };
    }
  }
}
