import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  DEFAULT_LIMITS,
  DEFAULT_THRESHOLDS,
  runHeuristicDetectors,
  type DetectorContext,
} from "../src/detectors/heuristic";
import type { MappingV1 } from "../src/schemas/mapping";
import { PgReader } from "./helpers/pg-reader";

/**
 * Integration tests against the PR-02 fixtures. Run when CHUNKFUNK_FIXTURES_URL
 * or FIXTURES_PG_URL points at a seeded Postgres+pgvector (Docker in CI, or a
 * local Homebrew cluster). Skipped otherwise so `npm test` stays green without a database.
 */
const BASE = process.env.CHUNKFUNK_FIXTURES_URL ?? process.env.FIXTURES_PG_URL;

function dbUrl(database: string): string {
  const url = new URL(BASE as string);
  url.pathname = `/${database}`;
  return url.toString();
}

const MAPPINGS: Record<string, MappingV1> = {
  fixture_langchain: {
    version: 1,
    dialect: "pgvector",
    table: "public.langchain_pg_embedding",
    columns: {
      content: "document",
      embedding: "embedding",
      metadata: "cmetadata",
      documentId: null,
      sourceUrl: "meta:cmetadata.source",
      updatedAt: null,
    },
  },
  fixture_llamaindex: {
    version: 1,
    dialect: "pgvector",
    table: "public.data_embeddings",
    columns: {
      content: "text",
      embedding: "embedding",
      metadata: "metadata_",
      documentId: null,
      sourceUrl: null,
      updatedAt: null,
    },
  },
  fixture_custom: {
    version: 1,
    dialect: "pgvector",
    table: "public.kb_entries",
    columns: {
      content: "body_text",
      embedding: "vec",
      metadata: "props",
      documentId: null,
      sourceUrl: "page_url",
      updatedAt: "modified_at",
    },
  },
  fixture_supabase_docs: {
    version: 1,
    dialect: "pgvector",
    table: "public.documents",
    columns: {
      content: "content",
      embedding: "embedding",
      metadata: "metadata",
      documentId: null,
      sourceUrl: null,
      updatedAt: null,
    },
  },
  fixture_metadata_health: {
    version: 1,
    dialect: "pgvector",
    table: "public.metadata_documents",
    columns: {
      content: "content",
      embedding: "embedding",
      metadata: "metadata",
      documentId: null,
      sourceUrl: "meta:metadata.source",
      updatedAt: "created_at",
    },
  },
  fixture_empty_documents: {
    version: 1,
    dialect: "pgvector",
    table: "public.documents",
    columns: {
      content: "content",
      embedding: "embedding",
      metadata: "metadata",
      documentId: null,
      sourceUrl: null,
      updatedAt: null,
    },
  },
  fixture_structured_health: {
    version: 1,
    dialect: "pgvector",
    table: "public.structured_documents",
    columns: {
      content: "content",
      embedding: "embedding",
      metadata: "metadata",
      documentId: null,
      sourceUrl: null,
      updatedAt: "created_at",
    },
  },
  fixture_locator_coverage: {
    version: 1,
    dialect: "pgvector",
    table: "public.citation_documents",
    columns: {
      content: "content",
      embedding: "embedding",
      metadata: "metadata",
      documentId: null,
      sourceUrl: "source_url",
      updatedAt: "updated_at",
    },
  },
};

