import { describe, expect, it } from "vitest";
import type { MappingV1 } from "../src/schemas/mapping";
import {
  DEFAULT_LIMITS,
  DEFAULT_THRESHOLDS,
  runArchitecture,
  runEmbeddingIntegrity,
  runExactDuplicate,
  runFreshness,
  runHeuristicDetectors,
  runNearDuplicate,
  runRiskyChunk,
  runThinChunk,
  type DetectorContext,
  type SourceSnapshot,
} from "../src/detectors/heuristic";
import { MockReader, type MockChunk } from "./helpers/mock-reader";

function mapping(overrides: Partial<MappingV1["columns"]> = {}): MappingV1 {
  return {
    version: 1,
    dialect: "pgvector",
    table: "public.docs",
    columns: {
      content: "content",
      embedding: "embedding",
      metadata: "metadata",
      documentId: null,
      sourceUrl: null,
      updatedAt: null,
      ...overrides,
    },
  };
}

function ctx(
  chunks: MockChunk[],
  overrides: Partial<DetectorContext> = {},
): DetectorContext {
  return {
    systemId: "sys-1",
    mapping: mapping(),
    reader: new MockReader(chunks),
    sourceSnapshots: [],
    thresholds: DEFAULT_THRESHOLDS,
    limits: DEFAULT_LIMITS,
    totalChunks: chunks.length,
    ...overrides,
  };
}

/** A short unit vector rotated by an angle in a 2D plane embedded in higher-D. */
function planarVector(angleDeg: number): number[] {
  const r = (angleDeg * Math.PI) / 180;
  return [Math.cos(r), Math.sin(r), 0, 0];
}

const LONG = "This is a perfectly healthy chunk of documentation text that comfortably exceeds the minimum length and ends with a period so it never trips the thin detector.";

describe("exact-duplicate", () => {
  it("groups by normalized hash, counts rows, and fires the corpus critical", async () => {
    const chunks: MockChunk[] = [];
    // 2 groups of 3 identical (post-normalization) → 6 member rows of 8 total = 75% > 5%.
    for (let g = 0; g < 2; g += 1) {
      chunks.push({ ref: `g${g}-a`, content: `Duplicate body number ${g}.` });
      chunks.push({ ref: `g${g}-b`, content: `  DUPLICATE BODY NUMBER ${g}.  ` });
      chunks.push({ ref: `g${g}-c`, content: `duplicate   body   number   ${g}.` });
    }
    chunks.push({ ref: "u1", content: "Unique one." });
    chunks.push({ ref: "u2", content: "Unique two." });

    const result = await runExactDuplicate(ctx(chunks));
    expect(result.groups).toBe(2);
    expect(result.memberRows).toBe(6);
    expect(JSON.stringify(result.findings)).not.toContain("Duplicate body");
    const warnings = result.findings.filter((f) => f.severity === "warning");
    const criticals = result.findings.filter((f) => f.severity === "critical");
    expect(warnings).toHaveLength(2);
    expect(criticals).toHaveLength(1);
    expect(criticals[0].evidence.summary).toBe(true);
  });

  it("does not fire the corpus critical below 5%", async () => {
    const chunks: MockChunk[] = [
      { ref: "d1", content: "same text" },
      { ref: "d2", content: "same text" },
    ];
    for (let i = 0; i < 98; i += 1) chunks.push({ ref: `x${i}`, content: `unique ${i}` });
    const result = await runExactDuplicate(ctx(chunks));
    expect(result.groups).toBe(1);
    expect(result.findings.some((f) => f.severity === "critical")).toBe(false);
  });
});

describe("near-duplicate", () => {
  it("finds near pairs above threshold and excludes exact duplicates", async () => {
    const chunks: MockChunk[] = [
      { ref: "n1", content: "Alpha release notes describe the retry behavior in detail.", embedding: planarVector(0) },
      { ref: "n2", content: "Beta release notes describe the retry behavior differently.", embedding: planarVector(5) },
      // exact-dup pair (identical text + identical vector) must be excluded
      { ref: "e1", content: "Identical chunk of text.", embedding: planarVector(90) },
      { ref: "e2", content: "Identical chunk of text.", embedding: planarVector(90) },
      { ref: "far", content: "Totally different topic entirely.", embedding: planarVector(180) },
    ];
    const result = await runNearDuplicate(ctx(chunks));
    expect(result.pairs).toBe(1);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].evidence.refs).toEqual(
      expect.arrayContaining(["n1", "n2"]),
    );
  });
});

