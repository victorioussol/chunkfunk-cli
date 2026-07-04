import { z } from "zod";

/**
 * MappingV1 — how a user's pgvector table maps onto ChunkFunk's canonical
 * fields (§3.2 of the execution plan).
 *
 * Column values are either a plain (optionally schema-qualified) column name
 * or a JSON path written as `meta:<jsonb_column>.<key>`. Identifier safety is
 * enforced exclusively by `buildColumnExpr` — the single place SQL expressions
 * are built from mapping data.
 */
export const mappingV1Schema = z.object({
  version: z.literal(1),
  dialect: z.literal("pgvector"),
  table: z.string().min(1),
  columns: z.object({
    content: z.string().min(1),
    embedding: z.string().min(1),
    metadata: z.string().min(1).nullable(),
    documentId: z.string().min(1).nullable(),
    sourceUrl: z.string().min(1).nullable(),
    updatedAt: z.string().min(1).nullable(),
  }),
  joins: z
    .object({
      collectionTable: z.string().min(1),
      collectionFk: z.string().min(1),
      collectionNameColumn: z.string().min(1),
    })
    .optional(),
});

export type MappingV1 = z.infer<typeof mappingV1Schema>;
