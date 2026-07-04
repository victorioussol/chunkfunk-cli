import { describe, expect, it } from "vitest";
import type { MappingV1 } from "../src/schemas/mapping";
import { buildColumnExpr } from "../src/sql/build-column-expr";

function makeMapping(
  columns: Partial<MappingV1["columns"]> = {},
): MappingV1 {
  return {
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
      ...columns,
    },
  };
}

describe("buildColumnExpr", () => {
  it("quotes plain column names", () => {
    expect(buildColumnExpr(makeMapping(), "content")).toBe('"document"');
  });

  it("quotes schema-qualified names per segment", () => {
    const mapping = makeMapping({ content: "public.document" });
    expect(buildColumnExpr(mapping, "content")).toBe('"public"."document"');
  });

  it("converts meta: JSON paths to ->> expressions", () => {
    expect(buildColumnExpr(makeMapping(), "sourceUrl")).toBe(
      "\"cmetadata\"->>'source'",
    );
  });

  it("returns null for unmapped fields", () => {
    expect(buildColumnExpr(makeMapping(), "updatedAt")).toBeNull();
    expect(buildColumnExpr(makeMapping(), "documentId")).toBeNull();
  });

  it.each([
    ["semicolon injection", "document; drop table users"],
    ["quote injection", 'document" AS x --'],
    ["space", "doc ument"],
    ["parenthesis", "lower(document)"],
    ["empty segment", "public..document"],
    ["trailing dot", "document."],
  ])("rejects unsafe plain identifiers (%s)", (_name, value) => {
    const mapping = makeMapping({ content: value });
    expect(() => buildColumnExpr(mapping, "content")).toThrow();
  });

  it.each([
    ["missing key", "meta:cmetadata"],
    ["empty key", "meta:cmetadata."],
    ["empty column", "meta:.source"],
    ["quote in key", "meta:cmetadata.sou'rce"],
    ["quote in column", 'meta:cmeta"data.source'],
  ])("rejects unsafe meta: paths (%s)", (_name, value) => {
    const mapping = makeMapping({ sourceUrl: value });
    expect(() => buildColumnExpr(mapping, "sourceUrl")).toThrow();
  });
});
