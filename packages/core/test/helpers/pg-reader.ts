import pg from "pg";
import { buildColumnExpr } from "../../src/sql/build-column-expr";
import { hashContent, normalizedLength } from "../../src/detectors/heuristic/normalize";
import type { MappingV1 } from "../../src/schemas/mapping";
import type {
  ChunkRecord,
  DetectorReader,
  NearNeighborPair,
} from "../../src/detectors/heuristic/types";

/**
 * A minimal pg-backed DetectorReader for integration tests against the fixtures.
 * The production CLI reader (with full read-only enforcement) lands in PR-04;
 * this test reader only needs streaming + a server-side nearest-neighbor probe,
 * built from a MappingV1 via the core `buildColumnExpr` helper.
 */
export class PgReader implements DetectorReader {
  private readonly contentExpr: string;
  private readonly embeddingExpr: string;
  private readonly metadataExpr: string | null;
  private readonly updatedAtExpr: string | null;

  constructor(
    private readonly client: pg.Client,
    private readonly mapping: MappingV1,
  ) {
    const content = buildColumnExpr(mapping, "content");
    const embedding = buildColumnExpr(mapping, "embedding");
    if (content === null || embedding === null) {
      throw new Error("PgReader requires content and embedding columns");
    }
    this.contentExpr = content;
    this.embeddingExpr = embedding;
    this.metadataExpr = buildColumnExpr(mapping, "metadata");
    this.updatedAtExpr = buildColumnExpr(mapping, "updatedAt");
  }

  private get table(): string {
    return this.mapping.table;
  }

  async countChunks(): Promise<number> {
    const result = await this.client.query(`select count(*)::int as count from ${this.table}`);
    return result.rows[0].count;
  }

  async hasEmbeddings(): Promise<boolean> {
    const result = await this.client.query(
      `select 1 from ${this.table} where ${this.embeddingExpr} is not null limit 1`,
    );
    return (result.rowCount ?? 0) > 0;
  }

  async *streamChunks(options?: { maxChunks?: number }): AsyncIterable<ChunkRecord> {
    const limit = options?.maxChunks ? `limit ${Number(options.maxChunks)}` : "";
    const metadata = this.metadataExpr ? `${this.metadataExpr}` : "null";
    const updatedAt = this.updatedAtExpr ? `${this.updatedAtExpr}` : "null";
    const sql = `
      select ctid::text as ref,
             ${this.contentExpr} as content,
             vector_dims(${this.embeddingExpr}) as dims,
             ${metadata} as metadata,
             ${updatedAt} as updated_at
      from ${this.table}
      order by ctid
      ${limit}`;
    const result = await this.client.query(sql);
    for (const row of result.rows) {
      const content: string = row.content ?? "";
      const metadataValue = row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
        ? row.metadata
        : null;
      yield {
        ref: row.ref,
        contentHash: hashContent(content),
        contentSample: content.slice(0, 500),
        length: normalizedLength(content),
        metadata: metadataValue,
        embeddingDims: row.dims === null ? null : Number(row.dims),
        updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
      };
    }
  }

  async *probeNearestNeighbors(probeLimit: number): AsyncIterable<NearNeighborPair> {
    const sql = `
      with probe as (
        select ctid, ${this.contentExpr} as content, ${this.embeddingExpr} as embedding
        from ${this.table}
        where ${this.embeddingExpr} is not null
        order by ctid
        limit ${Number(probeLimit)}
      )
      select p.ctid::text as ref,
             n.ctid::text as neighbor_ref,
             1 - (p.embedding <=> n.embedding) as similarity,
             p.content as ref_content,
             n.content as neighbor_content
      from probe p
      cross join lateral (
        select t.ctid, ${this.contentExpr} as content, ${this.embeddingExpr} as embedding
        from ${this.table} t
        where t.ctid <> p.ctid
          and ${this.embeddingExpr} is not null
          and vector_dims(${this.embeddingExpr}) = vector_dims(p.embedding)
        order by p.embedding <=> ${this.embeddingExpr}
        limit 1
      ) n`;
    const result = await this.client.query(sql);
    for (const row of result.rows) {
      yield {
        ref: row.ref,
        neighborRef: row.neighbor_ref,
        similarity: Number(row.similarity),
        refContentHash: hashContent(row.ref_content ?? ""),
        neighborContentHash: hashContent(row.neighbor_content ?? ""),
      };
    }
  }
}