describe("thin-chunk", () => {
  it("flags short, link-dense, and mid-sentence chunks; leaves healthy alone", async () => {
    const chunks: MockChunk[] = [
      { ref: "short", content: "Too short." },
      { ref: "links", content: "https://a.com https://b.com https://c.com https://d.com one" },
      { ref: "mid", content: "and then the process continues without any real conclusion or" },
      { ref: "ok", content: LONG },
    ];
    const result = await runThinChunk(ctx(chunks));
    const refs = result.findings.map((f) => f.evidence.ref);
    expect(result.thinCount).toBe(3);
    expect(refs).toEqual(expect.arrayContaining(["short", "links", "mid"]));
    expect(refs).not.toContain("ok");
    expect(JSON.stringify(result.findings)).not.toContain("Too short");
    expect(JSON.stringify(result.findings)).not.toContain("https://a.com");
  });

  it("summarizes widespread mid-sentence chunk boundaries without exposing text", async () => {
    const chunks: MockChunk[] = [];
    for (let i = 0; i < 12; i += 1) {
      chunks.push({
        ref: `fragment-${i}`,
        content: `and continues the policy explanation from a previous chunk with enough operational detail to exceed the thin length threshold while still ending abruptly without punctuation ${i}`,
      });
    }
    for (let i = 0; i < 20; i += 1) {
      chunks.push({ ref: `healthy-${i}`, content: LONG });
    }

    const result = await runThinChunk(ctx(chunks));
    const summary = result.findings.find(
      (f) => f.title === "Many chunks look mechanically split mid-sentence",
    );
    expect(summary?.severity).toBe("warning");
    expect(summary?.affectedCount).toBe(12);
    expect(summary?.evidence).toMatchObject({
      totalChunks: 32,
      midSentenceChunks: 12,
      midSentencePct: 37.5,
    });
    expect(JSON.stringify(summary)).not.toContain("policy explanation");
  });
});

describe("risky-chunk", () => {
  it("flags secrets as critical and redacts them in evidence", async () => {
    const secret = "sk-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    const chunks: MockChunk[] = [
      { ref: "s1", content: `Config: ${secret} keep it safe and never share it publicly.` },
      { ref: "clean", content: LONG },
    ];
    const result = await runRiskyChunk(ctx(chunks));
    expect(result.criticalCount).toBe(1);
    const serialized = JSON.stringify(result.findings);
    expect(serialized).not.toContain(secret);
    expect(serialized).toContain("sk-A…");
  });

  it("flags risk markers as warnings and stays silent on clean text", async () => {
    const chunks: MockChunk[] = [
      { ref: "m1", content: "This section is DEPRECATED and should not be relied upon anymore." },
      { ref: "clean", content: LONG },
    ];
    const result = await runRiskyChunk(ctx(chunks));
    expect(result.warningCount).toBe(1);
    expect(result.criticalCount).toBe(0);
  });
});

