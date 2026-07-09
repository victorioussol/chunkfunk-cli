import { z } from "zod";
import { jsonObjectSchema } from "./json";
import { mappingV1Schema } from "./mapping";

const isoDatetime = z.iso.datetime({ offset: true });

/** Finding types — must stay in sync with the `findings.type` CHECK constraint (§2). */
export const findingTypeSchema = z.enum([
  "stale_source",
  "stale_document",
  "exact_duplicate",
  "near_duplicate",
  "thin_chunk",
  "risky_chunk",
  "embedding_mixed_dims",
  "embedding_null",
  "architecture",
  "test_regression",
]);

export type FindingType = z.infer<typeof findingTypeSchema>;

export const findingSeveritySchema = z.enum(["critical", "warning", "info"]);

export type FindingSeverity = z.infer<typeof findingSeveritySchema>;

export const suggestedRepairSchema = z.object({
  kind: z.string().min(1),
  description: z.string().min(1),
  sql: z.string().optional(),
});

export type SuggestedRepair = z.infer<typeof suggestedRepairSchema>;

/** Same shape as the `findings` DB row minus ids (§3.1). Evidence uses counts, refs, safe keys, and hashes — never document text. */
export const findingV1Schema = z.object({
  type: findingTypeSchema,
  severity: findingSeveritySchema,
  title: z.string().min(1),
  evidence: jsonObjectSchema,
  suggestedRepair: suggestedRepairSchema.nullable().optional(),
  affectedCount: z.number().int().min(1).default(1),
});

export type FindingV1 = z.infer<typeof findingV1Schema>;

export const healthSubscoresSchema = z.object({
  freshness: z.number().min(0).max(100).nullable(),
  duplication: z.number().min(0).max(100),
  quality: z.number().min(0).max(100),
  risk: z.number().min(0).max(100),
  coverage: z.number().min(0).max(100).nullable(),
});

export type HealthSubscores = z.infer<typeof healthSubscoresSchema>;

export const sourceStatusSchema = z.enum(["fresh", "stale", "unknown"]);

export type SourceStatus = z.infer<typeof sourceStatusSchema>;

/** ReportV1 — the single cross-boundary scan payload (§3.1). */
export const reportV1Schema = z.object({
  version: z.literal(1),
  scan: z.object({
    id: z.uuid(),
    origin: z.enum(["cli", "cloud"]),
    startedAt: isoDatetime,
    finishedAt: isoDatetime,
    cliVersion: z.string().optional(),
  }),
  stack: z.object({
    fingerprintHash: z.string().min(1),
    frameworkGuess: z.string().nullable(),
    embeddingDims: z.number().int().positive().nullable(),
    embeddingModelGuess: z.string().nullable(),
    mapping: mappingV1Schema,
  }),
  totals: z.object({
    documents: z.number().int().nonnegative(),
    chunks: z.number().int().nonnegative(),
    sources: z.number().int().nonnegative(),
  }),
  health: z.object({
    score: z.number().int().min(0).max(100),
    scoreVersion: z.literal(1),
    subscores: healthSubscoresSchema,
    delta: z
      .object({
        previousScore: z.number().int().min(0).max(100),
        previousScanAt: isoDatetime,
      })
      .optional(),
  }),
  findings: z.array(findingV1Schema),
  sources: z.array(
    z.object({
      locator: z.string().min(1),
      kind: z.string().min(1),
      lastIndexedAt: isoDatetime.nullable(),
      lastChangedAt: isoDatetime.nullable(),
      status: sourceStatusSchema,
    }),
  ),
  nextActions: z.array(
    z.object({
      rank: z.number().int().positive(),
      title: z.string().min(1),
      findingRefs: z.array(z.number().int().nonnegative()),
    }),
  ),
});

export type ReportV1 = z.infer<typeof reportV1Schema>;
