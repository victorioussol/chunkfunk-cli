import { z } from "zod";
import { findingTypeSchema } from "./report";

export const telemetryCommonIdentifierSchema = z.enum([
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

export const telemetryHashedIdentifierSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
export const telemetryIdentifierSchema = z.union([
  telemetryCommonIdentifierSchema,
  telemetryHashedIdentifierSchema,
]);

export const telemetryRecipeIdSchema = z.enum([
  "langchain-pgvector",
  "llamaindex-pgvector",
  "supabase-vecs",
  "supabase-docs-tutorial",
  "generic-single-table",
]);

export const telemetryFrameworkGuessSchema = z.enum([
  "langchain",
  "llamaindex",
  "vecs",
  "generic",
  "custom",
  "unknown",
]);

export const telemetryMappingRoleSchema = z.enum([
  "content",
  "embedding",
  "metadata",
  "documentId",
  "sourceUrl",
  "updatedAt",
]);

const telemetryManualMappingColumnSchema = z
  .object({
    role: telemetryMappingRoleSchema,
    name: telemetryIdentifierSchema.nullable(),
  })
  .strict();

export const telemetryMappingShapeSchema = z.discriminatedUnion("id", [
  z.object({ id: telemetryRecipeIdSchema }).strict(),
  z
    .object({
      id: z.literal("manual"),
      columns: z.array(telemetryManualMappingColumnSchema).length(6),
    })
    .strict(),
]);

const findingCountByTypeSchema = z
  .object(
    Object.fromEntries(
      findingTypeSchema.options.map((type) => [type, z.number().int().nonnegative().optional()]),
    ),
  )
  .strict();

export const telemetryV1Schema = z
  .object({
    fingerprintHash: z.string().regex(/^[a-f0-9]{64}$/),
    frameworkGuess: telemetryFrameworkGuessSchema,
    embeddingDims: z.number().int().positive().nullable(),
    totals: z
      .object({
        documents: z.number().int().nonnegative(),
        chunks: z.number().int().nonnegative(),
      })
      .strict(),
    findingCounts: z.object({ byType: findingCountByTypeSchema }).strict(),
    healthScore: z.number().int().min(0).max(100),
    mappingShape: telemetryMappingShapeSchema,
    cliVersion: z.string().regex(/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/),
    os: z.string().regex(/^[A-Za-z0-9_-]{1,32}\/[A-Za-z0-9_-]{1,32}$/),
  })
  .strict();

export type TelemetryV1 = z.infer<typeof telemetryV1Schema>;
export type TelemetryMappingShape = z.infer<typeof telemetryMappingShapeSchema>;