describe("freshness", () => {
  it("emits an architecture finding with a real ALTER TABLE when no timestamp is mapped", async () => {
    const result = await runFreshness(ctx([{ ref: "a", content: LONG }]));
    expect(result.staleDocsPct).toBeNull();
    expect(result.findings).toHaveLength(1);
    const finding = result.findings[0];
    expect(finding.type).toBe("architecture");
    expect(finding.suggestedRepair?.sql).toContain("ALTER TABLE public.docs ADD COLUMN updated_at");
  });

  it("keeps the no-timestamp architecture finding even when source snapshots changed", async () => {
    const snapshots: SourceSnapshot[] = [
      {
        locator: "https://docs.example.com/sitemap.xml",
        signalKind: "sitemap_lastmod",
        signalValue: "2026-07-01",
        observedAt: "2026-07-01T00:00:00.000Z",
        changed: true,
      },
    ];
    const result = await runFreshness(ctx([{ ref: "a", content: LONG }], { sourceSnapshots: snapshots }));

    expect(result.staleDocsPct).toBeNull();
    expect(result.findings.some((f) => f.type === "architecture")).toBe(true);
    expect(result.findings.some((f) => f.type === "stale_source")).toBe(true);
  });

  it("flags changed sources and stale documents when updatedAt is mapped", async () => {
    const snapshots: SourceSnapshot[] = [
      {
        locator: "https://docs.example.com/sitemap.xml",
        signalKind: "sitemap_lastmod",
        signalValue: "2026-07-01",
        observedAt: "2026-07-01T00:00:00.000Z",
        changed: true,
      },
    ];
    const chunks: MockChunk[] = [
      { ref: "old", content: LONG, updatedAt: "2026-06-01T00:00:00.000Z" },
      { ref: "new", content: LONG, updatedAt: "2026-07-02T00:00:00.000Z" },
    ];
    const result = await runFreshness(
      ctx(chunks, {
        mapping: mapping({ updatedAt: "updated_at" }),
        sourceSnapshots: snapshots,
      }),
    );
    expect(result.findings.some((f) => f.type === "stale_source")).toBe(true);
    expect(result.findings.some((f) => f.type === "stale_document")).toBe(true);
    expect(result.staleDocsPct).toBe(50);
  });

  it("warns when a mapped timestamp column is only partly populated", async () => {
    const chunks: MockChunk[] = [
      { ref: "dated", content: LONG, updatedAt: "2026-07-02T00:00:00.000Z" },
      { ref: "missing-1", content: LONG, updatedAt: null },
      { ref: "missing-2", content: LONG, updatedAt: null },
      { ref: "missing-3", content: LONG, updatedAt: null },
    ];
    const result = await runFreshness(
      ctx(chunks, {
        mapping: mapping({ updatedAt: "updated_at" }),
      }),
    );

    const finding = result.findings.find(
      (f) => f.title === "Many chunks have no timestamp, so freshness is partial",
    );
    expect(finding?.severity).toBe("warning");
    expect(finding?.evidence).toMatchObject({
      scannedChunks: 4,
      timestampedChunks: 1,
      missingTimestampChunks: 3,
      missingTimestampPct: 75,
    });
    expect(result.staleDocsPct).toBe(75);
  });

  it("keeps freshness unmeasurable when the mapped timestamp column is empty", async () => {
    const chunks: MockChunk[] = [
      { ref: "missing-1", content: LONG, updatedAt: null },
      { ref: "missing-2", content: LONG, updatedAt: null },
    ];
    const result = await runFreshness(
      ctx(chunks, {
        mapping: mapping({ updatedAt: "updated_at" }),
      }),
    );

    expect(result.findings.find((f) => f.title === "Mapped timestamp column is empty")?.severity).toBe("warning");
    expect(result.staleDocsPct).toBeNull();
  });
});

describe("embedding-integrity", () => {
  it("flags mixed dimensions (critical) and null embeddings (warning)", async () => {
    const chunks: MockChunk[] = [
      { ref: "a", content: LONG, embedding: [1, 0, 0] },
      { ref: "b", content: LONG, embedding: [0, 1, 0, 0] },
      { ref: "c", content: LONG, embedding: null },
    ];
    const result = await runEmbeddingIntegrity(ctx(chunks));
    expect(result.distinctDims).toEqual([3, 4]);
    expect(result.nullEmbeddings).toBe(1);
    expect(result.findings.find((f) => f.type === "embedding_mixed_dims")?.severity).toBe("critical");
    expect(result.findings.find((f) => f.type === "embedding_null")?.severity).toBe("warning");
  });
});

