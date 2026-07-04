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

  beforeAll(async () => {
    langchain = (await run("fixture_langchain")).result;
    llamaindex = (await run("fixture_llamaindex")).result;
    custom = (await run("fixture_custom")).result;
    supabaseDocs = (await run("fixture_supabase_docs")).result;
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
});