describe.skipIf(!BASE)("detectors vs fixtures", () => {
  const clients: pg.Client[] = [];

  async function run(database: string): Promise<DetectorContext & { result: Awaited<ReturnType<typeof runHeuristicDetectors>> }> {
    const client = new pg.Client({ connectionString: dbUrl(database) });
    await client.connect();
    clients.push(client);
    const mapping = MAPPINGS[database];
    const reader = new PgReader(client, mapping);
    const totalChunks = await reader.countChunks();
    const ctx: DetectorContext = {
      systemId: database,
      mapping,
      reader,
      sourceSnapshots: [],
      thresholds: DEFAULT_THRESHOLDS,
      limits: DEFAULT_LIMITS,
      totalChunks,
    };
    const result = await runHeuristicDetectors(ctx);
    return { ...ctx, result };
  }

  let langchain: Awaited<ReturnType<typeof runHeuristicDetectors>>;
  let llamaindex: Awaited<ReturnType<typeof runHeuristicDetectors>>;
  let custom: Awaited<ReturnType<typeof runHeuristicDetectors>>;
  let supabaseDocs: Awaited<ReturnType<typeof runHeuristicDetectors>>;
  let metadataHealth: Awaited<ReturnType<typeof runHeuristicDetectors>>;
  let emptyDocs: Awaited<ReturnType<typeof runHeuristicDetectors>>;
  let structuredHealth: Awaited<ReturnType<typeof runHeuristicDetectors>>;
  let locatorCoverage: Awaited<ReturnType<typeof runHeuristicDetectors>>;

  beforeAll(async () => {
    langchain = (await run("fixture_langchain")).result;
    llamaindex = (await run("fixture_llamaindex")).result;
    custom = (await run("fixture_custom")).result;
    supabaseDocs = (await run("fixture_supabase_docs")).result;
    metadataHealth = (await run("fixture_metadata_health")).result;
    emptyDocs = (await run("fixture_empty_documents")).result;
    structuredHealth = (await run("fixture_structured_health")).result;
    locatorCoverage = (await run("fixture_locator_coverage")).result;
  }, 120_000);

  afterAll(async () => {
    await Promise.all(clients.map((c) => c.end()));
  });

  describe("fixture_langchain (binding contracts)", () => {
    it("finds exactly 10 exact-duplicate groups and 30 member rows", () => {
      expect(langchain.stats.exactDuplicateGroups).toBe(10);
      expect(langchain.stats.exactDuplicateRows).toBe(30);
    });

    it("fires the corpus-wide critical exact-duplicate summary (10.1% > 5%)", () => {
      const critical = langchain.findings.find(
        (f) => f.type === "exact_duplicate" && f.severity === "critical",
      );
      expect(critical).toBeDefined();
      expect(critical?.evidence.corpusPct as number).toBeGreaterThan(5);
    });

    it("finds exactly 20 near-duplicate pairs (normalization-only groups excluded as exact)", () => {
      expect(langchain.stats.nearDuplicatePairs).toBe(20);
    });

    it("finds exactly 25 thin chunks and 3 secrets", () => {
      expect(langchain.stats.thinChunks).toBe(25);
      expect(langchain.stats.riskyCritical).toBe(3);
    });

    it("redacts secrets in evidence (no raw secret leaks)", () => {
      const serialized = JSON.stringify(langchain.findings);
      expect(serialized).not.toMatch(/sk-FAKE0/);
      expect(serialized).not.toMatch(/AKIAFAKE0/);
    });

    it("emits the no-timestamp architecture finding with a real ALTER TABLE", () => {
      const arch = langchain.findings.find((f) => f.type === "architecture");
      expect(arch?.suggestedRepair?.sql).toContain(
        "ALTER TABLE public.langchain_pg_embedding ADD COLUMN updated_at",
      );
    });

    it("produces a health score in range", () => {
      expect(langchain.score).toBeGreaterThanOrEqual(0);
      expect(langchain.score).toBeLessThanOrEqual(100);
    });
  });

  describe("fixture_llamaindex (embedding integrity)", () => {
    it("flags mixed embedding dimensions as critical", () => {
      const mixed = llamaindex.findings.find((f) => f.type === "embedding_mixed_dims");
      expect(mixed?.severity).toBe("critical");
      expect(llamaindex.stats.distinctEmbeddingDims.sort((a, b) => a - b)).toEqual([768, 1536]);
    });

    it("flags 3 null embeddings as a warning", () => {
      expect(llamaindex.stats.nullEmbeddings).toBe(3);
      expect(llamaindex.findings.find((f) => f.type === "embedding_null")?.severity).toBe("warning");
    });
  });

  describe("clean fixtures (zero false positives)", () => {
    it("fixture_custom has no secrets, no duplicates, no near-duplicates", () => {
      expect(custom.stats.riskyCritical).toBe(0);
      expect(custom.stats.exactDuplicateGroups).toBe(0);
      expect(custom.stats.nearDuplicatePairs).toBe(0);
      expect(custom.findings.some((f) => f.type === "risky_chunk")).toBe(false);
    });

    it("fixture_supabase_docs has no secrets and no duplicates", () => {
      expect(supabaseDocs.stats.riskyCritical).toBe(0);
      expect(supabaseDocs.stats.exactDuplicateGroups).toBe(0);
      expect(supabaseDocs.stats.nearDuplicatePairs).toBe(0);
    });
  });

  describe("fixture_metadata_health (metadata architecture)", () => {
    it("flags sparse metadata and mixed filter value types without exposing values", () => {
      expect(
        metadataHealth.findings.find((f) => f.title === "Metadata is missing on many chunks")?.severity,
      ).toBe("warning");
      expect(
        metadataHealth.findings.find((f) => f.title === "Metadata filter fields use mixed value types")?.severity,
      ).toBe("warning");
      const serialized = JSON.stringify(metadataHealth.findings);
      expect(serialized).toContain("tenant_id");
      expect(serialized).not.toContain("tenant-a");
      expect(serialized).not.toContain("1001");
      expect(metadataHealth.subscores.coverage).toBeLessThan(100);
      expect(metadataHealth.score).toBeLessThan(100);
    });

    it("flags oversized chunks without exposing chunk text", () => {
      const oversized = metadataHealth.findings.find((f) => f.title === "Many chunks are very large");
      expect(oversized?.severity).toBe("warning");
      expect(oversized?.affectedCount).toBe(10);
      const serialized = JSON.stringify(oversized);
      expect(serialized).toContain("p95Chars");
      expect(serialized).not.toContain("Long supporting paragraph");
      expect(metadataHealth.subscores.quality).toBeLessThan(100);
    });
  });

  describe("fixture_empty_documents (failed ingestion)", () => {
    it("reports an empty mapped chunk table as critical", () => {
      expect(emptyDocs.stats.totalChunks).toBe(0);
      expect(emptyDocs.findings.find((f) => f.title === "Mapped chunk table is empty")?.severity).toBe("critical");
      expect(emptyDocs.subscores.coverage).toBe(0);
      expect(emptyDocs.subscores.quality).toBe(0);
      expect(emptyDocs.score).toBeLessThan(80);
    });
  });

  describe("fixture_structured_health (table-like chunks and timestamp coverage)", () => {
    it("flags table-like chunks without leaking row or tenant values", () => {
      const finding = structuredHealth.findings.find(
        (f) => f.title === "Table-like chunks are missing source/citation locators",
      );
      expect(finding?.severity).toBe("warning");
      expect(finding?.affectedCount).toBe(20);
      const serialized = JSON.stringify(finding);
      expect(serialized).toContain("tableLikeWithoutLocator");
      expect(serialized).not.toContain("SKU-");
      expect(serialized).not.toContain("tenant-a");
      expect(structuredHealth.subscores.coverage).toBeLessThan(100);
    });

    it("flags partial timestamp coverage and lowers freshness confidence", () => {
      const finding = structuredHealth.findings.find(
        (f) => f.title === "Many chunks have no timestamp, so freshness is partial",
      );
      expect(finding?.severity).toBe("warning");
      expect(finding?.affectedCount).toBe(20);
      expect(structuredHealth.stats.staleDocsPct).toBeCloseTo(41.666, 2);
      expect(structuredHealth.subscores.freshness).toBeLessThan(100);
    });
  });

  describe("fixture_locator_coverage (mapped source locator coverage)", () => {
    it("flags sparse mapped source URLs without exposing URL values", () => {
      const finding = locatorCoverage.findings.find(
        (f) => f.title === "Source/citation locator is missing on many chunks",
      );
      expect(finding?.severity).toBe("info");
      expect(finding?.affectedCount).toBe(35);
      expect(finding?.evidence).toMatchObject({
        scannedChunks: 50,
        sourceLocatorRows: 15,
        sourceLocatorPct: 30,
        mappedSourceLocator: true,
      });
      const serialized = JSON.stringify(finding);
      expect(serialized).not.toContain("docs.example.com");
      expect(locatorCoverage.subscores.coverage).toBe(30);
    });
  });
});
