import pg from "pg";
import QueryStream from "pg-query-stream";
import {
  buildColumnExpr,
  hashContent,
  normalizedLength,
  type ArchitectureSignal,
  type ChunkRecord,
  type DetectorReader,
  type MappingV1,
  type NearNeighborPair,
} from "@chunkfunk/core";
import { quoteIdent } from "./identifiers";

const { Pool } = pg;

export interface ColumnInfo {
  name: string;
  udtName: string;
  dataType: string;
}

export interface CandidateTable {
  schema: string;
  name: string;
  /** schema-qualified, e.g. `public.langchain_pg_embedding`. */
  qualified: string;
  columns: ColumnInfo[];
  vectorColumns: string[];
  estimatedRows: number | null;
}

/**
 * The SINGLE gateway to a user's database (§4.2). Every session is opened
 * read-only (`default_transaction_read_only = on`) and this module issues only
 * SELECT statements — a unit test greps the package to prove no write keyword is
 * ever sent. Large scans stream through a server-side cursor (pg-query-stream)
 * and, above `maxChunks`, a deterministic sample seeded by the system id.
 */
export class UserDbReader implements DetectorReader {
  private readonly pool: pg.Pool;
  private mapping: MappingV1 | null = null;
  private systemSeed = "chunkfunk";

  constructor(connectionString: string) {
    // `default_transaction_read_only = on` is applied as a startup parameter so
    // every session is read-only from its very first statement (§4.2) — no race
    // with a post-connect SET, and any write is rejected by the server.
    this.pool = new Pool({
      connectionString,
      max: 4,
      options: "-c default_transaction_read_only=on",
    });
  }

  setMapping(mapping: MappingV1): void {
    this.mapping = mapping;
  }

