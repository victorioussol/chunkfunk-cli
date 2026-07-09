import { describe, expect, it } from "vitest";
import type { FindingV1, ReportV1 } from "@chunkfunk/core";
import { reportV1Schema } from "@chunkfunk/core";
import { capFindingEvidence, MAX_EXCERPT_CHARS } from "../src/scan/evidence";
import { buildReport } from "../src/scan/build-report";
import { renderHtml } from "../src/render/html";
import { renderJson } from "../src/render/json";
import { renderTerminal } from "../src/render/terminal";

function baseReport(overrides: Partial<ReportV1> = {}): ReportV1 {
  return reportV1Schema.parse({
    version: 1,
    scan: {
      id: "3f0d5f0a-9a5c-4d1a-8a83-1f0e6f0b7c21",
      origin: "cli",
      startedAt: "2026-07-02T09:00:00.000Z",
      finishedAt: "2026-07-02T09:01:00.000Z",
    },
    stack: {
      fingerprintHash: "abc",
      frameworkGuess: "langchain",
      embeddingDims: 1536,
      embeddingModelGuess: "openai (guess)",
      mapping: {
        version: 1,
        dialect: "pgvector",
        table: "public.docs",
        columns: {
          content: "document",
          embedding: "embedding",
          metadata: "cmetadata",
          documentId: null,
          sourceUrl: null,
          updatedAt: null,
        },
      },
    },
    totals: { documents: 10, chunks: 100, sources: 1 },
    health: {
      score: 42,
      scoreVersion: 1,
      subscores: { freshness: null, duplication: 60, quality: 80, risk: 25, coverage: null },
    },
    findings: [
      {
        type: "risky_chunk",
        severity: "critical",
        title: "Chunk contains what looks like a secret",
        evidence: { ref: "chunk:1", kind: "secret" },
        affectedCount: 1,
      },
      {
        type: "exact_duplicate",
        severity: "warning",
        title: "3 chunks are exact duplicates",
        evidence: { duplicateChunks: 3 },
        affectedCount: 3,
      },
    ],
    sources: [
      { locator: "https://docs.example.com/sitemap.xml", kind: "sitemap", lastIndexedAt: null, lastChangedAt: null, status: "unknown" },
    ],
    nextActions: [{ rank: 1, title: "Rotate the leaked secret", findingRefs: [0] }],
    ...overrides,
  });
}

describe("evidence cap", () => {
  it("truncates every evidence string to 500 chars", () => {
    const finding: FindingV1 = {
      type: "thin_chunk",
      severity: "info",
      title: "Thin chunk",
      evidence: { detail: "x".repeat(5000), nested: ["y".repeat(900)] },
      affectedCount: 1,
    };
    const capped = capFindingEvidence(finding);
    expect((capped.evidence.detail as string).length).toBe(MAX_EXCERPT_CHARS);
    expect(((capped.evidence.nested as string[])[0]).length).toBe(MAX_EXCERPT_CHARS);
  });
});

describe("renderJson", () => {
  it("emits valid ReportV1 JSON and nothing else", () => {
    const report = baseReport();
    const out = renderJson(report);
    expect(() => reportV1Schema.parse(JSON.parse(out))).not.toThrow();
  });
});

