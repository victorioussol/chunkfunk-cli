import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  hashContent,
  normalizedLength,
  reportV1Schema,
  telemetryV1Schema,
  type ChunkRecord,
  type NearNeighborPair,
  type ReportV1,
} from "@chunkfunk/core";
import { runScan } from "../src/commands/scan";
import { sendTelemetry } from "../src/telemetry/client";
import {
  anonymizeIdentifier,
  buildTelemetryPayload,
  serializeTelemetryPayload,
} from "../src/telemetry/payload";
import type { CandidateTable, UserDbReader } from "../src/db/reader";

function makeReport(overrides: Partial<ReportV1> = {}): ReportV1 {
  return reportV1Schema.parse({
    version: 1,
    scan: {
      id: "3f0d5f0a-9a5c-4d1a-8a83-1f0e6f0b7c21",
      origin: "cli",
      startedAt: "2026-07-03T09:00:00.000Z",
      finishedAt: "2026-07-03T09:01:00.000Z",
      cliVersion: "0.1.0",
    },
    stack: {
      fingerprintHash: "b".repeat(64),
      frameworkGuess: "custom",
      embeddingDims: 1536,
      embeddingModelGuess: "openai (guess)",
      mapping: {
        version: 1,
        dialect: "pgvector",
        table: "private.customer_embeddings",
        columns: {
          content: "customer_private_body",
          embedding: "embedding",
          metadata: "internal_metadata_blob",
          documentId: "meta:internal_metadata_blob.customer_doc_id",
          sourceUrl: "meta:internal_metadata_blob.private_source_url",
          updatedAt: "tenant_last_refreshed_at",
        },
      },
    },
    totals: { documents: 10, chunks: 100, sources: 1 },
    health: {
      score: 55,
      scoreVersion: 1,
      subscores: { freshness: null, duplication: 60, quality: 80, risk: 25, coverage: null },
    },
    findings: [
      {
        type: "risky_chunk",
        severity: "critical",
        title: "Chunk contains customer-only launch notes",
        evidence: { excerpt: "SECRET_CUSTOMER_DOC_CONTENT sk-private-value" },
        affectedCount: 1,
      },
    ],
    sources: [
      {
        locator: "postgres://user:password@example.internal/private",
        kind: "website",
        lastIndexedAt: null,
        lastChangedAt: null,
        status: "unknown",
      },
    ],
    nextActions: [{ rank: 1, title: "Read private source", findingRefs: [0] }],
    ...overrides,
  });
}

class HealthyReader {
  setSystemSeed = vi.fn();
  setMapping = vi.fn();
  close = vi.fn(async () => undefined);
  listCandidateTables = vi.fn(async (): Promise<CandidateTable[]> => [
    {
      schema: "public",
      name: "documents",
      qualified: "public.documents",
      columns: [
        { name: "content", udtName: "text", dataType: "text" },
        { name: "embedding", udtName: "vector", dataType: "USER-DEFINED" },
        { name: "metadata", udtName: "jsonb", dataType: "jsonb" },
      ],
      vectorColumns: ["embedding"],
    },
  ]);
  sampleJsonKeys = vi.fn(async () => []);
  averageTextLength = vi.fn(async () => 200);
  embeddingDimensions = vi.fn(async () => 1536);
  countChunks = vi.fn(async () => 1);
  countDistinctDocuments = vi.fn(async () => null);
  async *streamChunks(): AsyncIterable<ChunkRecord> {
    const content = "Healthy documentation chunk with enough detail to avoid the thin chunk detector.";
    yield {
      ref: "(0,1)",
      contentHash: hashContent(content),
      contentSample: content,
      length: normalizedLength(content),
      metadata: null,
      embeddingDims: 1536,
      updatedAt: null,
    };
  }
  async *probeNearestNeighbors(): AsyncIterable<NearNeighborPair> {}
}

describe("CLI telemetry", () => {
  const priorDatabaseUrl = process.env.DATABASE_URL;

  afterEach(() => {
    if (priorDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = priorDatabaseUrl;
  });

  it("builds an anonymized payload without report content, source locators, or connection details", () => {
    const payload = buildTelemetryPayload(makeReport());
    expect(() => telemetryV1Schema.parse(payload)).not.toThrow();
    expect(payload.mappingShape.id).toBe("manual");
    if (payload.mappingShape.id === "manual") {
      expect(payload.mappingShape.columns.find((c) => c.role === "content")?.name).toBe(
        anonymizeIdentifier("customer_private_body"),
      );
      expect(payload.mappingShape.columns.find((c) => c.role === "embedding")?.name).toBe("embedding");
    }

    const serialized = serializeTelemetryPayload(payload);
    expect(serialized).not.toContain("SECRET_CUSTOMER_DOC_CONTENT");
    expect(serialized).not.toContain("sk-private-value");
    expect(serialized).not.toContain("postgres://");
    expect(serialized).not.toContain("example.internal");
    expect(serialized).not.toContain("customer_private_body");
    expect(serialized).not.toContain("internal_metadata_blob");
  });

  it("uses the same bytes for --show-telemetry serialization and the POST body", async () => {
    const payload = buildTelemetryPayload(makeReport());
    let postedBody = "";
    const fetchFn: typeof fetch = async (_url, init) => {
      postedBody = String(init?.body);
      return new Response(JSON.stringify({ received: true }), { status: 202 });
    };

    await sendTelemetry({ payload, apiUrl: "https://chunkfunk.app/", fetchFn });

    expect(postedBody).toBe(serializeTelemetryPayload(payload));
  });

  it("prompts once after an eligible scan and stores a default-off answer", async () => {
    const dir = await mkdtemp(join(tmpdir(), "chunkfunk-telemetry-off-"));
    process.env.DATABASE_URL = "postgres://example.invalid/db";
    const prompts = { confirm: vi.fn(async () => true), select: vi.fn(), selectOptional: vi.fn() };
    const telemetryPrompt = vi.fn(async () => false);
    const fetchFn = vi.fn<typeof fetch>();

    try {
      await runScan({
        dir,
        prompts,
        readerFactory: () => new HealthyReader() as unknown as UserDbReader,
        offerSync: false,
        telemetryPrompt,
        telemetryFetchFn: fetchFn,
        stdout: () => undefined,
        stderr: () => undefined,
      });

      const yaml = await readFile(join(dir, "chunkfunk.yaml"), "utf8");
      expect(telemetryPrompt).toHaveBeenCalledOnce();
      expect(fetchFn).not.toHaveBeenCalled();
      expect(yaml).toContain("telemetry: false");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("skips the consent prompt in --json mode and keeps stdout pure", async () => {
    const dir = await mkdtemp(join(tmpdir(), "chunkfunk-telemetry-json-"));
    process.env.DATABASE_URL = "postgres://example.invalid/db";
    let stdout = "";

    try {
      await runScan({
        dir,
        json: true,
        readerFactory: () => new HealthyReader() as unknown as UserDbReader,
        telemetryPrompt: async () => {
          throw new Error("telemetry prompt should not run");
        },
        offerSync: false,
        stdout: (text) => {
          stdout += text;
        },
        stderr: () => undefined,
      });

      expect(() => reportV1Schema.parse(JSON.parse(stdout))).not.toThrow();
      const yaml = await readFile(join(dir, "chunkfunk.yaml"), "utf8");
      expect(yaml).not.toContain("telemetry:");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