  setSystemSeed(seed: string): void {
    this.systemSeed = seed;
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  private requireMapping(): MappingV1 {
    if (this.mapping === null) throw new Error("reader mapping is not set");
    return this.mapping;
  }

  private mappedExpr(field: Parameters<typeof buildColumnExpr>[1]): string | null {
    return buildColumnExpr(this.requireMapping(), field);
  }

  // --- Introspection (schema-only; no mapping required) --------------------

  /** Tables that own at least one pgvector column, plus the `vecs` schema. */
  async listCandidateTables(): Promise<CandidateTable[]> {
    const result = await this.pool.query<{
      table_schema: string;
      table_name: string;
      column_name: string;
      udt_name: string;
      data_type: string;
    }>(
      `select table_schema, table_name, column_name, udt_name, data_type
       from information_schema.columns
       where table_schema not in ('pg_catalog', 'information_schema')
       order by table_schema, table_name, ordinal_position`,
    );
    const estimates = await this.pool.query<{
      table_schema: string;
      table_name: string;
      estimated_rows: string;
    }>(
      `select n.nspname as table_schema,
              c.relname as table_name,
              greatest(c.reltuples, 0)::bigint as estimated_rows
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       where c.relkind in ('r', 'p')`,
    );
    const estimatedRowsByTable = new Map(
      estimates.rows.map((row) => [
        `${row.table_schema}.${row.table_name}`,
        Number(row.estimated_rows),
      ]),
    );

    const byTable = new Map<string, CandidateTable>();
    for (const row of result.rows) {
      const key = `${row.table_schema}.${row.table_name}`;
      let table = byTable.get(key);
      if (!table) {
        table = {
          schema: row.table_schema,
          name: row.table_name,
          qualified: key,
          columns: [],
          vectorColumns: [],
          estimatedRows: estimatedRowsByTable.get(key) ?? null,
        };
        byTable.set(key, table);
      }
      table.columns.push({
        name: row.column_name,
        udtName: row.udt_name,
        dataType: row.data_type,
      });
      if (row.udt_name === "vector") table.vectorColumns.push(row.column_name);
    }

    return [...byTable.values()].filter(
      (t) => t.vectorColumns.length > 0 || t.schema === "vecs",
    );
  }

  /** Top-level JSON keys sampled from up to 20 rows of a jsonb column. */
  async sampleJsonKeys(qualifiedTable: string, column: string): Promise<string[]> {
    const table = quoteIdent(qualifiedTable);
    const col = quoteIdent(column);
    const result = await this.pool.query<{ k: string }>(
      `select distinct k from (
         select ${col} as m from ${table} where ${col} is not null limit 20
       ) rows, lateral jsonb_object_keys(rows.m) as k`,
    );
    return result.rows.map((r) => r.k);
  }

  /** Average character length of a text-like column, sampled over ≤200 rows. */
  async averageTextLength(qualifiedTable: string, column: string): Promise<number> {
    const table = quoteIdent(qualifiedTable);
    const col = quoteIdent(column);
    const result = await this.pool.query<{ avg: number | null }>(
      `select avg(length(${col}::text))::float as avg from (
         select ${col} from ${table} where ${col} is not null limit 200
       ) s`,
    );
    return result.rows[0]?.avg ?? 0;
  }

  /** A few sample rows for a set of columns (for the interactive preview). */
  async sampleRows(
    qualifiedTable: string,
    columns: string[],
    limit = 3,
  ): Promise<Record<string, unknown>[]> {
    const table = quoteIdent(qualifiedTable);
    const cols = columns.map((c) => `${quoteIdent(c)} as ${quoteIdent(c)}`).join(", ");
    const result = await this.pool.query(
      `select ${cols} from ${table} limit ${Number(limit)}`,
    );
    return result.rows;
  }

  /** Embedding dimensionality from the first non-null row of a vector column. */
  async embeddingDimensions(
    qualifiedTable: string,
    column: string,
  ): Promise<number | null> {
    const table = quoteIdent(qualifiedTable);
    const col = quoteIdent(column);
    const result = await this.pool.query<{ dims: number | null }>(
      `select vector_dims(${col}) as dims from ${table} where ${col} is not null limit 1`,
    );
    return result.rows[0]?.dims ?? null;
  }

  // --- DetectorReader (mapping required) -----------------------------------

  async countChunks(): Promise<number> {
    const table = quoteIdent(this.requireMapping().table);
    const result = await this.pool.query<{ count: string }>(
      `select count(*)::int as count from ${table}`,
    );
    return Number(result.rows[0].count);
  }

  /** Distinct document count when a documentId is mapped; null otherwise. */
  async countDistinctDocuments(): Promise<number | null> {
    const expr = this.mappedExpr("documentId");
    if (expr === null) return null;
    const table = quoteIdent(this.requireMapping().table);
    const result = await this.pool.query<{ count: string }>(
      `select count(distinct ${expr})::int as count from ${table}`,
    );
    return Number(result.rows[0].count);
  }

  async hasEmbeddings(): Promise<boolean> {
    const embedding = this.mappedExpr("embedding");
    if (embedding === null) return false;
    const table = quoteIdent(this.requireMapping().table);
    const result = await this.pool.query(
      `select 1 from ${table} where ${embedding} is not null limit 1`,
    );
    return (result.rowCount ?? 0) > 0;
  }

  async inspectArchitecture(): Promise<ArchitectureSignal[]> {
    const mapping = this.requireMapping();
    const rawEmbeddingColumn = mapping.columns.embedding;
    if (rawEmbeddingColumn === null || rawEmbeddingColumn.startsWith("meta:")) return [];

    const tableParts = mapping.table.split(".");
    const schema = tableParts.length > 1 ? tableParts[0] : "public";
    const tableName = tableParts.length > 1 ? tableParts.slice(1).join(".") : mapping.table;
    const embeddingColumn = rawEmbeddingColumn.split(".").at(-1) ?? rawEmbeddingColumn;

    const indexInfo = await this.pool.query<{
      estimated_rows: string;
      index_name: string | null;
      index_method: string | null;
      columns: string[] | null;
      index_def: string | null;
    }>(
      `select greatest(tbl.reltuples, 0)::bigint as estimated_rows,
              idx.relname as index_name,
              am.amname as index_method,
              array_remove(array_agg(att.attname order by key.ord), null) as columns,
              pg_get_indexdef(idx.oid) as index_def
       from pg_class tbl
       join pg_namespace ns on ns.oid = tbl.relnamespace
       left join pg_index i on i.indrelid = tbl.oid
       left join pg_class idx on idx.oid = i.indexrelid
       left join pg_am am on am.oid = idx.relam
       left join lateral unnest(i.indkey) with ordinality as key(attnum, ord) on true
       left join pg_attribute att on att.attrelid = tbl.oid and att.attnum = key.attnum
       where ns.nspname = $1 and tbl.relname = $2 and tbl.relkind in ('r', 'p')
       group by tbl.reltuples, idx.oid, idx.relname, am.amname
       order by idx.relname`,
      [schema, tableName],
    );

    const estimatedRows = Math.max(
      0,
      ...indexInfo.rows.map((row) => Number(row.estimated_rows)),
    );
    const indexes = indexInfo.rows.filter((row) => row.index_name !== null);
    const vectorIndexes = indexes.filter((row) => row.columns?.includes(embeddingColumn));
    const approxVectorIndexes = vectorIndexes.filter((row) => row.index_method === "hnsw" || row.index_method === "ivfflat");

    const signals: ArchitectureSignal[] = [];
    if (approxVectorIndexes.length === 0 && estimatedRows >= 100) {
      const severity = estimatedRows >= 1_000 ? "warning" : "info";
      signals.push({
        severity,
        title:
          severity === "warning"
            ? "Mapped embedding column has no approximate vector index"
            : "Mapped embedding column has no approximate vector index yet",
        evidence: {
          table: mapping.table,
          embeddingColumn,
          estimatedRows,
          existingIndexMethods: [...new Set(vectorIndexes.map((row) => row.index_method).filter(Boolean))],
        },
        suggestedRepair: {
          kind: "add_vector_index",
          description: "Add an HNSW or IVFFlat index when this table is large enough for approximate vector search.",
        },
        affectedCount: 1,
      });
    }

    const candidate = (await this.listCandidateTables()).find((table) => table.qualified === mapping.table);
    const extraVectorColumns = candidate?.vectorColumns.filter((column) => column !== embeddingColumn) ?? [];
    if (extraVectorColumns.length > 0) {
      signals.push({
        severity: "info",
        title: "Mapped table has multiple vector columns",
        evidence: {
          table: mapping.table,
          mappedEmbeddingColumn: embeddingColumn,
          otherVectorColumns: extraVectorColumns,
        },
        suggestedRepair: {
          kind: "verify_embedding_column",
          description: "Verify the mapped embedding column is the one used by production retrieval, especially after embedding-model migrations.",
        },
        affectedCount: extraVectorColumns.length,
      });
    }

    const approxIndexesOnOtherVectorColumns = indexes.filter((row) => {
      const cols = row.columns ?? [];
      return (
        (row.index_method === "hnsw" || row.index_method === "ivfflat") &&
        !cols.includes(embeddingColumn) &&
        cols.some((column) => extraVectorColumns.includes(column))
      );
    });
    if (approxIndexesOnOtherVectorColumns.length > 0 && approxVectorIndexes.length === 0) {
      signals.push({
        severity: "warning",
        title: "Vector index exists on a different embedding column",
        evidence: {
          table: mapping.table,
          mappedEmbeddingColumn: embeddingColumn,
          indexedVectorColumns: approxIndexesOnOtherVectorColumns.map((row) => ({
            index: row.index_name,
            method: row.index_method,
            columns: row.columns ?? [],
          })),
        },
        suggestedRepair: {
          kind: "verify_embedding_index",
          description: "Verify the mapped embedding column and retrieval index agree before trusting production search behavior.",
        },
        affectedCount: approxIndexesOnOtherVectorColumns.length,
      });
    }

    return signals;
  }

  async *streamChunks(options?: { maxChunks?: number }): AsyncIterable<ChunkRecord> {
    const mapping = this.requireMapping();
    const contentExpr = this.mappedExpr("content");
    const embeddingExpr = this.mappedExpr("embedding");
    if (contentExpr === null || embeddingExpr === null) {
      throw new Error("mapping is missing content or embedding");
    }
    const updatedAtExpr = this.mappedExpr("updatedAt") ?? "null";
    const metadataExpr = this.mappedExpr("metadata") ?? "null";
    const locatorExprs = [this.mappedExpr("sourceUrl"), this.mappedExpr("documentId")]
      .filter((expr): expr is string => expr !== null);
    const sourceLocatorPresentExpr = locatorExprs.length > 0
      ? `(${locatorExprs.map((expr) => `nullif(btrim((${expr})::text), '') is not null`).join(" or ")})`
      : "null";
    const table = quoteIdent(mapping.table);

    const max = options?.maxChunks;
    let ordering = "order by ctid";
    const params: unknown[] = [];
    if (max !== undefined) {
      const total = await this.countChunks();
      if (total > max) {
        // Deterministic sample seeded by the system id (§5 sampling rule).
        ordering = "order by md5(ctid::text || $1)";
        params.push(this.systemSeed);
      }
    }
    const limitClause = max !== undefined ? `limit ${Number(max)}` : "";

    const sql = `select ctid::text as ref,
                        ${contentExpr} as content,
                        vector_dims(${embeddingExpr}) as dims,
                        ${updatedAtExpr} as updated_at,
                        ${metadataExpr} as metadata,
                        ${sourceLocatorPresentExpr} as source_locator_present
                 from ${table}
                 ${ordering}
                 ${limitClause}`;

    const client = await this.pool.connect();
    try {
      const stream = client.query(new QueryStream(sql, params, { batchSize: 500 }));
      for await (const row of stream as AsyncIterable<{
        ref: string;
        content: string | null;
        dims: number | null;
        updated_at: Date | string | null;
        metadata: unknown;
        source_locator_present: boolean | null;
      }>) {
        const content = row.content ?? "";
        const metadata = row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
          ? row.metadata as ChunkRecord["metadata"]
          : null;
        yield {
          ref: row.ref,
          contentHash: hashContent(content),
          contentSample: content.slice(0, 500),
          length: normalizedLength(content),
          metadata,
          embeddingDims: row.dims === null ? null : Number(row.dims),
          updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
          sourceLocatorPresent: row.source_locator_present === null
            ? null
            : Boolean(row.source_locator_present),
        };
      }
    } finally {
      client.release();
    }
  }

  async *probeNearestNeighbors(probeLimit: number): AsyncIterable<NearNeighborPair> {
    const mapping = this.requireMapping();
    const contentExpr = this.mappedExpr("content");
    const embeddingExpr = this.mappedExpr("embedding");
    if (contentExpr === null || embeddingExpr === null) return;
    const table = quoteIdent(mapping.table);

    const sql = `
      with probe as (
        select ctid, ${contentExpr} as content, ${embeddingExpr} as embedding
        from ${table}
        where ${embeddingExpr} is not null
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
        select t.ctid, ${contentExpr} as content, ${embeddingExpr} as embedding
        from ${table} t
        where t.ctid <> p.ctid
          and ${embeddingExpr} is not null
          and vector_dims(${embeddingExpr}) = vector_dims(p.embedding)
        order by p.embedding <=> ${embeddingExpr}
        limit 1
      ) n`;

    const result = await this.pool.query<{
      ref: string;
      neighbor_ref: string;
      similarity: string;
      ref_content: string | null;
      neighbor_content: string | null;
    }>(sql);
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