describe("architecture", () => {
  it("reports an empty mapped table as a critical ingestion failure", async () => {
    const result = await runArchitecture(ctx([]));
    expect(result.emptyTable).toBe(true);
    expect(result.coverageScore).toBe(0);
    expect(result.findings.find((f) => f.title === "Mapped chunk table is empty")?.severity).toBe("critical");
  });

  it("flags missing metadata coverage and mixed metadata value types without exposing values", async () => {
    const chunks: MockChunk[] = [
      { ref: "a", content: LONG, metadata: { source: "docs", tenant_id: "team-a", score: 1 } },
      { ref: "b", content: LONG, metadata: { source: "docs", tenant_id: "team-a", score: "1" } },
      { ref: "c", content: LONG, metadata: { source: "docs", tenant_id: "team-a", score: 2 } },
      { ref: "d", content: LONG, metadata: { source: "docs", tenant_id: "team-a", score: "2" } },
      { ref: "e", content: LONG, metadata: { source: "docs", tenant_id: "team-a", score: 3 } },
      { ref: "f", content: LONG, metadata: null },
      { ref: "g", content: LONG, metadata: null },
    ];
    const result = await runArchitecture(ctx(chunks));

    expect(result.findings.find((f) => f.title === "Metadata is missing on many chunks")?.severity).toBe("warning");
    const mixed = result.findings.find((f) => f.title === "Metadata filter fields use mixed value types");
    expect(mixed?.severity).toBe("warning");
    expect(result.coverageScore).toBeLessThan(100);
    expect(JSON.stringify(mixed?.evidence)).toContain("sha256:");
    expect(JSON.stringify(mixed?.evidence)).not.toContain("score");
    expect(JSON.stringify(result.findings)).not.toContain("team-a");
  });

  it("flags oversized chunks without exposing chunk text", async () => {
    const huge = `${LONG} ${"Long supporting paragraph. ".repeat(180)}`;
    const chunks: MockChunk[] = [];
    for (let i = 0; i < 10; i += 1) {
      chunks.push({
        ref: `large-${i}`,
        content: huge,
        metadata: { source: "docs" },
      });
    }
    for (let i = 0; i < 30; i += 1) {
      chunks.push({
        ref: `ok-${i}`,
        content: LONG,
        metadata: { source: "docs" },
      });
    }
    const result = await runArchitecture(ctx(chunks));
    const oversized = result.findings.find((f) => f.title === "Many chunks are very large");
    expect(oversized?.severity).toBe("warning");
    expect(oversized?.affectedCount).toBe(10);
    expect(result.largeChunkPct).toBe(25);
    expect(JSON.stringify(oversized)).not.toContain("Long supporting paragraph");
  });

  it("flags missing source/citation locators without exposing metadata values", async () => {
    const chunks: MockChunk[] = [
      { ref: "a", content: LONG, metadata: { tenant_id: "team-a" } },
      { ref: "b", content: LONG, metadata: { tenant_id: "team-a" } },
    ];
    const result = await runArchitecture(ctx(chunks));
    const citation = result.findings.find((f) => f.title === "No source or citation locator was found");
    expect(citation?.severity).toBe("warning");
    expect(JSON.stringify(citation)).toContain("sourceLocatorRows");
    expect(JSON.stringify(result.findings)).not.toContain("team-a");
  });

  it("flags sparse mapped source locator columns by coverage, not just schema presence", async () => {
    const chunks: MockChunk[] = [];
    for (let i = 0; i < 8; i += 1) {
      chunks.push({ ref: `missing-${i}`, content: LONG, sourceLocatorPresent: false });
    }
    for (let i = 0; i < 2; i += 1) {
      chunks.push({ ref: `present-${i}`, content: LONG, sourceLocatorPresent: true });
    }

    const result = await runArchitecture(
      ctx(chunks, {
        mapping: mapping({ metadata: null, sourceUrl: "source_url" }),
      }),
    );

    const citation = result.findings.find(
      (f) => f.title === "Source/citation locator is missing on many chunks",
    );
    expect(citation?.severity).toBe("info");
    expect(citation?.affectedCount).toBe(8);
    expect(citation?.evidence).toMatchObject({
      scannedChunks: 10,
      sourceLocatorRows: 2,
      sourceLocatorPct: 20,
      mappedSourceLocator: true,
    });
    expect(result.coverageScore).toBe(20);
  });

  it("flags table-like chunks without exposing row values", async () => {
    const table = [
      "| product_code | region | renewal_status |",
      "| --- | --- | --- |",
      "| SKU-1001 | EU | active |",
      "| SKU-1002 | US | paused |",
      "| SKU-1003 | APAC | review |",
    ].join("\n");
    const chunks: MockChunk[] = [];
    for (let i = 0; i < 6; i += 1) {
      chunks.push({
        ref: `table-${i}`,
        content: table,
        metadata: { tenant_id: "team-a" },
      });
    }
    chunks.push({ ref: "ok", content: LONG, metadata: { source: "docs" } });

    const result = await runArchitecture(ctx(chunks));
    const finding = result.findings.find(
      (f) => f.title === "Table-like chunks are missing source/citation locators",
    );
    expect(finding?.severity).toBe("warning");
    expect(finding?.affectedCount).toBe(6);
    expect(finding?.evidence).toMatchObject({
      tableLikeChunks: 6,
      tableLikeWithoutLocator: 6,
    });
    const serialized = JSON.stringify(finding);
    expect(serialized).not.toContain("SKU-1001");
    expect(serialized).not.toContain("team-a");
  });

  it("flags indexed chunk counts below an explicit inventory minimum", async () => {
    const chunks: MockChunk[] = [
      { ref: "a", content: LONG, metadata: { source: "docs" } },
      { ref: "b", content: LONG, metadata: { source: "docs" } },
    ];
    const result = await runArchitecture(
      ctx(chunks, {
        totalChunks: 2,
        inventory: { minChunks: 5 },
      }),
    );

    const finding = result.findings.find(
      (f) => f.title === "Indexed chunk count is below the configured inventory minimum",
    );
    expect(finding?.severity).toBe("critical");
    expect(finding?.evidence).toMatchObject({
      expectedMinChunks: 5,
      observedChunks: 2,
      missingChunks: 3,
      observedPct: 40,
    });
    expect(result.coverageScore).toBe(40);
  });

  it("flags indexed document counts below an explicit inventory minimum", async () => {
    const result = await runArchitecture(
      ctx([{ ref: "a", content: LONG, metadata: { source: "docs" } }], {
        inventory: { minDocuments: 10, observedDocuments: 8 },
      }),
    );

    const finding = result.findings.find(
      (f) => f.title === "Indexed document count is below the configured inventory minimum",
    );
    expect(finding?.severity).toBe("warning");
    expect(finding?.affectedCount).toBe(2);
    expect(result.coverageScore).toBe(80);
  });

  it("does not guess document inventory when no document id count is available", async () => {
    const result = await runArchitecture(
      ctx([{ ref: "a", content: LONG, metadata: { source: "docs" } }], {
        inventory: { minDocuments: 10, observedDocuments: null },
      }),
    );

    const finding = result.findings.find(
      (f) => f.title === "Document inventory cannot be verified without a mapped document id",
    );
    expect(finding?.severity).toBe("info");
    expect(result.coverageScore).toBe(100);
  });

  it("hashes uncommon metadata keys before they can leave the process", async () => {
    const chunks: MockChunk[] = [];
    for (let i = 0; i < 24; i += 1) {
      chunks.push({
        ref: `r${i}`,
        content: LONG,
        metadata: i % 2 === 0 ? { secretCustomerShardName: "private-value" } : {},
      });
    }
    const result = await runArchitecture(ctx(chunks));
    const serialized = JSON.stringify(result.findings);
    expect(serialized).toContain("sha256:");
    expect(serialized).not.toContain("secretCustomerShardName");
    expect(serialized).not.toContain("private-value");
  });

  it("includes read-only catalog architecture signals from the reader", async () => {
    const reader = new MockReader(
      [{ ref: "a", content: LONG, metadata: { source: "docs" } }],
      [
        {
          severity: "info",
          title: "Mapped table has multiple vector columns",
          evidence: { table: "public.docs", otherVectorColumns: ["embedding_3072"] },
        },
      ],
    );
    const result = await runArchitecture(ctx([], { reader, totalChunks: 1 }));
    expect(result.findings.some((f) => f.title === "Mapped table has multiple vector columns")).toBe(true);
  });
});

describe("orchestrator", () => {
  it("aggregates findings and scores metadata coverage when metadata is mapped", async () => {
    const chunks: MockChunk[] = [{ ref: "a", content: LONG, embedding: [1, 0, 0] }];
    const result = await runHeuristicDetectors(ctx(chunks));
    expect(result.subscores.coverage).toBe(0);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
    expect(result.scoreVersion).toBe(1);
  });

  it("caps the stream at maxChunks (deterministic sample)", async () => {
    const chunks: MockChunk[] = [];
    for (let i = 0; i < 100; i += 1) chunks.push({ ref: `r${i}`, content: `unique body ${i}` });
    const reader = new MockReader(chunks);
    let streamed = 0;
    for await (const chunk of reader.streamChunks({ maxChunks: 10 })) {
      void chunk;
      streamed += 1;
    }
    expect(streamed).toBe(10);
  });
});
