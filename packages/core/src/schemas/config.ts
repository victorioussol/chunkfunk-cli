import { z } from "zod";
import { mappingV1Schema } from "./mapping";

/** Source kinds — must stay in sync with the `sources.kind` CHECK constraint (§2). */
export const sourceKindSchema = z.enum([
  "website",
  "sitemap",
  "github_repo",
  "files",
  "manual",
]);

export type SourceKind = z.infer<typeof sourceKindSchema>;

/**
 * `chunkfunk.yaml` (§3.3). `connection.env` holds the NAME of an env var —
 * the connection string itself is never stored.
 */
export const chunkfunkConfigV1Schema = z.object({
  version: z.literal(1),
  system: z.object({
    name: z.string().min(1),
  }),
  connection: z.object({
    env: z.string().min(1),
  }),
  mapping: mappingV1Schema.optional(),
  sources: z
    .array(
      z.object({
        kind: sourceKindSchema,
        locator: z.string().min(1),
      }),
    )
    .optional(),
  sync: z
    .object({
      enabled: z.boolean().default(false),
      apiUrl: z.url().optional(),
    })
    .optional(),
  telemetry: z.boolean().default(false),
  thresholds: z
    .object({
      nearDuplicateCosine: z.number().min(0).max(1).optional(),
      thinChunkMinChars: z.number().int().positive().optional(),
      linkNavDensity: z.number().min(0).max(1).optional(),
      maxChunks: z.number().int().positive().optional(),
      nearDupProbes: z.number().int().positive().optional(),
    })
    .optional(),
});

export type ChunkfunkConfigV1 = z.infer<typeof chunkfunkConfigV1Schema>;
export type ChunkfunkConfigV1Input = z.input<typeof chunkfunkConfigV1Schema>;