describe("buildReport", () => {
  it("deduplicates fix-first actions by repair category", () => {
    const report = buildReport({
      mapping: baseReport().stack.mapping,
      stackMeta: {
        fingerprintHash: "abc",
        frameworkGuess: "langchain",
        embeddingDims: 1536,
        embeddingModelGuess: null,
      },
      detector: {
        score: 40,
        scoreVersion: 1,
        subscores: { freshness: null, duplication: 40, quality: 70, risk: 30, coverage: 80 },
        stats: {
          totalChunks: 100,
          exactDuplicateGroups: 0,
          exactDuplicateRows: 0,
          exactDuplicatePct: 0,
          nearDuplicatePairs: 0,
          nearDuplicatePct: 0,
          thinChunks: 0,
          thinPct: 0,
          riskyCritical: 3,
          riskyWarning: 0,
          nullEmbeddings: 0,
          distinctEmbeddingDims: [1536],
          largeChunksPct: 0,
          staleDocsPct: null,
        },
        findings: [
          {
            type: "exact_duplicate",
            severity: "critical",
            title: "30.0% of the corpus is exact-duplicated",
            evidence: { summary: true },
            affectedCount: 30,
          },
          {
            type: "exact_duplicate",
            severity: "warning",
            title: "3 chunks are exact duplicates",
            evidence: { duplicateChunks: 3 },
            affectedCount: 3,
          },
          {
            type: "risky_chunk",
            severity: "critical",
            title: "Chunk contains what looks like a secret",
            evidence: { ref: "a", kind: "secret" },
            affectedCount: 1,
          },
          {
            type: "risky_chunk",
            severity: "critical",
            title: "Chunk contains what looks like a secret",
            evidence: { ref: "b", kind: "secret" },
            affectedCount: 1,
          },
          {
            type: "thin_chunk",
            severity: "warning",
            title: "Many chunks look mechanically split mid-sentence",
            evidence: { midSentenceChunks: 12 },
            suggestedRepair: {
              kind: "review_chunk_boundaries",
              description: "Review chunk boundaries.",
            },
            affectedCount: 12,
          },
        ],
      },
      totals: { documents: 10, chunks: 100, sources: 0 },
      sources: [],
      startedAt: "2026-07-02T09:00:00.000Z",
      finishedAt: "2026-07-02T09:01:00.000Z",
    });

    expect(report.nextActions).toHaveLength(3);
    expect(report.nextActions[0]).toMatchObject({
      title: "30.0% of the corpus is exact-duplicated",
      findingRefs: [0, 1],
    });
    expect(report.nextActions[1]).toMatchObject({
      title: "Chunk contains what looks like a secret",
      findingRefs: [2, 3],
    });
    expect(report.nextActions[2]).toMatchObject({
      title: "Many chunks look mechanically split mid-sentence",
      findingRefs: [4],
    });
  });
});

describe("renderTerminal", () => {
  it("shows the score, subscores, findings, and fix-first list", () => {
    const out = renderTerminal(baseReport());
    expect(out).toContain("42/100");
    expect(out).toContain("RAG rot: severe");
    expect(out).toContain("CRITICAL (1)");
    expect(out).toContain("3 chunks are exact duplicates");
    expect(out).toContain("Rotate the leaked secret");
    expect(out).toContain("Share-safe");
  });

  it("does not print raw source locators in terminal output", () => {
    const out = renderTerminal(baseReport());
    expect(out).not.toContain("https://docs.example.com/sitemap.xml");
    expect(out).toContain("https source sha256:");
  });

  it("caps each finding type at 5 shown with an overflow count", () => {
    const findings: FindingV1[] = Array.from({ length: 8 }, (_, i) => ({
      type: "thin_chunk",
      severity: "info",
      title: `Thin chunk ${i}`,
      evidence: { ref: `c${i}` },
      affectedCount: 1,
    }));
    const out = renderTerminal(baseReport({ findings }));
    expect(out).toContain("+3 more");
  });
});

describe("renderHtml", () => {
  it("is self-contained: no external requests", () => {
    const html = renderHtml(baseReport());
    expect(html).not.toMatch(/<script\s+src=/i);
    expect(html).not.toMatch(/<link\s/i);
    expect(html).not.toMatch(/<img\s/i);
    expect(html).not.toMatch(/https?:\/\/[^"']*\.(js|css)/i);
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("42");
    expect(html).toContain("RAG rot: severe");
  });

  it("does not print raw source locators in HTML output", () => {
    const html = renderHtml(baseReport());
    expect(html).not.toContain("https://docs.example.com/sitemap.xml");
    expect(html).toContain("https source sha256:");
  });

  it("escapes dynamic content", () => {
    const report = baseReport({
      findings: [
        {
          type: "risky_chunk",
          severity: "critical",
          title: "<script>alert(1)</script>",
          evidence: {},
          affectedCount: 1,
        },
      ],
    });
    const html = renderHtml(report);
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
