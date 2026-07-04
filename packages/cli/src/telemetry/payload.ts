import { createHash } from "node:crypto";
import { arch, platform } from "node:os";
import {
  telemetryV1Schema,
  type FindingType,
  type MappingV1,
  type ReportV1,
  type TelemetryMappingShape,
  type TelemetryV1,
} from "@chunkfunk/core";

export const TELEMETRY_COMMON_IDENTIFIER_ALLOWLIST = new Set([
  "content",
  "text",
  "document",
  "body",
  "embedding",
  "vector",
  "metadata",
  "meta",
  "cmetadata",
  "metadata_",
  "id",
  "node_id",
  "source",
  "url",
  "updated_at",
  "created_at",
]);

const MAPPING_ROLES = ["content", "embedding", "metadata", "documentId", "sourceUrl", "updatedAt"] as const;
const KNOWN_FRAMEWORKS = new Set(["langchain", "llamaindex", "vecs", "generic", "custom"]);
export type TelemetryRecipeId = Exclude<TelemetryMappingShape["id"], "manual">;

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function anonymizeIdentifier(identifier: string | null): string | null {
  if (identifier === null) return null;
  return TELEMETRY_COMMON_IDENTIFIER_ALLOWLIST.has(identifier) ? identifier : `sha256:${sha256(identifier)}`;
}

function sameColumns(mapping: MappingV1, expected: MappingV1["columns"]): boolean {
  return MAPPING_ROLES.every((role) => mapping.columns[role] === expected[role]);
}

export function recipeIdForMapping(mapping: MappingV1): TelemetryRecipeId | null {
  if (
    sameColumns(mapping, {
      content: "document",
      embedding: "embedding",
      metadata: "cmetadata",
      documentId: null,
      sourceUrl: "meta:cmetadata.source",
      updatedAt: null,
    }) &&
    mapping.joins?.collectionFk === "collection_id" &&
    mapping.joins.collectionNameColumn === "name"
  ) {
    return "langchain-pgvector";
  }

  if (
    sameColumns(mapping, {
      content: "text",
      embedding: "embedding",
      metadata: "metadata_",
      documentId: "meta:metadata_.doc_id",
      sourceUrl: null,
      updatedAt: null,
    })
  ) {
    return "llamaindex-pgvector";
  }

  if (
    sameColumns(mapping, {
      content: "meta:metadata.text",
      embedding: "vec",
      metadata: "metadata",
      documentId: null,
      sourceUrl: null,
      updatedAt: null,
    })
  ) {
    return "supabase-vecs";
  }

  if (
    sameColumns(mapping, {
      content: "content",
      embedding: "embedding",
      metadata: "metadata",
      documentId: null,
      sourceUrl: null,
      updatedAt: null,
    })
  ) {
    return "supabase-docs-tutorial";
  }

  return null;
}

export function buildTelemetryMappingShape(mapping: MappingV1, knownRecipeId?: TelemetryRecipeId | null): TelemetryMappingShape {
  const recipeId = knownRecipeId ?? recipeIdForMapping(mapping);
  if (recipeId) return { id: recipeId };

  return {
    id: "manual",
    columns: MAPPING_ROLES.map((role) => ({
      role,
      name: anonymizeIdentifier(mapping.columns[role]),
    })),
  };
}

function findingCountsByType(report: ReportV1): Partial<Record<FindingType, number>> {
  const byType: Partial<Record<FindingType, number>> = {};
  for (const finding of report.findings) {
    byType[finding.type] = (byType[finding.type] ?? 0) + 1;
  }
  return byType;
}

function frameworkGuess(value: string | null): TelemetryV1["frameworkGuess"] {
  return value && KNOWN_FRAMEWORKS.has(value) ? (value as TelemetryV1["frameworkGuess"]) : "unknown";
}

export function buildTelemetryPayload(report: ReportV1, options: { recipeId?: TelemetryRecipeId | null } = {}): TelemetryV1 {
  return telemetryV1Schema.parse({
    fingerprintHash: report.stack.fingerprintHash,
    frameworkGuess: frameworkGuess(report.stack.frameworkGuess),
    embeddingDims: report.stack.embeddingDims,
    totals: {
      documents: report.totals.documents,
      chunks: report.totals.chunks,
    },
    findingCounts: { byType: findingCountsByType(report) },
    healthScore: report.health.score,
    mappingShape: buildTelemetryMappingShape(report.stack.mapping, options.recipeId),
    cliVersion: report.scan.cliVersion ?? "0.0.0",
    os: `${platform()}/${arch()}`,
  });
}

export function serializeTelemetryPayload(payload: TelemetryV1): string {
  return JSON.stringify(telemetryV1Schema.parse(payload));
}
