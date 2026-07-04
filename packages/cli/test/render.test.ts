import { describe, expect, it } from "vitest";
import type { FindingV1, ReportV1 } from "@chunkfunk/core";
import { reportV1Schema } from "@chunkfunk/core";
import { capFindingEvidence, MAX_EXCERPT_CHARS } from "../src/scan/evidence";
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
      evidence: { excerpt: "x".repeat(5000), nested: ["y".repeat(900)] },
      affectedCount: 1,
    };
    const capped = capFindingEvidence(finding);
    expect((capped.evidence.excerpt as string).length).toBe(MAX_EXCERPT_CHARS);
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

describe("renderTerminal", () => {
  it("shows the score, subscores, findings, and fix-first list", () => {
    const out = renderTerminal(baseReport());
    expect(out).toContain("42/100");
    expect(out).toContain("CRITICAL (1)");
    expect(out).toContain("3 chunks are exact duplicates");
    expect(out).toContain("Rotate the leaked secret");
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
